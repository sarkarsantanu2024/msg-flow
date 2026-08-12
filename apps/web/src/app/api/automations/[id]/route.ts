import { assertTenantOwned, prisma, recordAudit, type Prisma } from '@msgflow/db';
import { computeNextRun } from '@msgflow/workflow';
import { z } from 'zod';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('automations:read');
  const { id } = await params;

  const automation = assertTenantOwned(
    await prisma.automation.findUnique({
      where: { id },
      include: {
        schema: { include: { fields: { orderBy: { order: 'asc' } } } },
        triggers: { include: { group: true } },
        actions: { orderBy: { order: 'asc' } },
        outputTargets: { include: { output: true, mappings: true } },
        runs: { orderBy: { queuedAt: 'desc' }, take: 20 },
      },
    }),
    context.tenantId,
    'Automation',
  );

  return ok(automation);
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  processingMode: z.enum(['REAL_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM', 'MANUAL']).optional(),
  dateRangeMode: z
    .enum([
      'CURRENT_MESSAGE',
      'TODAY',
      'YESTERDAY',
      'THIS_WEEK',
      'LAST_WEEK',
      'THIS_MONTH',
      'LAST_MONTH',
      'LAST_7_DAYS',
      'CUSTOM',
      'SINCE_LAST_SUCCESSFUL_RUN',
    ])
    .optional(),
  scheduleHour: z.coerce.number().int().min(0).max(23).optional(),
  scheduleMinute: z.coerce.number().int().min(0).max(59).optional(),
  scheduleWeekday: z.coerce.number().int().min(0).max(6).optional(),
  scheduleDay: z.coerce.number().int().min(1).max(28).optional(),
  cronExpression: z.string().max(120).nullable().optional(),
  requireImportant: z.boolean().optional(),
  minImportance: z.enum(['HIGH', 'MEDIUM', 'LOW', 'IGNORE']).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  keywordFilter: z.string().max(300).nullable().optional(),
  groupIds: z.array(z.string()).min(1).optional(),
});

export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('automations:manage');
  const { id } = await params;
  const input = updateSchema.parse(await readJson(request));

  const automation = assertTenantOwned(
    await prisma.automation.findUnique({ where: { id } }),
    context.tenantId,
    'Automation',
  );

  const merged = {
    processingMode: input.processingMode ?? automation.processingMode,
    scheduleHour: input.scheduleHour ?? automation.scheduleHour,
    scheduleMinute: input.scheduleMinute ?? automation.scheduleMinute,
    scheduleWeekday: input.scheduleWeekday ?? automation.scheduleWeekday,
    scheduleDay: input.scheduleDay ?? automation.scheduleDay,
    cronExpression: input.cronExpression ?? automation.cronExpression,
    timezone: automation.timezone || context.timezone,
  };

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (input.groupIds) {
      const owned = await tx.whatsAppGroup.findMany({
        where: { id: { in: input.groupIds }, tenantId: context.tenantId },
        select: { id: true },
      });
      await tx.automationTrigger.deleteMany({ where: { automationId: automation.id } });
      await tx.automationTrigger.createMany({
        data: owned.map((g) => ({
          tenantId: context.tenantId,
          automationId: automation.id,
          type: merged.processingMode === 'REAL_TIME' ? ('REAL_TIME' as const) : ('SCHEDULE' as const),
          groupId: g.id,
          enabled: true,
        })),
      });
    }

    return tx.automation.update({
      where: { id: automation.id },
      data: {
        name: input.name,
        description: input.description,
        processingMode: input.processingMode,
        dateRangeMode: input.dateRangeMode,
        scheduleHour: input.scheduleHour,
        scheduleMinute: input.scheduleMinute,
        scheduleWeekday: input.scheduleWeekday,
        scheduleDay: input.scheduleDay,
        cronExpression: input.cronExpression,
        requireImportant: input.requireImportant,
        minImportance: input.minImportance,
        minConfidence: input.minConfidence,
        keywordFilter: input.keywordFilter,
        // Recompute the schedule whenever anything affecting it changes.
        nextRunAt: automation.status === 'ACTIVE' ? computeNextRun(merged) : null,
      },
    });
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'automation.updated',
    entityType: 'Automation',
    entityId: automation.id,
    before: { name: automation.name, processingMode: automation.processingMode },
    after: { name: updated.name, processingMode: updated.processingMode },
    ...(await requestMeta()),
  });

  return ok(updated);
});

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('automations:manage');
  const { id } = await params;

  const automation = assertTenantOwned(
    await prisma.automation.findUnique({ where: { id } }),
    context.tenantId,
    'Automation',
  );

  // Archive rather than destroy: the runs, records and lineage that reference
  // this automation are still meaningful history.
  await prisma.automation.update({
    where: { id: automation.id },
    data: { status: 'ARCHIVED', nextRunAt: null },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'automation.deleted',
    entityType: 'Automation',
    entityId: automation.id,
    before: { name: automation.name },
    ...(await requestMeta()),
  });

  return ok({ archived: true });
});
