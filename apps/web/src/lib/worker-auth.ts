import { getEnv } from '@msgflow/config';
import { safeCompare } from '@msgflow/db';
import { AppError } from '@msgflow/types';
import { createLogger, describeError } from '@msgflow/logger';

const log = createLogger('worker-client');

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
    // The operator detail — which URL, which errno, which command to run — is a
    // deployment fact, not something the person using the product can act on.
    // It belongs in the server log; they get told what it means for them.
    log.error('Worker unreachable', {
      url: env.WHATSAPP_WORKER_URL,
      path,
      ...describeError(err),
    });
    // Deliberately not "try again in a moment": an unreachable worker is
    // usually a misconfigured or stopped service, not a blip, and telling
    // someone to retry something that will never succeed wastes their time.
    throw new AppError(
      'WORKER_UNAVAILABLE',
      'The WhatsApp service is not responding. If this keeps happening, ask your administrator to check it.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
