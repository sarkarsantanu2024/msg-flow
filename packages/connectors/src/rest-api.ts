import { createLogger } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import type { OutputConnector, SyncContext, SyncOutcome, SyncRow, SyncRowOutcome } from '@msgflow/types';
import { buildApiPayload, interpolatePath } from './mapping.js';

const log = createLogger('connector:rest');

/**
 * Configurable REST API connector — the "update the client's own system" path.
 *
 * Deliberate constraint: DELETE is never issued. Destructive operations against
 * a client's production database must be an explicit, human-configured workflow,
 * never something an extraction can trigger. `allowDelete` lives on the Output
 * row and is checked by the workflow engine before this connector is even
 * reached.
 */

interface RestConfig {
  baseUrl: string;
  createPath?: string;
  updatePath?: string;
  lookupPath?: string;
  createMethod?: 'POST' | 'PUT' | 'PATCH';
  updateMethod?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  bodyWrapper?: string;
  idPath?: string;
  timeoutMs?: number;
}

interface RestCredentials {
  type?: 'API_KEY' | 'BEARER_TOKEN' | 'BASIC_AUTH' | 'NONE';
  apiKey?: string;
  headerName?: string;
  token?: string;
  username?: string;
  password?: string;
}

function authHeaders(credentials: RestCredentials | undefined): Record<string, string> {
  if (!credentials) return {};
  switch (credentials.type) {
    case 'BEARER_TOKEN':
      return credentials.token ? { authorization: `Bearer ${credentials.token}` } : {};
    case 'API_KEY':
      return credentials.apiKey ? { [credentials.headerName || 'x-api-key']: credentials.apiKey } : {};
    case 'BASIC_AUTH': {
      if (!credentials.username) return {};
      const encoded = Buffer.from(`${credentials.username}:${credentials.password ?? ''}`).toString('base64');
      return { authorization: `Basic ${encoded}` };
    }
    default:
      return {};
  }
}

/** Read a nested value like "data.id" from a response body. */
export function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      const idx = Number(key);
      return Number.isInteger(idx) ? acc[idx] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function request(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown | undefined,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, text: text.slice(0, 500) };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AppError('API_FAILED', `The API did not respond within ${timeoutMs}ms.`, { retryable: true });
    }
    throw new AppError('API_FAILED', `The API request failed: ${(err as Error).message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

export class RestApiConnector implements OutputConnector {
  readonly type = 'REST_API';

  isConfigured(context: SyncContext): boolean {
    return typeof (context.config as unknown as RestConfig).baseUrl === 'string';
  }

  async sync(rows: SyncRow[], context: SyncContext): Promise<SyncOutcome> {
    const config = context.config as unknown as RestConfig;
    if (!config.baseUrl) {
      throw new AppError('INTEGRATION_NOT_CONFIGURED', 'This API output has no base URL configured.');
    }

    const credentials = context.credentials as RestCredentials | undefined;
    const headers = { ...(config.headers ?? {}), ...authHeaders(credentials) };
    const timeoutMs = config.timeoutMs ?? 30_000;
    const idPath = config.idPath ?? 'id';

    const outcomes: SyncRowOutcome[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    const insertOnly = ['CREATE_NEW', 'APPEND', 'REPLACE', 'GENERATE_NEW_VERSION'].includes(context.operation);

    for (const row of rows) {
      try {
        if (context.dryRun) {
          skipped++;
          outcomes.push({ recordId: row.recordId, action: 'skipped', reason: 'Dry run' });
          continue;
        }

        let externalId = row.externalRowId;

        // Look the record up when we do not already own an id and the target
        // exposes a lookup endpoint.
        if (!externalId && !insertOnly && config.lookupPath) {
          const lookupUrl = joinUrl(config.baseUrl, interpolatePath(config.lookupPath, row));
          const lookup = await request(lookupUrl, 'GET', headers, undefined, timeoutMs);
          if (lookup.ok && lookup.json) {
            const found = readPath(lookup.json, idPath);
            if (found !== undefined && found !== null) externalId = String(found);
          }
        }

        const shouldUpdate = Boolean(externalId) && !insertOnly;

        if (shouldUpdate) {
          const url = joinUrl(
            config.baseUrl,
            interpolatePath(config.updatePath ?? '/{id}', { ...row, externalRowId: externalId }),
          );
          const result = await request(
            url,
            config.updateMethod ?? 'PUT',
            headers,
            buildApiPayload(row, config.bodyWrapper),
            timeoutMs,
          );
          if (!result.ok) {
            failed++;
            outcomes.push({
              recordId: row.recordId,
              action: 'failed',
              error: `HTTP ${result.status}: ${result.text}`,
            });
            continue;
          }
          updated++;
          outcomes.push({
            recordId: row.recordId,
            action: 'updated',
            externalRowId: externalId,
            externalRecordId: externalId,
          });
          continue;
        }

        if (context.operation === 'UPDATE_EXISTING') {
          failed++;
          outcomes.push({
            recordId: row.recordId,
            action: 'failed',
            error: 'No existing resource was found and UPDATE_EXISTING does not create new ones.',
          });
          continue;
        }

        const url = joinUrl(config.baseUrl, interpolatePath(config.createPath ?? '/', row));
        const result = await request(
          url,
          config.createMethod ?? 'POST',
          headers,
          buildApiPayload(row, config.bodyWrapper),
          timeoutMs,
        );
        if (!result.ok) {
          failed++;
          outcomes.push({
            recordId: row.recordId,
            action: 'failed',
            error: `HTTP ${result.status}: ${result.text}`,
          });
          continue;
        }

        const newId = result.json ? readPath(result.json, idPath) : null;
        created++;
        outcomes.push({
          recordId: row.recordId,
          action: 'created',
          externalRowId: newId === null || newId === undefined ? null : String(newId),
          externalRecordId: newId === null || newId === undefined ? null : String(newId),
        });
      } catch (err) {
        failed++;
        outcomes.push({
          recordId: row.recordId,
          action: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info('REST API sync complete', { outputId: context.outputId, created, updated, failed });

    return {
      status: failed === 0 ? 'SUCCESS' : created + updated > 0 ? 'PARTIAL_SUCCESS' : 'FAILED',
      created,
      updated,
      skipped,
      failed,
      rows: outcomes,
      warnings: [],
    };
  }
}

export const restApiConnector = new RestApiConnector();
