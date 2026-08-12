import { getAIProvider, withRetry } from '@msgflow/ai';
import { prisma, recordUsage } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { createLogger, describeError } from '@msgflow/logger';
import type { AiCategory, ExtractionFieldSpec } from '@msgflow/types';
import { startOfLocalDay } from './windows.js';
import { keyFieldsOfSchema, upsertExtractedRecord } from './records.js';

const log = createLogger('workflow:pipeline');

/**
 * The AI pipeline: classify → extract → validate → structured record.
 *
 * Classification runs once per message and is cached on MessageClassification.
 * Extraction runs per (message × automation), because two automations can pull
 * different schemas out of the same message.
 */

export interface ClassifyOptions {
  tenantId: string;
  messageId: string;
  force?: boolean;
}

export interface ClassifyResult {
  category: AiCategory;
  importance: string;
  confidence: number;
  cached: boolean;
}

export async function classifyMessage(options: ClassifyOptions): Promise<ClassifyResult> {
  const message = await prisma.message.findFirst({
    where: { id: options.messageId, tenantId: options.tenantId },
    include: { classification: true, group: true },
  });

  if (!message) {
    throw new Error(`Message ${options.messageId} not found for this tenant.`);
  }

  if (message.classification && !options.force) {
    return {
      category: message.classification.category as AiCategory,
      importance: message.classification.importance,
      confidence: message.classification.confidence,
      cached: true,
    };
  }

  const provider = getAIProvider();
  const started = Date.now();

  try {
    const response = await withRetry(
      () =>
        provider.classifyMessage({
          text: message.text ?? '',
          groupName: message.group?.name,
          senderName: message.senderName ?? undefined,
        }),
      { label: 'classify' },
    );

    const { data, meta } = response;

    await prisma.$transaction([
      prisma.messageClassification.upsert({
        where: { messageId: message.id },
        create: {
          tenantId: options.tenantId,
          messageId: message.id,
          category: data.category,
          importance: data.importance,
          confidence: data.confidence,
          reasoning: data.reasoning,
          entities: data.entities as Prisma.InputJsonValue,
          provider: meta.provider,
          model: meta.model,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
        },
        update: {
          category: data.category,
          importance: data.importance,
          confidence: data.confidence,
          reasoning: data.reasoning,
          entities: data.entities as Prisma.InputJsonValue,
          provider: meta.provider,
          model: meta.model,
        },
      }),
      prisma.message.update({
        where: { id: message.id },
        data: {
          status: data.category === 'IGNORE' ? 'IGNORED' : 'CLASSIFIED',
          errorMessage: null,
        },
      }),
      prisma.aIUsage.create({
        data: {
          tenantId: options.tenantId,
          provider: meta.provider,
          model: meta.model,
          operation: 'classify',
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          costUsd: meta.costUsd,
          durationMs: meta.durationMs,
          success: true,
          messageId: message.id,
        },
      }),
    ]);

    await recordUsage(options.tenantId, await todayFor(options.tenantId), {
      aiCalls: 1,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costUsd: meta.costUsd,
    });

    return {
      category: data.category,
      importance: data.importance,
      confidence: data.confidence,
      cached: false,
    };
  } catch (err) {
    const detail = describeError(err);
    log.error('Classification failed', { messageId: message.id, ...detail });

    await prisma.$transaction([
      prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorMessage: detail.message.slice(0, 500) },
      }),
      prisma.aIUsage.create({
        data: {
          tenantId: options.tenantId,
          provider: getAIProvider().name,
          model: getAIProvider().model,
          operation: 'classify',
          durationMs: Date.now() - started,
          success: false,
          errorMessage: detail.message.slice(0, 500),
          messageId: message.id,
        },
      }),
    ]);

    throw err;
  }
}

export interface ExtractOptions {
  tenantId: string;
  messageId: string;
  automationId: string;
  runId?: string | null;
}

export interface ExtractResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  recordIds: string[];
  confidence: number;
  reasoning: string;
}

