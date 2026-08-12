import { z } from 'zod';

/**
 * Environment parsing.
 *
 * Deliberately lenient about *missing optional integrations* and strict about
 * things that would silently corrupt data if wrong. A missing GOOGLE_CLIENT_ID
 * degrades the Sheets connector to mock mode; a malformed DATABASE_URL is fatal.
 */

const optionalString = z.string().trim().optional().default('');

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: optionalString,

  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  AI_PROVIDER: z.enum(['openai', 'gemini', 'anthropic', 'mock']).default('mock'),
  OPENAI_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_MODEL: z.string().default('gpt-4o'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  WHATSAPP_WORKER_URL: z.string().default('http://localhost:4000'),
  WHATSAPP_WORKER_SECRET: z.string().min(1, 'WHATSAPP_WORKER_SECRET is required'),

  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  WEBHOOK_SECRET: optionalString,

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Test/CI fallbacks. Real deployments always supply these; without the fallback
 * a `pnpm test` or `next build` on a machine with no .env would fail at import
 * time rather than at the point of actual use.
 */
function withFallbacks(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const isNonProd = raw.NODE_ENV !== 'production';
  if (!isNonProd) return raw;
  return {
    ...raw,
    DATABASE_URL: raw.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/msgflow',
    AUTH_SECRET: raw.AUTH_SECRET || 'dev-only-auth-secret-not-for-production-use',
    WHATSAPP_WORKER_SECRET: raw.WHATSAPP_WORKER_SECRET || 'dev-only-worker-secret',
    ENCRYPTION_KEY: raw.ENCRYPTION_KEY || 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=',
  };
}

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(withFallbacks(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset cache — used by tests that mutate process.env. */
export function resetEnvCache(): void {
  cached = null;
}

/** Whether a given AI provider has usable credentials configured. */
export function isAiProviderConfigured(provider: ServerEnv['AI_PROVIDER'], env = getEnv()): boolean {
  switch (provider) {
    case 'openai':
      return env.OPENAI_API_KEY.length > 0;
    case 'gemini':
      return env.GEMINI_API_KEY.length > 0;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY.length > 0;
    case 'mock':
      return true;
  }
}

export function isGoogleConfigured(env = getEnv()): boolean {
  return env.GOOGLE_CLIENT_ID.length > 0 && env.GOOGLE_CLIENT_SECRET.length > 0;
}
