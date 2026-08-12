/**
 * Structured JSON logger with secret redaction.
 *
 * No external dependency: this runs in the Next.js edge-adjacent runtime, in
 * Node workers, and in tests, and pino/winston each bring transport machinery
 * we do not need. JSON lines to stdout is what Railway/Render/Vercel ingest.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Keys whose values are replaced with `[redacted]` anywhere in a log payload.
 * Matched case-insensitively as a substring, so `whatsappWorkerSecret` and
 * `apiKey` both hit.
 */
const SECRET_KEY_PATTERNS = [
  'password',
  'passwordhash',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'sessionref',
  'encryptedpayload',
  'credential',
  'privatekey',
  'accesstoken',
  'refreshtoken',
  'qrcode',
];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((p) => k.includes(p));
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (['debug', 'info', 'warn', 'error'] as const).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : 'info';
}

function write(level: LogLevel, scope: string, bindings: LogContext, message: string, context?: LogContext) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(redact({ ...bindings, ...context }) as LogContext),
  };

  const line = JSON.stringify(entry);
  // eslint-disable-next-line no-console
  if (level === 'error') console.error(line);
  // eslint-disable-next-line no-console
  else if (level === 'warn') console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

export function createLogger(scope: string, bindings: LogContext = {}): Logger {
  return {
    debug: (m, c) => write('debug', scope, bindings, m, c),
    info: (m, c) => write('info', scope, bindings, m, c),
    warn: (m, c) => write('warn', scope, bindings, m, c),
    error: (m, c) => write('error', scope, bindings, m, c),
    child: (extra) => createLogger(scope, { ...bindings, ...extra }),
  };
}

export const logger = createLogger('msgflow');

/** Serialize an unknown thrown value into something loggable and user-safe. */
export function describeError(err: unknown): { message: string; stack?: string; code?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
      code: (err as { code?: string }).code,
    };
  }
  if (typeof err === 'string') return { message: err };
  return { message: JSON.stringify(err) };
}
