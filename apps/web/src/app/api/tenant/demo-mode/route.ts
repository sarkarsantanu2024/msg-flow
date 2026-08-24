import { prisma, readDemoMode, recordAudit } from '@msgflow/db';
import { z } from 'zod';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({ demoMode: z.boolean() });

/**
 * Show or hide demo data for the whole workspace.
 *
 * Stored on the tenant rather than in a cookie so everyone looking at the
 * workspace sees the same thing — during a demo that usually means a laptop and
 * a projector, and a per-browser setting would let those two disagree.
 *
 * Gated on `tenant:manage`: this changes what every member sees, so it is not a
 * view preference an ordinary member should be able to flip.
 */
export const PATCH = route(async (request: Request) => {
  const context = await requirePermission('tenant:manage');
  const input = schema.parse(await readJson(request));

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: context.tenantId },
    select: { settings: true },
  });

  const before = readDemoMode(tenant.settings);
  const settings = {
    ...((tenant.settings ?? {}) as Record<string, unknown>),
    demoMode: input.demoMode,
  };

  await prisma.tenant.update({
    where: { id: context.tenantId },
    data: { settings },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'tenant.demo_mode_changed',
    entityType: 'Tenant',
    entityId: context.tenantId,
    before: { demoMode: before },
    after: { demoMode: input.demoMode },
    ...(await requestMeta()),
  });

  return ok({ demoMode: input.demoMode });
});
