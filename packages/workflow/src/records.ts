import { Prisma, prisma, sha256 } from '@msgflow/db';
import { createLogger } from '@msgflow/logger';
import { buildNaturalKey, validateRecordData } from '@msgflow/validation';
import type { ExtractionFieldSpec } from '@msgflow/types';

const log = createLogger('workflow:records');

/**
 * Structured-record persistence.
 *
 * The core idea: a record is not overwritten, it is *folded* from field events
 * ordered by the message's own timestamp. Given the stock sequence
 * 100 @ 10:00 → 80 @ 11:00 → 75 @ 12:00, the record converges on 75 regardless
 * of the order the messages were processed in, because ordering is by when they
 * were sent, not when we happened to see them.
 *
 * A late-arriving older message is still recorded (applied = false,
 * skipReason = 'superseded') so the history stays complete. Nothing is deleted.
 */

export interface UpsertRecordInput {
  tenantId: string;
  schemaId: string;
  automationId?: string | null;
  messageId?: string | null;
  /** The message's own timestamp — the ordering authority. */
  eventAt: Date;
  data: Record<string, unknown>;
  confidence: number;
  fields: ExtractionFieldSpec[];
  keyFields: string[];
  confidenceThreshold: number;
}

export interface UpsertRecordResult {
  recordId: string;
  action: 'created' | 'updated' | 'skipped';
  naturalKey: string;
  status: string;
  changedFields: string[];
  validationErrors: Array<{ field: string; message: string }>;
}

