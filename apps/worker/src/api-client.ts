import { createLogger, describeError } from '@msgflow/logger';
import type { IngestResult, NormalizedMessage, ProviderConnectionState, ProviderGroup } from '@msgflow/types';
import { config } from './config.js';

const log = createLogger('worker:api');

/**
 * Client for the web app's worker API.
 *
 * Every call is retried on transient failure, because a Vercel cold start or a
 * brief network blip must not lose a captured message. Messages that cannot be
 * delivered are buffered by the caller and retried on the next flush.
 */

async function post<T>(path: string, body: unknown, attempts = 3): Promise<T> {
  const url = `${config.APP_URL.replace(/\/+$/, '')}${path}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: path.includes('/connection') && body && (body as { groups?: unknown }).groups ? 'PUT' : 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.WHATSAPP_WORKER_SECRET}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      const json = text ? JSON.parse(text) : null;

      if (!response.ok) {
        // 4xx means we sent something wrong — retrying will not help.
        if (response.status >= 400 && response.status < 500) {
          throw new Error(
            `HTTP ${response.status}: ${(json as { error?: { message?: string } })?.error?.message ?? text.slice(0, 200)}`,
          );
        }
        throw Object.assign(new Error(`HTTP ${response.status}`), { retryable: true });
      }

      return (json as { data: T }).data;
    } catch (err) {
      lastError = err;
      const retryable = (err as { retryable?: boolean }).retryable === true || (err as Error).name === 'AbortError';
      if (!retryable || attempt === attempts) break;

      const delay = 1_000 * 2 ** (attempt - 1);
      log.warn('API call failed; retrying', { path, attempt, delayMs: delay, ...describeError(err) });
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

export async function sendHeartbeat(payload: {
  workerName: string;
  hostname: string;
  pid: number;
  version: string;
  capabilities: string[];
  status: 'STARTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  cpuPercent?: number;
  memoryMb?: number;
  uptimeSec?: number;
  connections: number;
  messagesSeen: number;
  queueDepth: number;
}): Promise<void> {
  await post('/api/worker/heartbeat', payload, 2);
}

export async function reportConnectionState(payload: {
  tenantId: string;
  connectionId: string;
  state: ProviderConnectionState;
  phoneNumber?: string | null;
  displayName?: string | null;
  qrCode?: string | null;
  lastError?: string | null;
}): Promise<void> {
  await post('/api/worker/connection', { ...payload, workerName: config.WORKER_NAME });
}

export async function syncGroups(
  tenantId: string,
  connectionId: string,
  groups: ProviderGroup[],
): Promise<{ synced: number }> {
  return post('/api/worker/connection', { tenantId, connectionId, groups });
}

export async function sendMessages(
  tenantId: string,
  connectionId: string,
  messages: NormalizedMessage[],
  source: 'LIVE' | 'BACKLOG' = 'LIVE',
): Promise<IngestResult> {
  return post('/api/worker/messages', { tenantId, connectionId, source, messages });
}

/** Ask the app to run any automations that are due. */
export async function triggerScheduler(): Promise<{ due: number }> {
  return post('/api/cron/tick', {}, 1);
}
