import { WORKER_STALE_MS } from '@msgflow/config';
import { prisma } from '@msgflow/db';
import { getSystemHealth, resolvePreset, startOfLocalDay } from '@msgflow/workflow';
import type { SystemHealth, WhatsAppStatusSummary } from '@msgflow/types';

/**
 * Shared read queries for the dashboard.
 *
 * Every one takes an explicit tenantId — there is no ambient tenant. That is
 * what keeps a missing `where` clause from turning into a cross-tenant leak.
 */

export async function getWhatsAppSummary(tenantId: string, timezone: string): Promise<WhatsAppStatusSummary> {
  const connection = await prisma.whatsAppConnection.findFirst({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
    include: { worker: true },
  });

  const todayStart = startOfLocalDay(new Date(), timezone);

  const [groupsMonitored, messagesToday] = await Promise.all([
    prisma.whatsAppGroup.count({ where: { tenantId, isMonitored: true } }),
    prisma.message.count({ where: { tenantId, receivedAt: { gte: todayStart } } }),
  ]);

  if (!connection) {
    return {
      connectionId: null,
      name: 'No connection',
      status: 'DISCONNECTED',
      phoneNumber: null,
      connectedAt: null,
      lastHeartbeatAt: null,
      lastMessageAt: null,
      workerStatus: 'OFFLINE',
      workerName: null,
      groupsMonitored,
      messagesToday,
      qrCode: null,
      lastError: null,
    };
  }

  // A worker that stopped heartbeating is offline regardless of the status it
  // last wrote — a crashed process cannot report its own death.
  const workerAlive =
    connection.worker?.lastHeartbeatAt &&
    Date.now() - connection.worker.lastHeartbeatAt.getTime() < WORKER_STALE_MS;

  return {
    connectionId: connection.id,
    name: connection.name,
    // If the worker is gone, the connection cannot be READY no matter what the
    // row says. Showing a stale green here would be the worst possible lie.
    status: workerAlive ? connection.status : connection.status === 'READY' ? 'DISCONNECTED' : connection.status,
    phoneNumber: connection.phoneNumber,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    lastHeartbeatAt: connection.lastHeartbeatAt?.toISOString() ?? null,
    lastMessageAt: connection.lastMessageAt?.toISOString() ?? null,
    workerStatus: workerAlive ? (connection.worker?.status ?? 'ONLINE') : 'OFFLINE',
    workerName: connection.worker?.name ?? null,
    groupsMonitored,
    messagesToday,
    qrCode: connection.status === 'QR_REQUIRED' ? connection.qrCode : null,
    lastError: connection.lastErrorMessage,
  };
}

export async function getStatusPayload(tenantId: string, timezone: string): Promise<{
  health: SystemHealth;
  whatsapp: WhatsAppStatusSummary;
  counters: { groupsMonitored: number; messagesToday: number; recordsToday: number; errorsToday: number };
}> {
  const todayStart = startOfLocalDay(new Date(), timezone);

  const [health, whatsapp, recordsToday, errorsToday] = await Promise.all([
    getSystemHealth(tenantId),
    getWhatsAppSummary(tenantId, timezone),
    prisma.extractedRecord.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
    prisma.workflowRun.count({ where: { tenantId, status: 'FAILED', queuedAt: { gte: todayStart } } }),
  ]);

  return {
    health,
    whatsapp,
    counters: {
      groupsMonitored: whatsapp.groupsMonitored,
      messagesToday: whatsapp.messagesToday,
      recordsToday,
      errorsToday,
    },
  };
}

export interface DashboardMetrics {
  messages: number;
  important: number;
  extracted: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  reviewRequired: number;
  workflowSuccess: number;
  workflowFailed: number;
}

export async function getDashboardMetrics(
  tenantId: string,
  start: Date,
  end: Date,
): Promise<DashboardMetrics> {
  const [
    messages,
    important,
    extracted,
    recordsCreated,
    reviewRequired,
    runAggregate,
    workflowSuccess,
    workflowFailed,
  ] = await Promise.all([
    prisma.message.count({ where: { tenantId, timestamp: { gte: start, lt: end } } }),
    prisma.messageClassification.count({
      where: { tenantId, importance: { in: ['HIGH', 'MEDIUM'] }, createdAt: { gte: start, lt: end } },
    }),
    prisma.message.count({ where: { tenantId, status: 'EXTRACTED', timestamp: { gte: start, lt: end } } }),
    prisma.extractedRecord.count({ where: { tenantId, createdAt: { gte: start, lt: end } } }),
    prisma.extractedRecord.count({ where: { tenantId, status: 'NEEDS_REVIEW' } }),
    prisma.workflowRun.aggregate({
      where: { tenantId, queuedAt: { gte: start, lt: end } },
      _sum: { recordsUpdated: true, recordsSkipped: true, recordsFailed: true },
    }),
    prisma.workflowRun.count({
      where: { tenantId, status: { in: ['SUCCESS', 'PARTIAL_SUCCESS'] }, queuedAt: { gte: start, lt: end } },
    }),
    prisma.workflowRun.count({ where: { tenantId, status: 'FAILED', queuedAt: { gte: start, lt: end } } }),
  ]);

  return {
    messages,
    important,
    extracted,
    recordsCreated,
    recordsUpdated: runAggregate._sum.recordsUpdated ?? 0,
    recordsSkipped: runAggregate._sum.recordsSkipped ?? 0,
    recordsFailed: runAggregate._sum.recordsFailed ?? 0,
    reviewRequired,
    workflowSuccess,
    workflowFailed,
  };
}

