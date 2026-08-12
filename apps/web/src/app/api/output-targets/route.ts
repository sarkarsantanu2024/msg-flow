import { operationSupported } from '@msgflow/connectors';
import { prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { outputTargetWithKeyRule } from '@msgflow/validation';
import { created, ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Connect an automation to an output, with its operation and field mapping.
 *
 * This row is the sentence "this automation UPSERTs into that workbook, matched
 * on Customer + Product + Date".
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('outputs:manage');
  const input = outputTargetWithKeyRule.parse(await readJson(request));

  const [automation, output] = await Promise.all([
    prisma.automation.findFirst({ where: { id: input.automationId, tenantId: context.tenantId } }),
    prisma.output.findFirst({ where: { id: input.outputId, tenantId: context.tenantId } }),
  ]);

  if (!automation) throw new AppError('NOT_FOUND', 'That automation does not exist in this workspace.');
  if (!output) throw new AppError('NOT_FOUND', 'That output does not exist in this workspace.');

  if (!operationSupported(output.type, input.operation)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${input.operation} is not supported for a ${output.type.replace('_', ' ').toLowerCase()} output.`,
    );
  }

  // Every mapped source field must exist on the automation's schema, otherwise
  // the mapping silently writes blanks forever.
  const schemaFields = await prisma.extractionField.findMany({
    where: { schemaId: automation.schemaId },
    select: { key: true },
  });
  const known = new Set(schemaFields.map((f) => f.key));
  const unknown = input.mappings.filter((m) => !known.has(m.sourceField)).map((m) => m.sourceField);
  if (unknown.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `These fields are not part of the automation's data schema: ${unknown.join(', ')}.`,
    );
  }

  const target = await prisma.outputTarget.upsert({
    where: { automationId_outputId: { automationId: input.automationId, outputId: input.outputId } },
    create: {
      tenantId: context.tenantId,
      automationId: input.automationId,
      outputId: input.outputId,
      operation: input.operation,
      enabled: input.enabled,
      order: input.order,
      cronExpression: input.cronExpression,
      config: input.config as Prisma.InputJsonValue,
      mappings: {
        create: input.mappings.map((m, index) => ({
          tenantId: context.tenantId,
          sourceField: m.sourceField,
          targetField: m.targetField,
          targetColumn: m.targetColumn ?? null,
          updateStrategy: m.updateStrategy,
          transform: m.transform as Prisma.InputJsonValue,
          defaultValue: m.defaultValue ?? null,
          isKeyPart: m.isKeyPart,
          keyOrder: m.keyOrder ?? (m.isKeyPart ? index : null),
          order: m.order || index,
        })),
      },
    },
    update: {
      operation: input.operation,
      enabled: input.enabled,
      order: input.order,
      cronExpression: input.cronExpression,
      config: input.config as Prisma.InputJsonValue,
      mappings: {
        // Replace wholesale: a partial mapping update would leave orphaned
        // columns pointing at fields the user just removed.
        deleteMany: {},
        create: input.mappings.map((m, index) => ({
          tenantId: context.tenantId,
          sourceField: m.sourceField,
          targetField: m.targetField,
          targetColumn: m.targetColumn ?? null,
          updateStrategy: m.updateStrategy,
          transform: m.transform as Prisma.InputJsonValue,
          defaultValue: m.defaultValue ?? null,
          isKeyPart: m.isKeyPart,
          keyOrder: m.keyOrder ?? (m.isKeyPart ? index : null),
          order: m.order || index,
        })),
      },
    },
    include: { mappings: true, output: true },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'output.updated',
    entityType: 'OutputTarget',
    entityId: target.id,
    after: { operation: input.operation, mappings: input.mappings.length },
    ...(await requestMeta()),
  });

  return created(target);
});

export const DELETE = route(async (request: Request) => {
  const context = await requirePermission('outputs:manage');
  const targetId = new URL(request.url).searchParams.get('id');
  if (!targetId) throw new AppError('VALIDATION_FAILED', 'A target id is required.');

  const target = await prisma.outputTarget.findFirst({
    where: { id: targetId, tenantId: context.tenantId },
  });
  if (!target) throw new AppError('NOT_FOUND', 'That output connection does not exist.');

  await prisma.outputTarget.delete({ where: { id: target.id } });
  return ok({ deleted: true });
});
