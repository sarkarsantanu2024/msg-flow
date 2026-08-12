import { Prisma } from '@prisma/client';
import { prisma } from './client.js';

export interface UsageDelta {
  messages?: number;
  aiCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  automationRuns?: number;
  workflowRuns?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  exports?: number;
  apiCalls?: number;
}

/**
 * Increment daily usage counters for a tenant.
 *
 * Upsert on (tenantId, periodStart) so concurrent workers cannot lose counts —
 * read-modify-write would drop increments under any real concurrency.
 */
export async function recordUsage(tenantId: string, periodStart: Date, delta: UsageDelta): Promise<void> {
  const increments = {
    messages: delta.messages ?? 0,
    aiCalls: delta.aiCalls ?? 0,
    inputTokens: delta.inputTokens ?? 0,
    outputTokens: delta.outputTokens ?? 0,
    automationRuns: delta.automationRuns ?? 0,
    workflowRuns: delta.workflowRuns ?? 0,
    recordsCreated: delta.recordsCreated ?? 0,
    recordsUpdated: delta.recordsUpdated ?? 0,
    exports: delta.exports ?? 0,
    apiCalls: delta.apiCalls ?? 0,
  };
  const cost = new Prisma.Decimal(delta.costUsd ?? 0);

  await prisma.usage.upsert({
    where: { tenantId_periodStart: { tenantId, periodStart } },
    create: { tenantId, periodStart, ...increments, costUsd: cost },
    update: {
      messages: { increment: increments.messages },
      aiCalls: { increment: increments.aiCalls },
      inputTokens: { increment: increments.inputTokens },
      outputTokens: { increment: increments.outputTokens },
      automationRuns: { increment: increments.automationRuns },
      workflowRuns: { increment: increments.workflowRuns },
      recordsCreated: { increment: increments.recordsCreated },
      recordsUpdated: { increment: increments.recordsUpdated },
      exports: { increment: increments.exports },
      apiCalls: { increment: increments.apiCalls },
      costUsd: { increment: cost },
    },
  });
}
