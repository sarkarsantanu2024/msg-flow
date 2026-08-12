import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma, recordAudit } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { inviteMemberSchema, updateMemberRoleSchema } from '@msgflow/validation';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  const context = await requirePermission('tenant:read');
  const members = await prisma.membership.findMany({
    where: { tenantId: context.tenantId },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return ok(members);
});

/**
 * Add a member.
 *
 * With no mail transport configured, we create the account with a generated
 * temporary password and return it once, so the owner can hand it over. That is
 * honest about what the system can actually do rather than silently "sending"
 * an invitation nobody receives.
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('members:manage');
  const input = inviteMemberSchema.parse(await readJson(request));

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });

  if (existingUser) {
    const existingMembership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: context.tenantId, userId: existingUser.id } },
    });
    if (existingMembership) throw new AppError('CONFLICT', 'That person is already a member of this workspace.');

    await prisma.membership.create({
      data: { tenantId: context.tenantId, userId: existingUser.id, role: input.role },
    });

    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'member.invited',
      entityType: 'Membership',
      entityId: existingUser.id,
      after: { email: input.email, role: input.role },
      ...(await requestMeta()),
    });

    return created({ email: input.email, role: input.role, temporaryPassword: null, existingAccount: true });
  }

  const temporaryPassword = randomBytes(9).toString('base64url');

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name ?? input.email.split('@')[0],
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      memberships: { create: { tenantId: context.tenantId, role: input.role } },
    },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'member.invited',
    entityType: 'Membership',
    entityId: user.id,
    after: { email: input.email, role: input.role },
    ...(await requestMeta()),
  });

  return created({ email: input.email, role: input.role, temporaryPassword, existingAccount: false });
});

export const PATCH = route(async (request: Request) => {
  const context = await requirePermission('members:manage');
  const input = updateMemberRoleSchema.parse(await readJson(request));

  const membership = await prisma.membership.findFirst({
    where: { id: input.membershipId, tenantId: context.tenantId },
  });
  if (!membership) throw new AppError('NOT_FOUND', 'That member does not exist in this workspace.');

  // A workspace with no owner cannot be administered by anyone.
  if (membership.role === 'OWNER' && input.role !== 'OWNER') {
    const owners = await prisma.membership.count({ where: { tenantId: context.tenantId, role: 'OWNER' } });
    if (owners <= 1) {
      throw new AppError('CONFLICT', 'A workspace must always have at least one owner.');
    }
  }

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: { role: input.role },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'member.role_changed',
    entityType: 'Membership',
    entityId: membership.id,
    before: { role: membership.role },
    after: { role: input.role },
    ...(await requestMeta()),
  });

  return ok(updated);
});

export const DELETE = route(async (request: Request) => {
  const context = await requirePermission('members:manage');
  const membershipId = new URL(request.url).searchParams.get('id');
  if (!membershipId) throw new AppError('VALIDATION_FAILED', 'A membership id is required.');

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, tenantId: context.tenantId },
  });
  if (!membership) throw new AppError('NOT_FOUND', 'That member does not exist in this workspace.');

  if (membership.role === 'OWNER') {
    const owners = await prisma.membership.count({ where: { tenantId: context.tenantId, role: 'OWNER' } });
    if (owners <= 1) throw new AppError('CONFLICT', 'A workspace must always have at least one owner.');
  }

  await prisma.membership.delete({ where: { id: membership.id } });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'member.removed',
    entityType: 'Membership',
    entityId: membership.id,
    ...(await requestMeta()),
  });

  return ok({ removed: true });
});