export async function upsertExtractedRecord(input: UpsertRecordInput): Promise<UpsertRecordResult> {
  const validation = validateRecordData(input.fields, input.data);
  const naturalKey = buildNaturalKey(validation.data, input.keyFields);
  const naturalKeyHash = sha256(`${input.schemaId}:${naturalKey}`);

  // Below the threshold, or failing validation, the record still gets stored —
  // it goes to the review queue rather than being thrown away. A human can fix
  // it; a discarded extraction is gone forever.
  const status = !validation.valid
    ? 'NEEDS_REVIEW'
    : input.confidence < input.confidenceThreshold
      ? 'NEEDS_REVIEW'
      : 'VALIDATED';

  const existing = await prisma.extractedRecord.findUnique({
    where: {
      tenantId_schemaId_naturalKeyHash: {
        tenantId: input.tenantId,
        schemaId: input.schemaId,
        naturalKeyHash,
      },
    },
    include: { fieldEvents: { orderBy: { eventAt: 'desc' }, take: 200 } },
  });

  if (!existing) {
    const record = await prisma.extractedRecord.create({
      data: {
        tenantId: input.tenantId,
        schemaId: input.schemaId,
        automationId: input.automationId ?? null,
        naturalKey,
        naturalKeyHash,
        data: validation.data as Prisma.InputJsonValue,
        status,
        confidence: input.confidence,
        version: 1,
        originMessageId: input.messageId ?? null,
        firstSeenAt: input.eventAt,
        lastEventAt: input.eventAt,
      },
    });

    await Promise.all([
      prisma.recordFieldEvent.createMany({
        data: Object.entries(validation.data).map(([fieldKey, newValue]) => ({
          tenantId: input.tenantId,
          recordId: record.id,
          fieldKey,
          previousValue: Prisma.JsonNull,
          newValue: newValue as Prisma.InputJsonValue,
          eventAt: input.eventAt,
          applied: true,
          messageId: input.messageId ?? null,
        })),
      }),
      input.messageId
        ? prisma.recordSource.create({
            data: {
              tenantId: input.tenantId,
              recordId: record.id,
              messageId: input.messageId,
              isOrigin: true,
              confidence: input.confidence,
            },
          })
        : Promise.resolve(null),
    ]);

    return {
      recordId: record.id,
      action: 'created',
      naturalKey,
      status,
      changedFields: Object.keys(validation.data),
      validationErrors: validation.errors,
    };
  }

  // Fold the incoming values onto the existing record.
  const currentData = (existing.data ?? {}) as Record<string, unknown>;
  const nextData: Record<string, unknown> = { ...currentData };
  const events: Prisma.RecordFieldEventCreateManyInput[] = [];
  const changedFields: string[] = [];

  // Last applied event per field, so we can tell "newer" from "older".
  const lastAppliedAt = new Map<string, Date>();
  for (const event of existing.fieldEvents) {
    if (!event.applied) continue;
    const prev = lastAppliedAt.get(event.fieldKey);
    if (!prev || event.eventAt > prev) lastAppliedAt.set(event.fieldKey, event.eventAt);
  }

  for (const [fieldKey, newValue] of Object.entries(validation.data)) {
    if (newValue === undefined || newValue === null || newValue === '') continue;

    const previousValue = currentData[fieldKey];
    const lastAt = lastAppliedAt.get(fieldKey);
    const isNewer = !lastAt || input.eventAt >= lastAt;

    if (!isNewer) {
      // Older than what we already applied: record it, do not fold it.
      events.push({
        tenantId: input.tenantId,
        recordId: existing.id,
        fieldKey,
        previousValue: (previousValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
        eventAt: input.eventAt,
        applied: false,
        skipReason: 'superseded by a newer message',
        messageId: input.messageId ?? null,
      });
      continue;
    }

    if (JSON.stringify(previousValue) === JSON.stringify(newValue)) continue;

    nextData[fieldKey] = newValue;
    changedFields.push(fieldKey);
    events.push({
      tenantId: input.tenantId,
      recordId: existing.id,
      fieldKey,
      previousValue: (previousValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      newValue: newValue as Prisma.InputJsonValue,
      eventAt: input.eventAt,
      applied: true,
      messageId: input.messageId ?? null,
    });
  }

  if (events.length > 0) {
    await prisma.recordFieldEvent.createMany({ data: events });
  }

  if (input.messageId) {
    await prisma.recordSource
      .create({
        data: {
          tenantId: input.tenantId,
          recordId: existing.id,
          messageId: input.messageId,
          isOrigin: false,
          confidence: input.confidence,
        },
      })
      .catch(() => {
        // Unique (recordId, messageId): the same message contributing twice is
        // expected on reprocess and is not an error.
      });
  }

  if (changedFields.length === 0) {
    return {
      recordId: existing.id,
      action: 'skipped',
      naturalKey,
      status: existing.status,
      changedFields: [],
      validationErrors: validation.errors,
    };
  }

  // Approved records that change again go back for review rather than silently
  // mutating data a human already signed off on.
  const nextStatus =
    existing.status === 'APPROVED' && status === 'NEEDS_REVIEW'
      ? 'NEEDS_REVIEW'
      : existing.status === 'APPROVED'
        ? 'APPROVED'
        : status;

  await prisma.extractedRecord.update({
    where: { id: existing.id },
    data: {
      data: nextData as Prisma.InputJsonValue,
      confidence: Math.max(existing.confidence, input.confidence),
      status: nextStatus,
      version: { increment: 1 },
      lastEventAt: input.eventAt > (existing.lastEventAt ?? new Date(0)) ? input.eventAt : existing.lastEventAt,
      automationId: existing.automationId ?? input.automationId ?? null,
    },
  });

  log.debug('Record updated', { recordId: existing.id, changedFields });

  return {
    recordId: existing.id,
    action: 'updated',
    naturalKey,
    status: nextStatus,
    changedFields,
    validationErrors: validation.errors,
  };
}

/** Key fields declared on a schema, in declaration order. */
export function keyFieldsOfSchema(fields: Array<{ key: string; isKeyField: boolean }>): string[] {
  const declared = fields.filter((f) => f.isKeyField).map((f) => f.key);
  if (declared.length > 0) return declared;
  // No declared key: fall back to the first field so records still de-duplicate
  // on something meaningful rather than on the whole payload.
  return fields.length > 0 ? [fields[0].key] : [];
}

/** Full lineage for one record — powers "Where did this data come from?". */
export async function getRecordLineage(tenantId: string, recordId: string) {
  const record = await prisma.extractedRecord.findFirst({
    where: { id: recordId, tenantId },
    include: {
      schema: { include: { fields: { orderBy: { order: 'asc' } } } },
      automation: { select: { id: true, name: true, status: true } },
      originMessage: { include: { group: true, classification: true } },
      sources: {
        include: { message: { include: { group: true, classification: true } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      },
      fieldEvents: { orderBy: { eventAt: 'desc' }, take: 100, include: { message: true } },
      syncRecords: { include: { output: { select: { id: true, name: true, type: true } } } },
    },
  });

  return record;
}
