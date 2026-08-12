import { prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { automationSchema } from '@msgflow/validation';
import { buildCronExpression, computeNextRun } from '@msgflow/workflow';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route(async () => {
  const context = await requirePermission('automations:read');

  const automations = await prisma.automation.findMany({
    where: { tenantId: context.tenantId, status: { not: 'ARCHIVED' } },
    orderBy: { createdAt: 'desc' },
    include: {
      schema: { select: { id: true, name: true, fields: { select: { key: true, label: true } } } },
      triggers: { include: { group: { select: { id: true, name: true } } } },
      outputTargets: { include: { output: { select: { id: true, name: true, type: true, status: true } } } },
      _count: { select: { runs: true, records: true } },
    },
  });

  return ok(automations);
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'schema'
  );
}

/**
 * Create an automation, optionally defining its extraction schema inline.
 *
 * Created as DRAFT regardless of how it was produced. An AI-generated
 * automation is never activated automatically — a human reviews it and presses
 * Activate.
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('automations:manage');
  const input = automationSchema.parse(await readJson(request));

  // Verify every referenced group belongs to this tenant before writing.
  const groups = await prisma.whatsAppGroup.findMany({
    where: { id: { in: input.groupIds }, tenantId: context.tenantId },
    select: { id: true },
  });
  if (groups.length !== input.groupIds.length) {
    throw new AppError('VALIDATION_FAILED', 'One or more selected groups do not belong to this workspace.');
  }

  const automation = await prisma.$transaction(async (tx) => {
    let schemaId = input.schemaId;

    if (!schemaId && input.schema) {
      let slug = slugify(input.schema.name);
      const clash = await tx.extractionSchema.findUnique({
        where: { tenantId_slug: { tenantId: context.tenantId, slug } },
      });
      if (clash) slug = `${slug}-${Date.now().toString(36)}`;

      const schema = await tx.extractionSchema.create({
        data: {
          tenantId: context.tenantId,
          name: input.schema.name,
          slug,
          description: input.schema.description,
          systemPrompt: input.schema.systemPrompt,
          confidenceThreshold: input.schema.confidenceThreshold,
          fields: {
            create: input.schema.fields.map((field, index) => ({
              key: field.key,
              label: field.label,
              type: field.type,
              required: field.required,
              isKeyField: field.isKeyField,
              enumValues: field.enumValues,
              description: field.description,
              validation: field.validation as Prisma.InputJsonValue,
              order: field.order || index,
            })),
          },
        },
      });
      schemaId = schema.id;
    }

    if (!schemaId) throw new AppError('VALIDATION_FAILED', 'A data schema is required.');

    const owned = await tx.extractionSchema.findFirst({
      where: { id: schemaId, tenantId: context.tenantId },
    });
    if (!owned) throw new AppError('NOT_FOUND', 'That data schema does not exist in this workspace.');

    const timezone = input.timezone || context.timezone;
    const cronExpression =
      input.processingMode === 'CUSTOM'
        ? (input.cronExpression ?? null)
        : buildCronExpression({
            processingMode: input.processingMode,
            scheduleHour: input.scheduleHour,
            scheduleMinute: input.scheduleMinute,
            scheduleWeekday: input.scheduleWeekday,
            scheduleDay: input.scheduleDay,
          });

    return tx.automation.create({
      data: {
        tenantId: context.tenantId,
        name: input.name,
        description: input.description,
        // Always DRAFT — activation is an explicit, separate human decision.
        status: 'DRAFT',
        schemaId,
        processingMode: input.processingMode,
        dateRangeMode: input.dateRangeMode,
        cronExpression,
        timezone,
        scheduleHour: input.scheduleHour,
        scheduleMinute: input.scheduleMinute,
        scheduleWeekday: input.scheduleWeekday,
        scheduleDay: input.scheduleDay,
        customFrom: input.customFrom ? new Date(input.customFrom) : null,
        customTo: input.customTo ? new Date(input.customTo) : null,
        requireImportant: input.requireImportant,
        minImportance: input.minImportance,
        categories: input.categories,
        keywordFilter: input.keywordFilter,
        minConfidence: input.minConfidence,
        createdBy: context.userId,
        triggers: {
          create: input.groupIds.map((groupId) => ({
            tenantId: context.tenantId,
            type: input.processingMode === 'REAL_TIME' ? 'REAL_TIME' : 'SCHEDULE',
            groupId,
            enabled: true,
          })),
        },
      },
      include: { schema: { include: { fields: true } }, triggers: true },
    });
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'automation.created',
    entityType: 'Automation',
    entityId: automation.id,
    after: { name: automation.name, processingMode: automation.processingMode },
    ...(await requestMeta()),
  });

  void computeNextRun;
  return created(automation);
});