export async function extractFromMessage(options: ExtractOptions): Promise<ExtractResult> {
  const [message, automation] = await Promise.all([
    prisma.message.findFirst({
      where: { id: options.messageId, tenantId: options.tenantId },
      include: { group: true },
    }),
    prisma.automation.findFirst({
      where: { id: options.automationId, tenantId: options.tenantId },
      include: { schema: { include: { fields: { orderBy: { order: 'asc' } } } } },
    }),
  ]);

  if (!message) throw new Error(`Message ${options.messageId} not found.`);
  if (!automation) throw new Error(`Automation ${options.automationId} not found.`);

  const fields: ExtractionFieldSpec[] = automation.schema.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    description: f.description ?? undefined,
    enumValues: f.enumValues.length > 0 ? f.enumValues : undefined,
  }));

  const provider = getAIProvider();
  const started = Date.now();

  const response = await withRetry(
    () =>
      provider.extractStructuredData({
        text: message.text ?? '',
        fields,
        schemaName: automation.schema.name,
        systemPrompt: automation.schema.systemPrompt ?? undefined,
        examples: (automation.schema.examples as Array<{ message: string; expected: Record<string, unknown> }>) ?? [],
        groupName: message.group?.name,
        senderName: message.senderName ?? undefined,
        messageDate: message.timestamp.toISOString().slice(0, 10),
      }),
    { label: 'extract' },
  );

  const { data, meta } = response;

  await prisma.aIUsage.create({
    data: {
      tenantId: options.tenantId,
      provider: meta.provider,
      model: meta.model,
      operation: 'extract',
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costUsd: meta.costUsd,
      durationMs: meta.durationMs,
      success: true,
      messageId: message.id,
      automationId: automation.id,
      runId: options.runId ?? null,
    },
  });

  await recordUsage(options.tenantId, await todayFor(options.tenantId), {
    aiCalls: 1,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
    costUsd: meta.costUsd,
  });

  const keyFields = keyFieldsOfSchema(automation.schema.fields);
  const result: ExtractResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    recordIds: [],
    confidence: data.confidence,
    reasoning: data.reasoning,
  };

  if (data.records.length === 0) {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: 'SKIPPED' },
    });
    log.debug('No records extracted', { messageId: message.id, reasoning: data.reasoning });
    return result;
  }

  for (const candidate of data.records) {
    try {
      const upserted = await upsertExtractedRecord({
        tenantId: options.tenantId,
        schemaId: automation.schemaId,
        automationId: automation.id,
        messageId: message.id,
        eventAt: message.timestamp,
        data: candidate.data,
        confidence: candidate.confidence,
        fields,
        keyFields,
        confidenceThreshold: Math.max(automation.minConfidence, automation.schema.confidenceThreshold),
      });

      result.recordIds.push(upserted.recordId);
      if (upserted.action === 'created') result.created++;
      else if (upserted.action === 'updated') result.updated++;
      else result.skipped++;
    } catch (err) {
      result.failed++;
      log.error('Failed to persist extracted record', {
        messageId: message.id,
        ...describeError(err),
      });
    }
  }

  const anyNeedsReview = await prisma.extractedRecord.count({
    where: { id: { in: result.recordIds }, status: 'NEEDS_REVIEW' },
  });

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: result.failed > 0 ? 'FAILED' : anyNeedsReview > 0 ? 'NEEDS_REVIEW' : 'EXTRACTED',
      errorMessage: null,
    },
  });

  await recordUsage(options.tenantId, await todayFor(options.tenantId), {
    recordsCreated: result.created,
    recordsUpdated: result.updated,
  });

  log.info('Extraction complete', {
    messageId: message.id,
    automationId: automation.id,
    ...result,
    durationMs: Date.now() - started,
  });

  return result;
}

const tenantTimezoneCache = new Map<string, { tz: string; at: number }>();

/** Local-midnight bucket for usage metering, in the tenant's timezone. */
async function todayFor(tenantId: string): Promise<Date> {
  const cached = tenantTimezoneCache.get(tenantId);
  const fresh = cached && Date.now() - cached.at < 300_000;
  let tz = cached?.tz ?? 'Asia/Kolkata';

  if (!fresh) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    tz = tenant?.timezone ?? 'Asia/Kolkata';
    tenantTimezoneCache.set(tenantId, { tz, at: Date.now() });
  }

  return startOfLocalDay(new Date(), tz);
}
