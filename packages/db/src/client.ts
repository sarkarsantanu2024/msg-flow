import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton.
 *
 * Next.js dev mode reloads modules on every edit; without the global cache each
 * reload opens a fresh connection pool and Neon runs out of connections within
 * a few minutes of editing.
 */
const globalForPrisma = globalThis as unknown as { __msgflowPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__msgflowPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }]
        : [{ level: 'error', emit: 'stdout' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__msgflowPrisma = prisma;
}

export type Db = PrismaClient;

/** Liveness probe used by /api/health. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'Unknown database error',
    };
  }
}
