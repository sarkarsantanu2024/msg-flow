import { getEnv } from '@msgflow/config';
import { createLogger } from '@msgflow/logger';
import type { AIProvider } from '@msgflow/types';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { MockProvider } from './providers/mock.js';

const log = createLogger('ai');

export type ProviderName = 'openai' | 'gemini' | 'anthropic' | 'mock';

let cached: AIProvider | null = null;
let cachedName: string | null = null;

/**
 * Resolve the configured AI provider.
 *
 * Falls back to the mock when the selected provider has no API key. That is
 * deliberate: a missing key should degrade the product to rule-based extraction
 * (and say so in the UI), not take message processing down entirely.
 */
export function getAIProvider(override?: ProviderName): AIProvider {
  const env = getEnv();
  const name = override ?? env.AI_PROVIDER;

  if (cached && cachedName === name) return cached;

  const provider = buildProvider(name, env);

  if (!provider.isConfigured) {
    log.warn('Selected AI provider is not configured; falling back to rule-based mock provider', {
      requested: name,
    });
    cached = new MockProvider();
    cachedName = name;
    return cached;
  }

  cached = provider;
  cachedName = name;
  return provider;
}

function buildProvider(name: ProviderName, env: ReturnType<typeof getEnv>): AIProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
    case 'openai':
      return new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
    case 'gemini':
      return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
    case 'mock':
    default:
      return new MockProvider();
  }
}

/** Clear the cache — used after settings change, and by tests. */
export function resetProviderCache(): void {
  cached = null;
  cachedName = null;
}

export interface ProviderStatusInfo {
  configured: ProviderName | null;
  active: ProviderName;
  usingFallback: boolean;
  model: string;
  available: Array<{ name: ProviderName; configured: boolean }>;
}

/** Powers the AI health indicator and the Settings screen. */
export function getProviderStatus(): ProviderStatusInfo {
  const env = getEnv();
  const active = getAIProvider();
  return {
    configured: env.AI_PROVIDER,
    active: active.name,
    usingFallback: active.name === 'mock' && env.AI_PROVIDER !== 'mock',
    model: active.model,
    available: [
      { name: 'anthropic', configured: env.ANTHROPIC_API_KEY.length > 0 },
      { name: 'openai', configured: env.OPENAI_API_KEY.length > 0 },
      { name: 'gemini', configured: env.GEMINI_API_KEY.length > 0 },
      { name: 'mock', configured: true },
    ],
  };
}

/**
 * Run an AI call with bounded retries.
 *
 * Only retries what is actually retryable — a malformed request repeated three
 * times is three times the cost and the same failure.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; initialDelayMs?: number; label?: string } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelay = options.initialDelayMs ?? 1_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const retryable = (err as { retryable?: boolean }).retryable === true;
      if (!retryable || attempt === maxAttempts) break;

      const delay = initialDelay * 2 ** (attempt - 1);
      log.warn('AI call failed; retrying', {
        label: options.label,
        attempt,
        maxAttempts,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