/**
 * Daily time series.
 *
 * Fetches raw rows once and buckets them in memory rather than issuing one
 * query per day — a 30-day chart would otherwise be 120 round-trips.
 */
export async function getTimeSeries(
  tenantId: string,
  start: Date,
  end: Date,
  timezone: string,
): Promise<Array<{ date: string; label: string; messages: number; important: number; records: number; runs: number }>> {
  const { enumerateDays } = await import('@msgflow/workflow');
  const buckets = enumerateDays(start, end, timezone);

  const [messages, classifications, records, runs] = await Promise.all([
    prisma.message.findMany({
      where: { tenantId, timestamp: { gte: start, lt: end } },
      select: { timestamp: true },
    }),
    prisma.messageClassification.findMany({
      where: { tenantId, importance: { in: ['HIGH', 'MEDIUM'] }, createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.extractedRecord.findMany({
      where: { tenantId, createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.workflowRun.findMany({
      where: { tenantId, queuedAt: { gte: start, lt: end } },
      select: { queuedAt: true },
    }),
  ]);

  const countInto = (dates: Date[]) => {
    const counts = new Array(buckets.length).fill(0) as number[];
    for (const date of dates) {
      const index = buckets.findIndex((b) => date >= b.start && date < b.end);
      if (index >= 0) counts[index]++;
    }
    return counts;
  };

  const messageCounts = countInto(messages.map((m) => m.timestamp));
  const importantCounts = countInto(classifications.map((c) => c.createdAt));
  const recordCounts = countInto(records.map((r) => r.createdAt));
  const runCounts = countInto(runs.map((r) => r.queuedAt));

  return buckets.map((bucket, i) => ({
    date: bucket.key,
    label: bucket.label,
    messages: messageCounts[i],
    important: importantCounts[i],
    records: recordCounts[i],
    runs: runCounts[i],
  }));
}

export async function getCategoryBreakdown(tenantId: string, start: Date, end: Date) {
  const rows = await prisma.messageClassification.groupBy({
    by: ['category'],
    where: { tenantId, createdAt: { gte: start, lt: end } },
    _count: { category: true },
    orderBy: { _count: { category: 'desc' } },
  });
  return rows.map((r) => ({ category: r.category, count: r._count.category }));
}

export async function getAutomationHealth(tenantId: string) {
  const automations = await prisma.automation.findMany({
    where: { tenantId, status: { not: 'ARCHIVED' } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      runs: { orderBy: { queuedAt: 'desc' }, take: 20, select: { status: true, recordsCreated: true, recordsUpdated: true, recordsSkipped: true, messagesProcessed: true } },
      outputTargets: { include: { output: { select: { name: true, status: true, lastSyncAt: true } } } },
    },
  });

  return automations.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    processingMode: a.processingMode,
    lastSuccessfulRunAt: a.lastSuccessfulRunAt?.toISOString() ?? null,
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    nextRunAt: a.nextRunAt?.toISOString() ?? null,
    messagesProcessed: a.runs.reduce((sum, r) => sum + r.messagesProcessed, 0),
    recordsCreated: a.runs.reduce((sum, r) => sum + r.recordsCreated, 0),
    recordsUpdated: a.runs.reduce((sum, r) => sum + r.recordsUpdated, 0),
    recordsSkipped: a.runs.reduce((sum, r) => sum + r.recordsSkipped, 0),
    errors: a.runs.filter((r) => r.status === 'FAILED').length,
    outputs: a.outputTargets.map((t) => ({
      name: t.output.name,
      status: t.output.status,
      operation: t.operation,
      lastSyncAt: t.output.lastSyncAt?.toISOString() ?? null,
    })),
  }));
}

export async function getRecentActivity(tenantId: string, take = 8) {
  const runs = await prisma.workflowRun.findMany({
    where: { tenantId },
    orderBy: { queuedAt: 'desc' },
    take,
    include: { automation: { select: { name: true } }, output: { select: { name: true } } },
  });
  return runs;
}

export { resolvePreset };
