import os from 'node:os';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createLogger, describeError } from '@msgflow/logger';
import { config } from './config.js';
import { connectionManager } from './connection-manager.js';
import { sendHeartbeat, triggerScheduler } from './api-client.js';

/**
 * MsgFlow WhatsApp worker.
 *
 * A persistent Node service — deliberately NOT a serverless function, because
 * whatsapp-web.js drives a headless browser and holds a long-lived session that
 * cannot survive being frozen between invocations.
 *
 * Deploy to Railway, Render, Fly.io, a VPS or any Docker host. No Kubernetes.
 */

const log = createLogger('worker');
const VERSION = '1.0.0';

const app = express();
app.use(express.json({ limit: '2mb' }));

/** Shared-secret auth. The worker's control API is not publicly reachable. */
function requireSecret(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (provided !== config.WHATSAPP_WORKER_SECRET) {
    res.status(401).json({ error: 'Invalid worker credentials.' });
    return;
  }
  next();
}

app.get('/health', (_req, res) => {
  const connections = connectionManager.list();
  const ready = connections.filter((c) => c.state === 'READY').length;

  res.json({
    status: 'ok',
    version: VERSION,
    name: config.WORKER_NAME,
    uptimeSec: Math.round(process.uptime()),
    connections: connections.length,
    ready,
    queueDepth: connectionManager.queueDepth(),
  });
});

app.get('/connections', requireSecret, (_req, res) => {
  res.json({ connections: connectionManager.list() });
});

app.get('/connections/:id/status', requireSecret, (req, res) => {
  const status = connectionManager.getStatus(req.params.id);
  if (!status) {
    res.status(404).json({ error: 'That connection is not running on this worker.' });
    return;
  }
  res.json(status);
});

/**
 * Connection control. Called by the web app when a user presses Connect,
 * Reconnect, Disconnect, Logout, Refresh QR or Sync groups.
 */
app.post('/connections/:id/:action', requireSecret, (req, res) => {
  void (async () => {
    const connectionId = req.params.id;
    const action = req.params.action;
    const tenantId = (req.body as { tenantId?: string })?.tenantId;

    if (!tenantId) {
      res.status(400).json({ error: 'tenantId is required.' });
      return;
    }

    log.info('Connection action requested', { connectionId, action, tenantId });

    try {
      switch (action) {
        case 'connect':
          // Do not await: initialize() can take 30+ seconds while Chromium
          // boots, and the HTTP caller should not block on it. Progress is
          // reported back through connection-state callbacks.
          void connectionManager.connect(tenantId, connectionId).catch((err) => {
            log.error('Connect failed', { connectionId, ...describeError(err) });
          });
          res.json({ accepted: true, action, note: 'Starting session; watch the connection status for the QR code.' });
          return;

        case 'reconnect':
          void connectionManager.reconnect(tenantId, connectionId).catch((err) => {
            log.error('Reconnect failed', { connectionId, ...describeError(err) });
          });
          res.json({ accepted: true, action });
          return;

        case 'refresh-qr':
          void connectionManager.refreshQr(tenantId, connectionId).catch((err) => {
            log.error('QR refresh failed', { connectionId, ...describeError(err) });
          });
          res.json({ accepted: true, action });
          return;

        case 'disconnect':
          await connectionManager.disconnect(connectionId);
          res.json({ accepted: true, action });
          return;

        case 'logout':
          await connectionManager.logout(connectionId);
          res.json({ accepted: true, action });
          return;

        case 'sync-groups': {
          const result = await connectionManager.syncGroups(tenantId, connectionId);
          res.json({ accepted: true, action, ...result });
          return;
        }

        default:
          res.status(400).json({ error: `Unknown action "${action}".` });
      }
    } catch (err) {
      const detail = describeError(err);
      log.error('Connection action failed', { connectionId, action, ...detail });
      res.status(500).json({ error: detail.message });
    }
  })();
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error('Unhandled worker error', describeError(err));
  res.status(500).json({ error: 'Internal worker error.' });
});

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

let previousCpu = process.cpuUsage();
let previousCpuAt = Date.now();

function cpuPercent(): number {
  const current = process.cpuUsage();
  const now = Date.now();
  const elapsedMs = now - previousCpuAt;
  if (elapsedMs <= 0) return 0;

  const userDelta = current.user - previousCpu.user;
  const systemDelta = current.system - previousCpu.system;
  previousCpu = current;
  previousCpuAt = now;

  // cpuUsage is in microseconds; normalise against wall-clock time.
  return Math.min(100, ((userDelta + systemDelta) / 1_000 / elapsedMs) * 100);
}

async function heartbeat(): Promise<void> {
  const connections = connectionManager.list();
  const ready = connections.filter((c) => c.state === 'READY').length;
  const degraded = connections.length > 0 && ready === 0;

  try {
    await sendHeartbeat({
      workerName: config.WORKER_NAME,
      hostname: os.hostname(),
      pid: process.pid,
      version: VERSION,
      capabilities: ['whatsapp', 'ingest'],
      status: degraded ? 'DEGRADED' : 'ONLINE',
      cpuPercent: cpuPercent(),
      memoryMb: process.memoryUsage().rss / 1024 / 1024,
      uptimeSec: Math.round(process.uptime()),
      connections: connections.length,
      messagesSeen: connectionManager.totalMessagesSeen(),
      queueDepth: connectionManager.queueDepth(),
    });
  } catch (err) {
    // A failed heartbeat is expected while the web app restarts. The dashboard
    // will show the worker as offline, which is the honest reading.
    log.warn('Heartbeat failed', describeError(err));
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

async function schedulerTick(): Promise<void> {
  if (!config.SCHEDULER_ENABLED) return;
  try {
    const result = await triggerScheduler();
    if (result.due > 0) log.info('Scheduler ran due automations', { due: result.due });
  } catch (err) {
    log.warn('Scheduler tick failed', describeError(err));
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const server = app.listen(config.WORKER_PORT, () => {
  log.info('MsgFlow worker started', {
    name: config.WORKER_NAME,
    port: config.WORKER_PORT,
    appUrl: config.APP_URL,
    sessionPath: config.WORKER_SESSION_PATH,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    headless: config.PUPPETEER_HEADLESS,
  });
});

void heartbeat();
// Resume WhatsApp sessions that were running before the last restart — a
// restart must never silently stop capture.
void connectionManager.resumeAll();
const heartbeatTimer = setInterval(() => void heartbeat(), config.HEARTBEAT_INTERVAL_MS);
const schedulerTimer = setInterval(() => void schedulerTick(), config.SCHEDULER_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  log.info('Shutting down', { signal });
  clearInterval(heartbeatTimer);
  clearInterval(schedulerTimer);

  // Report OFFLINE before exiting so the dashboard reflects an intentional
  // stop immediately rather than waiting for the heartbeat to go stale.
  await sendHeartbeat({
    workerName: config.WORKER_NAME,
    hostname: os.hostname(),
    pid: process.pid,
    version: VERSION,
    capabilities: ['whatsapp', 'ingest'],
    status: 'OFFLINE',
    connections: 0,
    messagesSeen: connectionManager.totalMessagesSeen(),
    queueDepth: connectionManager.queueDepth(),
  }).catch(() => undefined);

  await connectionManager.shutdown();
  server.close(() => process.exit(0));

  // Do not hang forever if a Chromium instance refuses to die.
  setTimeout(() => process.exit(0), 15_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', describeError(reason));
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', describeError(err));
  // Let the process manager restart us with a clean session rather than
  // continuing in an unknown state.
  void shutdown('uncaughtException');
});
