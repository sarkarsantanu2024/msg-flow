import { cookies } from 'next/headers';
import { getMembership } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { ok, readJson, route } from '@/lib/api';
import { requireAuthApi, TENANT_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Switch the active workspace.
 *
 * Membership is verified before the cookie is written, so setting the cookie by
 * hand cannot grant access to a workspace you do not belong to.
 */
export const POST = route(async (request: Request) => {
  const context = await requireAuthApi();
  const body = (await readJson(request)) as { tenantId?: string };

  if (!body.tenantId) throw new AppError('VALIDATION_FAILED', 'A workspace id is required.');

  const membership = await getMembership(context.userId, body.tenantId);
  if (!membership) throw new AppError('FORBIDDEN', 'You do not belong to that workspace.');

  const store = await cookies();
  store.set(TENANT_COOKIE, body.tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return ok({ tenantId: membership.tenantId, tenantName: membership.tenantName });
});
