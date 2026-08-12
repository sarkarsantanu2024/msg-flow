import { getEnv } from '@msgflow/config';
import { safeCompare } from '@msgflow/db';
import { AppError } from '@msgflow/types';

/**
 * Shared-secret authentication for the worker → web direction.
 *
 * The worker is a trusted first-party service, not a user, so it presents a
 * bearer secret rather than a session. Compared in constant time: a byte-by-byte
 * early-exit comparison leaks the secret to anyone who can measure response
 * timing across enough requests.
 */
export function requireWorkerAuth(request: Request): void {
  const env = getEnv();
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : request.headers.get('x-worker-secret') ?? '';

  if (!provided || !safeCompare(provided, env.WHATSAPP_WORKER_SECRET)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid worker credentials.');
  }
}

/** Call the worker's control API. */
export async function callWorker(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);

  try {
    const response = await fetch(`${env.WHATSAPP_WORKER_URL.replace(/\/+$/, '')}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.WHATSAPP_WORKER_SECRET}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new AppError(
        'WORKER_UNAVAILABLE',
        (json as { error?: string } | null)?.error ?? `The worker returned HTTP ${response.status}.`,
      );
    }

    return json;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AppError('WORKER_UNAVAILABLE', 'The WhatsApp worker did not respond in time.');
    }
    throw new AppError(
      'WORKER_UNAVAILABLE',
      'The WhatsApp worker is not reachable. Start it with `pnpm worker:dev` and check WHATSAPP_WORKER_URL.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
