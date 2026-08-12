/** Default tenant timezone (spec §97). Configurable per tenant. */
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** A worker is considered dead after this many missed heartbeats. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_MISSED_THRESHOLD = 3;
export const WORKER_STALE_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISSED_THRESHOLD;

/** Dashboard live-status poll interval. */
export const STATUS_POLL_INTERVAL_MS = 10_000;

/** Below this AI confidence, extractions go to the review queue instead of outputs. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Default pagination size across dashboard tables. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/** Guard against a runaway automation burning tokens on a huge backlog. */
export const MAX_MESSAGES_PER_RUN = 500;

/** Default retry policy for output actions. */
export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  backoff: 'exponential' as const,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
};

export const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

/** Rate limits (requests per window) for the public-facing API surface. */
export const RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60_000 },
  api: { limit: 120, windowMs: 60_000 },
  ingest: { limit: 1_000, windowMs: 60_000 },
  ai: { limit: 60, windowMs: 60_000 },
};

/**
 * Excel features that survive a load/save cycle, and those that do not.
 * Surfaced in the UI before an automation is activated (spec §126) — an honest
 * warning is worth more than a blanket promise we cannot keep.
 */
export const EXCEL_PRESERVED_FEATURES = [
  'Cell formulas',
  'Number and date formats',
  'Fonts, fills and borders',
  'Merged cell ranges',
  'Named ranges',
  'Column widths and row heights',
  'Multiple worksheets (including hidden)',
  'Data validation rules',
];

export const EXCEL_AT_RISK_FEATURES = [
  'Pivot tables (not recalculated; refresh in Excel after sync)',
  'Charts bound to ranges that shift when rows are inserted',
  'VBA macros (.xlsm is not supported — save as .xlsx)',
  'Some conditional-formatting rule types',
  'Slicers and timelines',
];
