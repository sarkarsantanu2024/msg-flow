import { prisma, recordAudit } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { z } from 'zod';
import { ok, readJson, route } from '@/lib/api';
import { requestMeta, requireSuperAdminApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  timezone: z.string().min(1).optional(),
});

export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requireSuperAdminApi();
  const { id } = await params;
  const input = schema.parse(await readJson(request));

  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new AppError('NOT_FOUND', 'That tenant does not exist.');

  const updated = await prisma.tenant.update({
    where: { id },
    data: { status: input.status, name: input.name, timezone: input.timezone },
  });

  // Suspending must actually stop work, not merely block the UI: pause every
  // automation so no scheduled run fires for a suspended workspace.
  if (input.status === 'SUSPENDED') {
    await prisma.automation.updateMany({
      where: { tenantId: id, status: 'ACTIVE' },
      data: { status: 'PAUSED', pausedAt: new Date(), nextRunAt: null },
    });
  }

  await recordAudit({
    tenantId: id,
    userId: context.userId,
    action: input.status === 'SUSPENDED' ? 'tenant.suspended' : input.status === 'ACTIVE' ? 'tenant.activated' : 'tenant.updated',
    entityType: 'Tenant',
    entityId: id,
    before: { status: tenant.status, name: tenant.name },
    after: { status: updated.status, name: updated.name },
    ...(await requestMeta()),
  });

  return ok(updated);
});
