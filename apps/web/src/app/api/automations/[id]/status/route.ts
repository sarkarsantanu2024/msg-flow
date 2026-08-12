import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { automationStatusActionSchema } from '@msgflow/validation';
import { computeNextRun } from '@msgflow/workflow';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Activate, pause, resume, archive or duplicate an automation. */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('automations:manage');
  const { id } = await params;
  const { action } = automationStatusActionSchema.parse(await readJson(request));

  const automation = assertTenantOwned(
    await prisma.automation.findUnique({
      where: { id },
      include: { triggers: true, outputTargets: { include: { mappings: true } }, actions: true },
    }),
    context.tenantId,
    'Automation',
  );

  const schedule = {
    processingMode: automation.processingMode,
    scheduleHour: automation.scheduleHour,
    scheduleMinute: automation.scheduleMinute,
    scheduleWeekday: automation.scheduleWeekday,
    scheduleDay: automation.scheduleDay,
    cronExpression: automation.cronExpression,
    timezone: automation.timezone || context.timezone,
  };

  if (action === 'duplicate') {
    const copy = await prisma.automation.create({
      data: {
        tenantId: context.tenantId,
        name: `${automation.name} (copy)`,
        description: automation.description,
        status: 'DRAFT',
        schemaId: automation.schemaId,
        processingMode: automation.processingMode,
        dateRangeMode: automation.dateRangeMode,
        cronExpression: automation.cronExpression,
        timezone: automation.timezone,
        scheduleHour: automation.scheduleHour,
        scheduleMinute: automation.scheduleMinute,
        scheduleWeekday: automation.scheduleWeekday,
        scheduleDay: automation.scheduleDay,
        requireImportant: automation.requireImportant,
        minImportance: automation.minImportance,
        categories: automation.categories,
        keywordFilter: automation.keywordFilter,
        minConfidence: automation.minConfidence,
        createdBy: context.userId,
        triggers: {
          create: automation.triggers.map((t) => ({
            tenantId: context.tenantId,
            type: t.type,
            groupId: t.groupId,
            enabled: t.enabled,
          })),
        },
      },
    });

    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'automation.duplicated',
      entityType: 'Automation',
      entityId: copy.id,
      after: { copiedFrom: automation.id },
      ...(await requestMeta()),
    });

    return ok({ id: copy.id, status: copy.status });
  }

  if (action === 'activate') {
    // Refuse to activate something that cannot possibly work — a "running"
    // automation with no source or no output is worse than an honest error.
    if (automation.triggers.filter((t) => t.enabled && t.groupId).length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Select at least one WhatsApp group before activating.');
    }
    if (automation.outputTargets.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Connect at least one output before activating, so extracted data has somewhere to go.',
      );
    }
    const missingKey = automation.outputTargets.find(
      (t) => ['UPDATE_EXISTING', 'UPSERT'].includes(t.operation) && !t.mappings.some((m) => m.isKeyPart),
    );
    if (missingKey) {
      throw new AppError(
        'VALIDATION_FAILED',
        'An output using UPDATE or UPSERT needs a unique key so existing rows can be found.',
      );
    }

    const updated = await prisma.automation.update({
      where: { id: automation.id },
      data: {
        status: 'ACTIVE',
        pausedAt: null,
        nextRunAt: computeNextRun(schedule),
      },
    });

    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'automation.activated',
      entityType: 'Automation',
      entityId: automation.id,
      ...(await requestMeta()),
    });

    return ok({ id: updated.id, status: updated.status, nextRunAt: updated.nextRunAt });
  }

  if (action === 'pause') {
    const updated = await prisma.automation.update({
      where: { id: automation.id },
      // Messages keep arriving and being stored while paused; only processing
      // stops, so a resume can pick up the backlog.
      data: { status: 'PAUSED', pausedAt: new Date(), nextRunAt: null },
    });

    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'automation.paused',
      entityType: 'Automation',
      entityId: automation.id,
      ...(await requestMeta()),
    });

    return ok({ id: updated.id, status: updated.status });
  }

  if (action === 'resume') {
    const updated = await prisma.automation.update({
      where: { id: automation.id },
      data: { status: 'ACTIVE', pausedAt: null, nextRunAt: computeNextRun(schedule) },
    });
    return ok({ id: updated.id, status: updated.status, nextRunAt: updated.nextRunAt });
  }

  const updated = await prisma.automation.update({
    where: { id: automation.id },
    data: { status: 'ARCHIVED', nextRunAt: null },
  });
  return ok({ id: updated.id, status: updated.status });
});
