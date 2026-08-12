import { DEFAULT_TIMEZONE } from '@msgflow/config';

/**
 * Processing-window resolution.
 *
 * Every window is computed in the tenant's timezone, not the server's. A daily
 * run at 23:00 Asia/Kolkata must cover that local day even though the server is
 * on UTC — getting this wrong silently shifts every report by 5.5 hours.
 *
 * Implemented with Intl rather than a date library so there is no dependency on
 * timezone data shipped separately from Node's ICU.
 */

export type WindowMode =
  | 'CURRENT_MESSAGE'
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'LAST_WEEK'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'LAST_7_DAYS'
  | 'CUSTOM'
  | 'SINCE_LAST_SUCCESSFUL_RUN';

export interface ResolvedWindow {
  start: Date;
  end: Date;
  label: string;
  /** True when the window has no lower bound (first run of a cursor mode). */
  unbounded: boolean;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Break an instant into wall-clock parts in the given timezone. */
export function getLocalParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some locales/versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of a timezone from UTC at a given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = getLocalParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Build the UTC instant for a wall-clock time in a timezone.
 *
 * Two passes: guess using the offset at the guessed instant, then re-check.
 * One correction is enough for every real timezone, including DST edges.
 */
export function zonedTimeToUtc(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  const firstGuess = new Date(naive - offsetMs(new Date(naive), timeZone));
  const corrected = new Date(naive - offsetMs(firstGuess, timeZone));
  return corrected;
}

/** Local midnight (start of day) for the day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string, dayOffset = 0): Date {
  const p = getLocalParts(date, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  const s = { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
  return zonedTimeToUtc({ ...s, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Day of week in the tenant's timezone: 0 = Sunday … 6 = Saturday. */
export function localWeekday(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Start of the local week. Weeks run Monday→Sunday (Indian business default). */
export function startOfLocalWeek(date: Date, timeZone: string, weekOffset = 0): Date {
  const weekday = localWeekday(date, timeZone);
  // Convert Sunday=0 into "6 days since Monday".
  const daysSinceMonday = (weekday + 6) % 7;
  return startOfLocalDay(date, timeZone, -daysSinceMonday + weekOffset * 7);
}

export function startOfLocalMonth(date: Date, timeZone: string, monthOffset = 0): Date {
  const p = getLocalParts(date, timeZone);
  const target = new Date(Date.UTC(p.year, p.month - 1 + monthOffset, 1));
  return zonedTimeToUtc(
    { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

export interface WindowContext {
  timezone?: string | null;
  now?: Date;
  lastSuccessfulRunAt?: Date | null;
  customFrom?: Date | null;
  customTo?: Date | null;
  /** For CURRENT_MESSAGE. */
  messageTimestamp?: Date | null;
  /** Cap on how far back an unbounded first run reaches. */
  maxLookbackDays?: number;
}

/**
 * Resolve a processing window.
 *
 * SINCE_LAST_SUCCESSFUL_RUN is the important one: it is what stops the platform
 * re-sending the same messages to the AI on every run. On the very first run
 * there is no cursor, so we look back a bounded number of days rather than
 * scanning all history and spending a fortune in tokens.
 */
export function resolveWindow(mode: WindowMode, context: WindowContext = {}): ResolvedWindow {
  const tz = context.timezone || DEFAULT_TIMEZONE;
  const now = context.now ?? new Date();
  const maxLookbackDays = context.maxLookbackDays ?? 30;

  switch (mode) {
    case 'CURRENT_MESSAGE': {
      const ts = context.messageTimestamp ?? now;
      return {
        start: new Date(ts.getTime() - 1_000),
        end: new Date(ts.getTime() + 1_000),
        label: 'This message',
        unbounded: false,
      };
    }

    case 'TODAY': {
      const start = startOfLocalDay(now, tz);
      return { start, end: startOfLocalDay(now, tz, 1), label: 'Today', unbounded: false };
    }

    case 'YESTERDAY': {
      return {
        start: startOfLocalDay(now, tz, -1),
        end: startOfLocalDay(now, tz),
        label: 'Yesterday',
        unbounded: false,
      };
    }

    case 'LAST_7_DAYS': {
      return {
        start: startOfLocalDay(now, tz, -6),
        end: startOfLocalDay(now, tz, 1),
        label: 'Last 7 days',
        unbounded: false,
      };
    }

    case 'THIS_WEEK': {
      const start = startOfLocalWeek(now, tz);
      return { start, end: startOfLocalWeek(now, tz, 1), label: 'This week', unbounded: false };
    }

    case 'LAST_WEEK': {
      return {
        start: startOfLocalWeek(now, tz, -1),
        end: startOfLocalWeek(now, tz),
        label: 'Last week',
        unbounded: false,
      };
    }

    case 'THIS_MONTH': {
      return {
        start: startOfLocalMonth(now, tz),
        end: startOfLocalMonth(now, tz, 1),
        label: 'This month',
        unbounded: false,
      };
    }

    case 'LAST_MONTH': {
      return {
        start: startOfLocalMonth(now, tz, -1),
        end: startOfLocalMonth(now, tz),
        label: 'Last month',
        unbounded: false,
      };
    }

    case 'CUSTOM': {
      const start = context.customFrom ?? startOfLocalDay(now, tz);
      const end = context.customTo ?? now;
      return {
        start,
        end,
        label: `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
        unbounded: false,
      };
    }

    case 'SINCE_LAST_SUCCESSFUL_RUN':
    default: {
      const cursor = context.lastSuccessfulRunAt;
      if (cursor) {
        return { start: cursor, end: now, label: 'Since last successful run', unbounded: false };
      }
      return {
        start: startOfLocalDay(now, tz, -maxLookbackDays),
        end: now,
        label: `First run — last ${maxLookbackDays} days`,
        unbounded: true,
      };
    }
  }
}

/** Dashboard date-filter presets. Shares the timezone maths with windows. */
export function resolvePreset(
  preset: string,
  timezone: string,
  now = new Date(),
  custom?: { from?: Date; to?: Date },
): { start: Date; end: Date; label: string } {
  switch (preset) {
    case 'today':
      return { start: startOfLocalDay(now, timezone), end: startOfLocalDay(now, timezone, 1), label: 'Today' };
    case 'yesterday':
      return {
        start: startOfLocalDay(now, timezone, -1),
        end: startOfLocalDay(now, timezone),
        label: 'Yesterday',
      };
    case 'last30':
      return {
        start: startOfLocalDay(now, timezone, -29),
        end: startOfLocalDay(now, timezone, 1),
        label: 'Last 30 days',
      };
    case 'thisWeek':
      return {
        start: startOfLocalWeek(now, timezone),
        end: startOfLocalWeek(now, timezone, 1),
        label: 'This week',
      };
    case 'lastWeek':
      return {
        start: startOfLocalWeek(now, timezone, -1),
        end: startOfLocalWeek(now, timezone),
        label: 'Last week',
      };
    case 'thisMonth':
      return {
        start: startOfLocalMonth(now, timezone),
        end: startOfLocalMonth(now, timezone, 1),
        label: 'This month',
      };
    case 'lastMonth':
      return {
        start: startOfLocalMonth(now, timezone, -1),
        end: startOfLocalMonth(now, timezone),
        label: 'Last month',
      };
    case 'custom':
      return {
        start: custom?.from ?? startOfLocalDay(now, timezone, -6),
        end: custom?.to ?? startOfLocalDay(now, timezone, 1),
        label: 'Custom range',
      };
    case 'last7':
    default:
      return {
        start: startOfLocalDay(now, timezone, -6),
        end: startOfLocalDay(now, timezone, 1),
        label: 'Last 7 days',
      };
  }
}

/** Local-day buckets across a range, for time-series charts. */
export function enumerateDays(start: Date, end: Date, timezone: string): Array<{ start: Date; end: Date; key: string; label: string }> {
  const buckets: Array<{ start: Date; end: Date; key: string; label: string }> = [];
  let cursor = startOfLocalDay(start, timezone);
  let guard = 0;

  while (cursor < end && guard < 400) {
    const next = startOfLocalDay(new Date(cursor.getTime() + 36 * 3_600_000), timezone);
    const parts = getLocalParts(cursor, timezone);
    const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    buckets.push({
      start: cursor,
      end: next,
      key,
      label: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short' }).format(cursor),
    });
    cursor = next;
    guard++;
  }

  return buckets;
}

/** Hourly buckets for the analytics "Day" tab. */
export function enumerateHours(dayStart: Date, timezone: string): Array<{ start: Date; end: Date; key: string; label: string }> {
  const buckets = [];
  for (let h = 0; h < 24; h++) {
    const start = new Date(dayStart.getTime() + h * 3_600_000);
    buckets.push({
      start,
      end: new Date(start.getTime() + 3_600_000),
      key: String(h),
      label: `${String(h).padStart(2, '0')}:00`,
    });
  }
  void timezone;
  return buckets;
}
