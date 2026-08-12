import { getAIProvider } from '@msgflow/ai';
import { mapRecordToTarget } from '@msgflow/connectors';
import { prisma, sha256 } from '@msgflow/db';
import type { Prisma } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import type { ExtractionFieldSpec, MappingSpec } from '@msgflow/types';
import { demoMessageSchema, validateRecordData } from '@msgflow/validation';
import { upsertExtractedRecord, keyFieldsOfSchema } from '@msgflow/workflow';
import { enforceRateLimit, ok, readJson, route } from '@/lib/api';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Demo Mode.
 *
 * Type a message, watch it travel the entire real pipeline — classification,
 * extraction, schema validation, and a preview of the output row that would be
 * written. No WhatsApp connection required, which makes it the sales demo and
 * also the fastest way to sanity-check a schema before going live.
 *
 * `persist: false` (the default) runs everything but writes nothing.
 */
export const POST = route(async (request: Request) => {
  const context = await requirePermission('automations:read');
  enforceRateLimit(`demo:${context.tenantId}`, 'ai');

  const input = demoMessageSchema.parse(await readJson(request));

  const automation = input.automationId
    ? await prisma.automation.findFirst({
        where: { id: input.automationId, tenantId: context.tenantId },
        include: {
          schema: { include: { fields: { orderBy: { order: 'asc' } } } },
          outputTargets: { include: { output: true, mappings: { orderBy: { order: 'asc' } } } },
        },
      })
    : null;

  const schema = automation
    ? automation.schema
    : await prisma.extractionSchema.findFirst({
        where: {
          tenantId: context.tenantId,
          ...(input.schemaId ? { id: input.schemaId } : {}),
        },
        include: { fields: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      });

  if (!schema) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Create an automation or a data schema first so Demo Mode knows what to extract.',
    );
  }

  const fields: ExtractionFieldSpec[] = schema.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    description: f.description ?? undefined,
    enumValues: f.enumValues.length > 0 ? f.enumValues : undefined,
  }));

  const provider = getAIProvider();
  const now = new Date();

  const classification = await provider.classifyMessage({
    text: input.text,
    groupName: input.groupName,
    senderName: input.senderName,
  });

  const extraction = await provider.extractStructuredData({
    text: input.text,
    fields,
    schemaName: schema.name,
    systemPrompt: schema.systemPrompt ?? undefined,
    examples: (schema.examples as Array<{ message: string; expected: Record<string, unknown> }>) ?? [],
    groupName: input.groupName,
    senderName: input.senderName,
    messageDate: now.toISOString().slice(0, 10),
  });

  // Validate exactly as the live pipeline would, so the demo reflects reality
  // rather than a rosier version of it.
  const validated = extraction.data.records.map((candidate) => {
    const result = validateRecordData(fields, candidate.data);
    return {
      data: result.data,
      valid: result.valid,
      errors: result.errors,
      confidence: candidate.confidence,
      belowThreshold: candidate.confidence < Math.max(schema.confidenceThreshold, automation?.minConfidence ?? 0),
    };
  });

  // Preview the output rows, mapped through the real mapping engine.
  const outputPreviews = (automation?.outputTargets ?? []).map((target) => {
    const mappings: MappingSpec[] = target.mappings.map((m) => ({
      sourceField: m.sourceField,
      targetField: m.targetField,
      targetColumn: m.targetColumn,
      updateStrategy: m.updateStrategy,
      transform: (m.transform ?? {}) as Record<string, unknown>,
      defaultValue: m.defaultValue,
      isKeyPart: m.isKeyPart,
      keyOrder: m.keyOrder,
    }));

    return {
      outputName: target.output.name,
      outputType: target.output.type,
      operation: target.operation,
      keyFields: mappings.filter((m) => m.isKeyPart).map((m) => m.targetField),
      rows: validated.map((record) => mapRecordToTarget(record.data, mappings)),
    };
  });

  let persistedRecordIds: string[] = [];

  if (input.persist && validated.length > 0) {
    const message = await prisma.message.create({
      data: {
        tenantId: context.tenantId,
        externalId: `demo-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        contentHash: sha256(`demo|${context.tenantId}|${input.text}|${Date.now()}`),
        senderName: input.senderName,
        text: input.text,
        messageType: 'TEXT',
        timestamp: now,
        ingestSource: 'DEMO',
        status: 'CLASSIFIED',
        metadata: { demo: true, groupName: input.groupName } as Prisma.InputJsonValue,
      },
    });

    await prisma.messageClassification.create({
      data: {
        tenantId: context.tenantId,
        messageId: message.id,
        category: classification.data.category,
        importance: classification.data.importance,
        confidence: classification.data.confidence,
        reasoning: classification.data.reasoning,
        entities: classification.data.entities as Prisma.InputJsonValue,
        provider: classification.meta.provider,
        model: classification.meta.model,
      },
    });

    const keyFields = keyFieldsOfSchema(schema.fields);
    for (const record of validated.filter((r) => r.valid)) {
      const upserted = await upsertExtractedRecord({
        tenantId: context.tenantId,
        schemaId: schema.id,
        automationId: automation?.id ?? null,
        messageId: message.id,
        eventAt: now,
        data: record.data,
        confidence: record.confidence,
        fields,
        keyFields,
        confidenceThreshold: schema.confidenceThreshold,
      });
      persistedRecordIds.push(upserted.recordId);
    }

    await prisma.message.update({ where: { id: message.id }, data: { status: 'EXTRACTED' } });
  }

  await prisma.aIUsage.createMany({
    data: [
      {
        tenantId: context.tenantId,
        provider: classification.meta.provider,
        model: classification.meta.model,
        operation: 'classify',
        inputTokens: classification.meta.inputTokens,
        outputTokens: classification.meta.outputTokens,
        costUsd: classification.meta.costUsd,
        durationMs: classification.meta.durationMs,
        success: true,
      },
      {
        tenantId: context.tenantId,
        provider: extraction.meta.provider,
        model: extraction.meta.model,
        operation: 'extract',
        inputTokens: extraction.meta.inputTokens,
        outputTokens: extraction.meta.outputTokens,
        costUsd: extraction.meta.costUsd,
        durationMs: extraction.meta.durationMs,
        success: true,
      },
    ],
  });

  return ok({
    provider: provider.name,
    usingFallback: provider.name === 'mock',
    schema: { id: schema.id, name: schema.name, fields },
    classification: classification.data,
    extraction: {
      reasoning: extraction.data.reasoning,
      confidence: extraction.data.confidence,
      records: validated,
    },
    outputPreviews,
    persisted: input.persist,
    persistedRecordIds,
    timings: {
      classifyMs: classification.meta.durationMs,
      extractMs: extraction.meta.durationMs,
    },
  });
});
