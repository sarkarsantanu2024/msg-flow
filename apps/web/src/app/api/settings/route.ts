import { prisma, recordAudit } from '@msgflow/db';
import { tenantSettingsSchema } from '@msgflow/validation';
import { computeNextRun } from '@msgflow/workflow';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const PATCH = route(async (request: Request) => {
  const context = await requirePermission('tenant:manage');
  const input = tenantSettingsSchema.parse(await readJson(request));

  const before = await prisma.tenant.findUnique({ where: { id: context.tenantId } });

  const tenant = await prisma.tenant.update({
    where: { id: context.tenantId },
    data: { name: input.name, timezone: input.timezone },
  });

  // A timezone change moves every scheduled run. Recompute them rather than
  // leaving automations firing at the old local time.
  if (before && before.timezone !== input.timezone) {
    const automations = await prisma.automation.findMany({
      where: { tenantId: context.tenantId, status: 'ACTIVE', timezone: null },
    });
    for (const automation of automations) {
      await prisma.automation.update({
        where: { id: automation.id },
        data: {
          nextRunAt: computeNextRun({
            processingMode: automation.processingMode,
            scheduleHour: automation.scheduleHour,
            scheduleMinute: automation.scheduleMinute,
            scheduleWeekday: automation.scheduleWeekday,
            scheduleDay: automation.scheduleDay,
            cronExpression: automation.cronExpression,
            timezone: input.timezone,
          }),
        },
      });
    }
  }

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'settings.changed',
    entityType: 'Tenant',
    entityId: context.tenantId,
    before: { name: before?.name, timezone: before?.timezone },
    after: { name: tenant.name, timezone: tenant.timezone },
    ...(await requestMeta()),
  });

  return ok(tenant);
});
