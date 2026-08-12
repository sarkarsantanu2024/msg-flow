import parser from 'cron-parser';
import { DEFAULT_TIMEZONE } from '@msgflow/config';
import { createLogger } from '@msgflow/logger';

const log = createLogger('workflow:schedule');

/**
 * Schedule computation.
 *
 * Automations describe their schedule in business terms ("daily at 23:00",
 * "Monday 09:00", "1st of the month at 02:00"). We translate that into a cron
 * expression once, and evaluate it in the tenant's timezone. Users who need
 * something unusual supply cron directly.
 */

export interface ScheduleSpec {
  processingMode: string;
  scheduleHour?: number;
  scheduleMinute?: number;
  scheduleWeekday?: number;
  scheduleDay?: number;
  cronExpression?: string | null;
  timezone?: string | null;
}

export function buildCronExpression(spec: ScheduleSpec): string | null {
  const minute = clamp(spec.scheduleMinute ?? 0, 0, 59);
  const hour = clamp(spec.scheduleHour ?? 23, 0, 23);

  switch (spec.processingMode) {
    case 'REAL_TIME':
    case 'MANUAL':
      return null;
    case 'DAILY':
      return `${minute} ${hour} * * *`;
    case 'WEEKLY':
      return `${minute} ${hour} * * ${clamp(spec.scheduleWeekday ?? 1, 0, 6)}`;
    case 'MONTHLY':
      // Capped at 28 so February never silently skips a month.
      return `${minute} ${hour} ${clamp(spec.scheduleDay ?? 1, 1, 28)} * *`;
    case 'CUSTOM':
      return spec.cronExpression ?? null;
    default:
      return spec.cronExpression ?? null;
  }
}

export function isValidCron(expression: string, timezone = DEFAULT_TIMEZONE): boolean {
  try {
    parser.parseExpression(expression, { tz: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Next fire time after `from`, or null for non-scheduled automations. */
export function computeNextRun(spec: ScheduleSpec, from = new Date()): Date | null {
  const expression = buildCronExpression(spec);
  if (!expression) return null;

  const tz = spec.timezone || DEFAULT_TIMEZONE;
  try {
    const interval = parser.parseExpression(expression, { currentDate: from, tz });
    return interval.next().toDate();
  } catch (err) {
    log.warn('Invalid cron expression; automation will not be scheduled', {
      expression,
      timezone: tz,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Previous fire time before `before` — used to describe the covered period. */
export function computePreviousRun(spec: ScheduleSpec, before = new Date()): Date | null {
  const expression = buildCronExpression(spec);
  if (!expression) return null;
  const tz = spec.timezone || DEFAULT_TIMEZONE;
  try {
    const interval = parser.parseExpression(expression, { currentDate: before, tz });
    return interval.prev().toDate();
  } catch {
    return null;
  }
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human-readable schedule for the automation summary screen. */
export function describeSchedule(spec: ScheduleSpec): string {
  const hour = clamp(spec.scheduleHour ?? 23, 0, 23);
  const minute = clamp(spec.scheduleMinute ?? 0, 0, 59);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  switch (spec.processingMode) {
    case 'REAL_TIME':
      return 'As each message arrives';
    case 'MANUAL':
      return 'Manual only — runs when you click Run';
    case 'DAILY':
      return `Every day at ${time}`;
    case 'WEEKLY':
      return `Every ${WEEKDAY_NAMES[clamp(spec.scheduleWeekday ?? 1, 0, 6)]} at ${time}`;
    case 'MONTHLY':
      return `On day ${clamp(spec.scheduleDay ?? 1, 1, 28)} of each month at ${time}`;
    case 'CUSTOM':
      return spec.cronExpression ? `Custom schedule (${spec.cronExpression})` : 'Custom schedule (not set)';
    default:
      return 'Not scheduled';
  }
}

/** Relative time for "Last sync 10 minutes ago". */
export function formatRelative(date: Date | null | undefined, now = new Date()): string {
  if (!date) return 'Never';
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return future ? 'in a moment' : 'just now';
  if (minutes < 60) return future ? `in ${minutes} min` : `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;

  return date.toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
