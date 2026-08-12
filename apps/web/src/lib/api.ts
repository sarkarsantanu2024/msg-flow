import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RATE_LIMITS } from '@msgflow/config';
import { createLogger, describeError } from '@msgflow/logger';
import { AppError, isAppError } from '@msgflow/types';
import { fieldErrors } from '@msgflow/validation';

const log = createLogger('api');

/**
 * Route-handler plumbing: consistent JSON shapes, error translation and rate
 * limiting. Unknown errors always become a generic 500 so internal details
 * (SQL text, file paths, stack traces) never reach a client.
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function fail(error: AppError, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: { ...error.toJSON().error, ...extra } }, { status: error.status });
}

export function handleError(err: unknown, context?: Record<string, unknown>): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some of the information provided is not valid.',
          fields: fieldErrors(err),
          retryable: false,
        },
      },
      { status: 422 },
    );
  }

  if (isAppError(err)) {
    // Client mistakes are noise at error level; server-side failures are not.
    if (err.status >= 500) {
      log.error('Request failed', { ...context, code: err.code, message: err.message, detail: err.detail });
    } else {
      log.warn('Request rejected', { ...context, code: err.code, message: err.message });
    }
    return fail(err);
  }

  // Prisma unique-constraint violations are a conflict, not a crash.
  const prismaCode = (err as { code?: string }).code;
  if (prismaCode === 'P2002') {
    return fail(new AppError('CONFLICT', 'That record already exists.'));
  }
  if (prismaCode === 'P2025') {
    return fail(new AppError('NOT_FOUND', 'That record no longer exists.'));
  }
  if (prismaCode === 'P1001' || prismaCode === 'P1017') {
    return fail(new AppError('DATABASE_FAILED', 'The database is unreachable. Please try again shortly.'));
  }

  log.error('Unhandled request error', { ...context, ...describeError(err) });
  return fail(new AppError('INTERNAL', 'Something went wrong on our side.'));
}

/** Wrap a route handler with uniform error handling. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return handleError(err);
    }
  };
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Adequate for a single instance and for local development. A multi-instance
 * deployment needs a shared store (Redis/Upstash) — noted in docs/security.md
 * rather than silently pretending this is distributed.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  preset: keyof typeof RATE_LIMITS = 'api',
): { allowed: boolean; remaining: number; resetAt: number } {
  const { limit, windowMs } = RATE_LIMITS[preset];
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  bucket.count++;
  const allowed = bucket.count <= limit;
  return { allowed, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function enforceRateLimit(key: string, preset: keyof typeof RATE_LIMITS = 'api'): void {
  const result = rateLimit(key, preset);
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {
      detail: { resetAt: result.resetAt },
    });
  }
}

/** Periodically drop expired buckets so the map cannot grow without bound. */
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  // Do not hold the process open in short-lived server environments.
  if (typeof timer === 'object' && 'unref' in timer) (timer as NodeJS.Timeout).unref();
}

/** Parse a JSON body, turning malformed input into a clean 422. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', 'The request body was not valid JSON.');
  }
}
