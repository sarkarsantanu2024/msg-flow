/**
 * Application error taxonomy.
 *
 * Two audiences per error: a `message` safe to render to a user, and `detail`
 * for the logs. Route handlers translate AppError into a status code; anything
 * else becomes a generic 500 so internals never leak through an API response.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'WORKER_UNAVAILABLE'
  | 'WHATSAPP_DISCONNECTED'
  | 'AI_FAILED'
  | 'AI_NOT_CONFIGURED'
  | 'INTEGRATION_NOT_CONFIGURED'
  | 'EXCEL_FAILED'
  | 'SHEETS_FAILED'
  | 'WEBHOOK_FAILED'
  | 'API_FAILED'
  | 'SYNC_CONFLICT'
  | 'DATABASE_FAILED'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  WORKER_UNAVAILABLE: 503,
  WHATSAPP_DISCONNECTED: 503,
  AI_FAILED: 502,
  AI_NOT_CONFIGURED: 400,
  INTEGRATION_NOT_CONFIGURED: 400,
  EXCEL_FAILED: 500,
  SHEETS_FAILED: 502,
  WEBHOOK_FAILED: 502,
  API_FAILED: 502,
  SYNC_CONFLICT: 409,
  DATABASE_FAILED: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: unknown;
  /** Whether a caller may safely retry this operation. */
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: { detail?: unknown; retryable?: boolean } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = options.detail;
    this.retryable =
      options.retryable ??
      ['RATE_LIMITED', 'WORKER_UNAVAILABLE', 'AI_FAILED', 'WEBHOOK_FAILED', 'API_FAILED', 'DATABASE_FAILED'].includes(
        code,
      );
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** User-facing copy for each error code, used by the UI's error states. */
export const ERROR_COPY: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find what you were looking for.',
  VALIDATION_FAILED: 'Some of the information provided is not valid.',
  CONFLICT: 'That change conflicts with the current state. Refresh and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  WORKER_UNAVAILABLE: 'The WhatsApp worker is offline. Start it and try again.',
  WHATSAPP_DISCONNECTED: 'WhatsApp is not connected. Reconnect from the WhatsApp page.',
  AI_FAILED: 'The AI provider could not process this request. It will be retried.',
  AI_NOT_CONFIGURED: 'No AI provider is configured. Add an API key in Settings.',
  INTEGRATION_NOT_CONFIGURED: 'This integration needs credentials before it can be used.',
  EXCEL_FAILED: 'The spreadsheet could not be written. The previous version is unchanged.',
  SHEETS_FAILED: 'Google Sheets rejected the request. Check the connection and try again.',
  WEBHOOK_FAILED: 'The webhook endpoint did not accept the request.',
  API_FAILED: 'The destination API returned an error.',
  SYNC_CONFLICT: 'The output file has changed since the last synchronization.',
  DATABASE_FAILED: 'The database is unreachable. Please try again shortly.',
  INTERNAL: 'Something went wrong on our side. The team has been notified.',
};
