import { createHmac } from 'node:crypto';
import { getEnv } from '@msgflow/config';
import { createLogger } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import type { OutputConnector, SyncContext, SyncOutcome, SyncRow, SyncRowOutcome } from '@msgflow/types';

const log = createLogger('connector:webhook');

/**
 * Webhook connector.
 *
 * Signs every payload with HMAC-SHA256 over `{timestamp}.{body}` so receivers
 * can verify origin and reject replays. The timestamp is inside the signed
 * material deliberately — signing only the body lets an attacker replay a
 * captured request forever.
 */

interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  batch?: boolean;
  timeoutMs?: number;
  signPayload?: boolean;
}

export function signPayload(body: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function post(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  secret: string,
  sign: boolean,
): Promise<{ ok: boolean; status: number; text: string }> {
  const serialized = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  const finalHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'MsgFlow/1.0',
    ...headers,
  };

  if (sign && secret) {
    finalHeaders['x-msgflow-timestamp'] = String(timestamp);
    finalHeaders['x-msgflow-signature'] = `sha256=${signPayload(serialized, secret, timestamp)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: serialized,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, text: text.slice(0, 500) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AppError('WEBHOOK_FAILED', `The webhook did not respond within ${timeoutMs}ms.`, {
        retryable: true,
      });
    }
    throw new AppError('WEBHOOK_FAILED', `The webhook request failed: ${(err as Error).message}`, {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class WebhookConnector implements OutputConnector {
  readonly type = 'WEBHOOK';

  isConfigured(context: SyncContext): boolean {
    return typeof (context.config as unknown as WebhookConfig).url === 'string';
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const config = context.config as unknown as WebhookConfig;
    if (!config.url) {
      throw new AppError('INTEGRATION_NOT_CONFIGURED', 'This webhook output has no URL configured.');
    }

    const env = getEnv();
    const method = config.method ?? 'POST';
    const timeoutMs = config.timeoutMs ?? 30_000;
    const sign = config.signPayload !== false;
    const headers = { ...(config.headers ?? {}) };

    const outcomes: SyncRowOutcome[] = [];
    let created = 0;
    let failed = 0;

    if (context.dryRun) {
      return {
        status: 'SUCCESS',
        created: rows.length,
        updated: 0,
        skipped: 0,
        failed: 0,
        rows: rows.map((r) => ({ recordId: r.recordId, action: 'created' as const })),
        warnings: [`Dry run — ${rows.length} row(s) would be posted to ${config.url}.`],
      };
    }

    if (config.batch !== false) {
      // One request carrying every row. Partial failure is not expressible over
      // a batch webhook, so all rows share the outcome.
      const body = {
        event: 'msgflow.records.sync',
        operation: context.operation,
        outputId: context.outputId,
        count: rows.length,
        records: rows.map((r) => ({ recordId: r.recordId, key: r.keyValue, data: r.values })),
      };

      const result = await post(config.url, method, headers, body, timeoutMs, env.WEBHOOK_SECRET, sign);
      if (!result.ok) {
        return {
          status: 'FAILED',
          created: 0,
          updated: 0,
          skipped: 0,
          failed: rows.length,
          rows: rows.map((r) => ({
            recordId: r.recordId,
            action: 'failed' as const,
            error: `HTTP ${result.status}: ${result.text}`,
          })),
          warnings: [],
          error: `The webhook returned HTTP ${result.status}.`,
        };
      }

      return {
        status: 'SUCCESS',
        created: rows.length,
        updated: 0,
        skipped: 0,
        failed: 0,
        rows: rows.map((r) => ({ recordId: r.recordId, action: 'created' as const })),
        warnings: [],
      };
    }

    for (const row of rows) {
      try {
        const result = await post(
          config.url,
          method,
          headers,
          { event: 'msgflow.record.sync', recordId: row.recordId, key: row.keyValue, data: row.values },
          timeoutMs,
          env.WEBHOOK_SECRET,
          sign,
        );
        if (result.ok) {
          created++;
          outcomes.push({ recordId: row.recordId, action: 'created' });
        } else {
          failed++;
          outcomes.push({
            recordId: row.recordId,
            action: 'failed',
            error: `HTTP ${result.status}: ${result.text}`,
          });
        }
      } catch (err) {
        failed++;
        outcomes.push({
          recordId: row.recordId,
          action: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info('Webhook sync complete', { outputId: context.outputId, created, failed });

    return {
      status: failed === 0 ? 'SUCCESS' : created > 0 ? 'PARTIAL_SUCCESS' : 'FAILED',
      created,
      updated: 0,
      skipped: 0,
      failed,
      rows: outcomes,
      warnings: [],
    };
  }
}

export const webhookConnector = new WebhookConnector();
