/**
 * Per-million-token pricing used for the Usage screen.
 *
 * These are estimates for internal cost display, not billing. They are kept in
 * one place so a price change is a one-line edit, and the UI labels the figure
 * as estimated rather than implying it is an invoice.
 */
interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  'claude-opus-5': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-4-5-20251001': { inputPerMillion: 1, outputPerMillion: 5 },
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  // Google
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
};

const FALLBACK: ModelPrice = { inputPerMillion: 3, outputPerMillion: 15 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model] ?? findByPrefix(model) ?? FALLBACK;
  const cost =
    (inputTokens / 1_000_000) * price.inputPerMillion + (outputTokens / 1_000_000) * price.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function findByPrefix(model: string): ModelPrice | undefined {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k) || k.startsWith(model));
  return key ? PRICES[key] : undefined;
}

/**
 * Rough token estimate for providers that do not report usage.
 * ~4 characters per token is close enough for a cost display.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
