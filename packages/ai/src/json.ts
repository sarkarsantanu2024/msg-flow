import { AppError } from '@msgflow/types';

/**
 * Extract JSON from a model response.
 *
 * Models wrap JSON in prose and code fences no matter how firmly the prompt
 * says not to. Failing the whole extraction because of a ```json fence would
 * be a self-inflicted wound, so we strip the common wrappers and, as a last
 * resort, scan for the outermost balanced brace pair.
 */
export function parseJsonResponse<T = unknown>(raw: string): T {
  const text = raw.trim();
  if (!text) throw new AppError('AI_FAILED', 'The AI returned an empty response.');

  const candidates: string[] = [];

  // 1. Fenced block, with or without a language tag.
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // 2. The whole response.
  candidates.push(text);

  // 3. Outermost balanced object or array.
  const balanced = extractBalanced(text);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next candidate
    }
    try {
      return JSON.parse(repairJson(candidate)) as T;
    } catch {
      // try the next candidate
    }
  }

  throw new AppError('AI_FAILED', 'The AI response was not valid JSON.', {
    detail: { preview: text.slice(0, 500) },
    retryable: true,
  });
}

function extractBalanced(text: string): string | null {
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = text.indexOf(open);
    if (start === -1) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** Repair the two malformations that actually occur: trailing commas and NaN. */
function repairJson(text: string): string {
  return text
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/:\s*NaN/g, ': null')
    .replace(/:\s*Infinity/g, ': null')
    .replace(/:\s*undefined/g, ': null');
}

/** Clamp a model-supplied confidence into [0,1]; treat nonsense as 0.5. */
export function normalizeConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  // Models sometimes answer 85 when asked for 0.85.
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}
