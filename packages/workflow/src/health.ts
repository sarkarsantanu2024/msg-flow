import { getProviderStatus } from '@msgflow/ai';
import { WORKER_STALE_MS } from '@msgflow/config';
import { checkDatabase, prisma } from '@msgflow/db';
import type { HealthLayerStatus, SystemHealth } from '@msgflow/types';

/**
 * Health hierarchy:
 *   Database → Worker → WhatsApp → Group Listener → Queue → AI → Workflow → Output
 *
 * Liveness is heartbeat-based. A crashed worker cannot report its own death, so
 * the signal is the *absence* of a recent heartbeat, not the presence of an
 * error status in the database.
 */

function worst(states: HealthLayerStatus[]): HealthLayerStatus['state'] {
  if (states.some((s) => s.state === 'DOWN')) return 'DOWN';
  if (states.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
  if (states.every((s) => s.state === 'HEALTHY')) return 'HEALTHY';
  return 'UNKNOWN';
}

export async function getSystemHealth(tenantId?: string): Promise<SystemHealth> {
  const layers: HealthLayerStatus[] = [];
  const now = Date.now();

  // --- Database ---
  const db = await checkDatabase();
  layers.push({
    layer: 'DATABASE',
    label: 'Database',
    state: db.ok ? (db.latencyMs > 1_000 ? 'DEGRADED' : 'HEALTHY') : 'DOWN',
    message: db.ok ? `Responding in ${db.latencyMs}ms` : (db.error ?? 'Unreachable'),
    latencyMs: db.latencyMs,
  });

  if (!db.ok) {
    // Without a database every other check is unknowable — say so rather than
    // reporting a cascade of misleading failures.
    for (const [layer, label] of [
      ['WORKER', 'Worker'],
      ['WHATSAPP', 'WhatsApp'],
      ['GROUP_LISTENER', 'Group Listener'],
      ['QUEUE', 'Queue'],
      ['AI', 'AI Processor'],
      ['WORKFLOW', 'Workflow Engine'],
      ['OUTPUT', 'Output Connectors'],
    ] as const) {
      layers.push({ layer, label, state: 'UNKNOWN', message: 'Cannot be checked without the database' });
    }
    return { overall: 'DOWN', layers, checkedAt: new Date().toISOString() };
  }

  // --- Worker ---
  const workers = await prisma.worker.findMany({ orderBy: { lastHeartbeatAt: 'desc' }, take: 10 });
  const liveWorkers = workers.filter(
    (w) => w.lastHeartbeatAt && now - w.lastHeartbeatAt.getTime() < WORKER_STALE_MS,
  );
  layers.push({
    layer: 'WORKER',
    label: 'Worker',
    state: liveWorkers.length > 0 ? 'HEALTHY' : workers.length > 0 ? 'DOWN' : 'UNKNOWN',
    message:
      liveWorkers.length > 0
        ? `${liveWorkers.length} worker(s) online`
        : workers.length > 0
          ? 'No heartbeat received recently — the worker process may have stopped'
          : 'No worker has ever registered. Start it with `pnpm worker:dev`.',
  });

  // --- WhatsApp ---
  const connectionWhere = tenantId ? { tenantId } : {};
  const connections = await prisma.whatsAppConnection.findMany({
    where: connectionWhere,
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });
  const ready = connections.filter((c) => c.status === 'READY');
  const connecting = connections.filter((c) =>
    ['CONNECTING', 'RECONNECTING', 'AUTHENTICATED', 'QR_REQUIRED'].includes(c.status),
  );

  layers.push({
    layer: 'WHATSAPP',
    label: 'WhatsApp',
    state:
      ready.length > 0
        ? 'HEALTHY'
        : connecting.length > 0
          ? 'DEGRADED'
          : connections.length > 0
            ? 'DOWN'
            : 'UNKNOWN',
    message:
      ready.length > 0
        ? `${ready.length} connection(s) ready`
        : connecting.length > 0
          ? `${connecting[0].status.replace('_', ' ').toLowerCase()}`
          : connections.length > 0
            ? 'Disconnected — automation processing is waiting for a connection'
            : 'No WhatsApp connection has been set up yet',
  });

  // --- Group listener ---
  const monitoredGroups = await prisma.whatsAppGroup.count({ where: { ...connectionWhere, isMonitored: true } });
  const recentMessage = await prisma.message.findFirst({
    where: connectionWhere,
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true },
  });
  layers.push({
    layer: 'GROUP_LISTENER',
    label: 'Group Listener',
    state: monitoredGroups > 0 ? (ready.length > 0 ? 'HEALTHY' : 'DEGRADED') : 'UNKNOWN',
    message:
      monitoredGroups > 0
        ? `${monitoredGroups} group(s) monitored${recentMessage ? `, last message ${describeAge(now - recentMessage.receivedAt.getTime())}` : ''}`
        : 'No groups are being monitored yet',
  });

  // --- Queue (in-process; depth approximated by messages awaiting processing) ---
  const pending = await prisma.message.count({
    where: { ...connectionWhere, status: { in: ['PENDING', 'PROCESSING'] } },
  });
  layers.push({
    layer: 'QUEUE',
    label: 'Message Queue',
    state: pending > 1_000 ? 'DEGRADED' : 'HEALTHY',
    message: pending === 0 ? 'Empty' : `${pending} message(s) awaiting processing`,
  });

  // --- AI ---
  const providerStatus = getProviderStatus();
  const recentFailures = await prisma.aIUsage.count({
    where: { ...connectionWhere, success: false, createdAt: { gte: new Date(now - 3_600_000) } },
  });
  layers.push({
    layer: 'AI',
    label: 'AI Processor',
    state: recentFailures > 10 ? 'DEGRADED' : 'HEALTHY',
    message: providerStatus.usingFallback
      ? `No API key for "${providerStatus.configured}" — using the built-in rule-based provider`
      : `${providerStatus.active} · ${providerStatus.model}${recentFailures > 0 ? ` · ${recentFailures} failure(s) in the last hour` : ''}`,
  });

  // --- Workflow ---
  const failedRuns = await prisma.workflowRun.count({
    where: { ...connectionWhere, status: 'FAILED', queuedAt: { gte: new Date(now - 86_400_000) } },
  });
  layers.push({
    layer: 'WORKFLOW',
    label: 'Workflow Engine',
    state: failedRuns > 5 ? 'DEGRADED' : 'HEALTHY',
    message: failedRuns === 0 ? 'No failures in the last 24 hours' : `${failedRuns} failed run(s) in 24 hours`,
  });

  // --- Outputs ---
  const badOutputs = await prisma.output.count({
    where: { ...connectionWhere, status: { in: ['FAILED', 'CONFLICT', 'DISCONNECTED'] } },
  });
  const totalOutputs = await prisma.output.count({ where: connectionWhere });
  layers.push({
    layer: 'OUTPUT',
    label: 'Output Connectors',
    state: badOutputs > 0 ? 'DEGRADED' : totalOutputs > 0 ? 'HEALTHY' : 'UNKNOWN',
    message:
      badOutputs > 0
        ? `${badOutputs} output(s) need attention`
        : totalOutputs > 0
          ? `${totalOutputs} output(s) healthy`
          : 'No outputs configured yet',
  });

  return { overall: worst(layers), layers, checkedAt: new Date().toISOString() };
}

function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
