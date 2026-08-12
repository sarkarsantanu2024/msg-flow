'use server';

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma, recordAudit, sha256, type Prisma } from '@msgflow/db';
import { createLogger, describeError } from '@msgflow/logger';
import { forgotPasswordSchema, resetPasswordSchema, signupSchema } from '@msgflow/validation';
import { fieldErrors } from '@msgflow/validation';

const log = createLogger('auth:actions');

export interface ActionResult {
  ok: boolean;
  message?: string;
  fields?: Record<string, string>;
  /** Dev convenience: the reset link, when no mailer is configured. */
  devResetUrl?: string;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

/**
 * Sign up: create the user, their workspace, and an OWNER membership.
 *
 * All three in one transaction — a user without a tenant, or a tenant with no
 * owner, is a broken state that someone would have to repair by hand.
 */
export async function signupAction(formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    organizationName: formData.get('organizationName'),
    timezone: formData.get('timezone') || 'Asia/Kolkata',
  });

  if (!parsed.success) {
    return { ok: false, message: 'Please check the form.', fields: fieldErrors(parsed.error) };
  }

  const { name, email, password, organizationName, timezone } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { ok: false, message: 'An account with that email already exists.', fields: { email: 'Already registered' } };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let slug = slugify(organizationName);
    // Slugs are globally unique; append a short suffix rather than failing.
    if (await prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${slug}-${randomBytes(3).toString('hex')}`;
    }

    // The first account on a fresh install becomes the platform super admin,
    // otherwise nobody can reach /admin without a manual database edit.
    const isFirstUser = (await prisma.user.count()) === 0;

    const { tenantId, userId } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash, isSuperAdmin: isFirstUser, emailVerifiedAt: new Date() },
      });

      const tenant = await tx.tenant.create({
        data: { name: organizationName, slug, timezone, status: 'TRIAL' },
      });

      await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
      });

      const plan = await tx.plan.findFirst({ where: { slug: 'starter' } });
      if (plan) {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: 'TRIALING',
            currentPeriodEnd: new Date(Date.now() + 14 * 86_400_000),
          },
        });
      }

      return { tenantId: tenant.id, userId: user.id };
    });

    await recordAudit({
      tenantId,
      userId,
      action: 'user.signup',
      entityType: 'User',
      entityId: userId,
      after: { email, organizationName },
    });

    return { ok: true, message: 'Account created. Signing you in…' };
  } catch (err) {
    log.error('Signup failed', describeError(err));
    return { ok: false, message: 'We could not create your account. Please try again.' };
  }
}

/**
 * Request a password reset.
 *
 * Always reports success, whether or not the address exists — a differing
 * response is an account-enumeration oracle. With no mailer configured the link
 * is returned for local development and clearly labelled as such.
 */
export async function forgotPasswordAction(formData: FormData): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { ok: false, message: 'Enter a valid email address.', fields: fieldErrors(parsed.error) };
  }

  const genericResponse: ActionResult = {
    ok: true,
    message: 'If an account exists for that address, a reset link is on its way.',
  };

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) return genericResponse;

    const token = randomBytes(32).toString('base64url');
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: sha256(token), resetTokenExpires: new Date(Date.now() + 3_600_000) },
    });

    const url = `${process.env.APP_URL ?? 'http://localhost:3000'}/reset-password?token=${token}`;
    log.info('Password reset requested', { userId: user.id });

    if (process.env.NODE_ENV !== 'production') {
      return { ...genericResponse, devResetUrl: url };
    }
    // Production mailing is a deployment concern — see docs/deployment.md.
    return genericResponse;
  } catch (err) {
    log.error('Password reset request failed', describeError(err));
    return genericResponse;
  }
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { ok: false, message: 'Please check the form.', fields: fieldErrors(parsed.error) };
  }

  try {
    const hashed = sha256(parsed.data.token);
    const user = await prisma.user.findFirst({
      where: { resetToken: hashed, resetTokenExpires: { gt: new Date() } },
    });

    if (!user) {
      return { ok: false, message: 'That reset link is invalid or has expired. Request a new one.' };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.password, 12),
        resetToken: null,
        resetTokenExpires: null,
      },
    });

    const membership = await prisma.membership.findFirst({ where: { userId: user.id } });
    if (membership) {
      await recordAudit({
        tenantId: membership.tenantId,
        userId: user.id,
        action: 'user.password_reset',
        entityType: 'User',
        entityId: user.id,
      });
    }

    return { ok: true, message: 'Password updated. You can sign in now.' };
  } catch (err) {
    log.error('Password reset failed', describeError(err));
    return { ok: false, message: 'We could not reset your password. Please try again.' };
  }
}
