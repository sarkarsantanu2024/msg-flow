import { getEnv } from '@msgflow/config';
import { safeCompare } from '@msgflow/db';
import { createLogger } from '@msgflow/logger';
import { AppError } from '@msgflow/types';
import { runDueAutomations } from '@msgflow/workflow';
import { ok, route } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const log = createLogger('cron');

/**
 * Scheduler tick.
 *
 * Runs every automation whose nextRunAt has passed. Driven by the worker's
 * internal ticker in a normal deployment, and callable by Vercel Cron or any
 * external scheduler — hence the shared-secret auth rather than a session.
 */
async function tick(request: Request) {
  const env = getEnv();
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  // Vercel Cron sends its own header; accept either credential.
  const isVercelCron = request.headers.get('x-vercel-cron') !== null;

  if (!isVercelCron && (!provided || !safeCompare(provided, env.WHATSAPP_WORKER_SECRET))) {
    throw new AppError('UNAUTHENTICATED', 'Invalid scheduler credentials.');
  }

  const started = Date.now();
  const result = await runDueAutomations();

  log.info('Scheduler tick complete', {
    due: result.ran,
    durationMs: Date.now() - started,
    succeeded: result.results.filter((r) => r.status === 'SUCCESS').length,
    failed: result.results.filter((r) => r.status === 'FAILED').length,
  });

  return ok({
    due: result.ran,
    durationMs: Date.now() - started,
    runs: result.results.map((r) => ({
      runId: r.runId,
      status: r.status,
      messagesProcessed: r.messagesProcessed,
      recordsCreated: r.recordsCreated,
      recordsUpdated: r.recordsUpdated,
    })),
  });
}

export const POST = route(tick);
export const GET = route(tick);
