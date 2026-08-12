import { assertTenantOwned, prisma, recordAudit } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { reviewActionSchema, updateRecordSchema, validateRecordData } from '@msgflow/validation';
import { getRecordLineage } from '@msgflow/workflow';
import { ok, readJson, route } from '@/lib/api';
import { requirePermission, requestMeta } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Full lineage: record → extraction → message → group → sender → output rows. */
export const GET = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('records:read');
  const { id } = await params;

  const record = await getRecordLineage(context.tenantId, id);
  if (!record) throw new AppError('NOT_FOUND', 'That record does not exist.');

  return ok(record);
});

/** Edit a record's data. Validated against its schema before saving. */
export const PATCH = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('records:edit');
  const { id } = await params;
  const input = updateRecordSchema.parse(await readJson(request));

  const record = assertTenantOwned(
    await prisma.extractedRecord.findUnique({
      where: { id },
      include: { schema: { include: { fields: { orderBy: { order: 'asc' } } } } },
    }),
    context.tenantId,
    'Record',
  );

  const fields = record.schema.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    enumValues: f.enumValues.length > 0 ? f.enumValues : undefined,
  }));

  const validation = validateRecordData(fields, input.data);
  if (!validation.valid) {
    throw new AppError('VALIDATION_FAILED', 'Some values are not valid for this schema.', {
      detail: validation.errors,
    });
  }

  const previous = (record.data ?? {}) as Record<string, unknown>;
  const now = new Date();

  // A human edit is a field event like any other, so the history stays complete
  // and the value can still be traced.
  const events = Object.entries(validation.data)
    .filter(([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value))
    .map(([fieldKey, newValue]) => ({
      tenantId: context.tenantId,
      recordId: record.id,
      fieldKey,
      previousValue: (previous[fieldKey] ?? null) as Prisma.InputJsonValue,
      newValue: newValue as Prisma.InputJsonValue,
      eventAt: now,
      applied: true,
      skipReason: null,
    }));

  const [updated] = await prisma.$transaction([
    prisma.extractedRecord.update({
      where: { id: record.id },
      data: {
        data: validation.data as Prisma.InputJsonValue,
        version: { increment: 1 },
        lastEventAt: now,
        reviewNote: input.reviewNote,
        reviewedBy: context.userId,
        reviewedAt: now,
      },
    }),
    ...(events.length > 0 ? [prisma.recordFieldEvent.createMany({ data: events })] : []),
    // The record changed, so anything already written to an output is stale.
    prisma.outputSyncRecord.updateMany({
      where: { recordId: record.id },
      data: { syncStatus: 'STALE' },
    }),
  ]);

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'record.edited',
    entityType: 'ExtractedRecord',
    entityId: record.id,
    before: previous,
    after: validation.data,
    ...(await requestMeta()),
  });

  return ok(updated);
});

/** Review-queue actions: approve, edit & approve, reject, reprocess. */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('records:review');
  const { id } = await params;
  const input = reviewActionSchema.parse(await readJson(request));

  const record = assertTenantOwned(
    await prisma.extractedRecord.findUnique({
      where: { id },
      include: { schema: { include: { fields: true } }, sources: { where: { isOrigin: true }, take: 1 } },
    }),
    context.tenantId,
    'Record',
  );

  if (input.action === 'reprocess') {
    const messageId = record.originMessageId ?? record.sources[0]?.messageId;
    if (!messageId || !record.automationId) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This record cannot be reprocessed because its source message or automation is no longer available.',
      );
    }

    const { extractFromMessage } = await import('@msgflow/workflow');
    const result = await extractFromMessage({
      tenantId: context.tenantId,
      messageId,
      automationId: record.automationId,
    });

    await recordAudit({
      tenantId: context.tenantId,
      userId: context.userId,
      action: 'record.reprocessed',
      entityType: 'ExtractedRecord',
      entityId: record.id,
      ...(await requestMeta()),
    });

    return ok({ action: 'reprocess', ...result });
  }

  let data = (record.data ?? {}) as Record<string, unknown>;

  if (input.action === 'edit_approve') {
    if (!input.data) throw new AppError('VALIDATION_FAILED', 'Provide the corrected data.');
    const fields = record.schema.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      enumValues: f.enumValues.length > 0 ? f.enumValues : undefined,
    }));
    const validation = validateRecordData(fields, input.data);
    if (!validation.valid) {
      throw new AppError('VALIDATION_FAILED', 'Some values are not valid for this schema.', {
        detail: validation.errors,
      });
    }
    data = validation.data;
  }

  const status = input.action === 'reject' ? 'REJECTED' : 'APPROVED';

  const updated = await prisma.extractedRecord.update({
    where: { id: record.id },
    data: {
      data: data as Prisma.InputJsonValue,
      status,
      reviewedAt: new Date(),
      reviewedBy: context.userId,
      reviewNote: input.note,
      version: input.action === 'edit_approve' ? { increment: 1 } : undefined,
    },
  });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: status === 'REJECTED' ? 'record.rejected' : 'record.approved',
    entityType: 'ExtractedRecord',
    entityId: record.id,
    after: { status, note: input.note },
    ...(await requestMeta()),
  });

  return ok(updated);
});

export const DELETE = route(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const context = await requirePermission('records:delete');
  const { id } = await params;

  const record = assertTenantOwned(
    await prisma.extractedRecord.findUnique({ where: { id } }),
    context.tenantId,
    'Record',
  );

  await prisma.extractedRecord.delete({ where: { id: record.id } });

  await recordAudit({
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'record.deleted',
    entityType: 'ExtractedRecord',
    entityId: record.id,
    before: { naturalKey: record.naturalKey },
    ...(await requestMeta()),
  });

  return ok({ deleted: true });
});
