import { describe, expect, it } from 'vitest';
import {
  enumerateDays,
  getLocalParts,
  localWeekday,
  resolvePreset,
  resolveWindow,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  buildCronExpression,
  computeNextRun,
  describeSchedule,
  isValidCron,
} from '@msgflow/workflow';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

// A fixed instant: 2026-08-12 18:30 UTC = 2026-08-13 00:00 IST.
const NOW = new Date('2026-08-12T18:30:00.000Z');

describe('timezone-aware day boundaries', () => {
  it('computes local midnight in the tenant timezone, not the server one', () => {
    // 2026-08-12 10:00 UTC is 15:30 on the 12th in IST, so the local day
    // started at 2026-08-11T18:30Z.
    const start = startOfLocalDay(new Date('2026-08-12T10:00:00.000Z'), IST);
    expect(start.toISOString()).toBe('2026-08-11T18:30:00.000Z');
  });

  it('gives a different boundary for a different timezone', () => {
    const ist = startOfLocalDay(new Date('2026-08-12T10:00:00.000Z'), IST);
    const ny = startOfLocalDay(new Date('2026-08-12T10:00:00.000Z'), NY);
    expect(ist.toISOString()).not.toBe(ny.toISOString());
  });

  it('round-trips local parts', () => {
    const parts = getLocalParts(new Date('2026-08-12T10:00:00.000Z'), IST);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(8);
    expect(parts.day).toBe(12);
    expect(parts.hour).toBe(15);
    expect(parts.minute).toBe(30);
  });

  it('starts weeks on Monday', () => {
    // 2026-08-12 is a Wednesday.
    const weekStart = startOfLocalWeek(new Date('2026-08-12T10:00:00.000Z'), IST);
    expect(localWeekday(new Date(weekStart.getTime() + 3_600_000), IST)).toBe(1);
  });

  it('computes month starts', () => {
    const monthStart = startOfLocalMonth(new Date('2026-08-12T10:00:00.000Z'), IST);
    const parts = getLocalParts(monthStart, IST);
    expect(parts.day).toBe(1);
    expect(parts.month).toBe(8);
  });

  it('handles a DST transition without drifting', () => {
    // US DST ends 2026-11-01. The local day boundary must still land at
    // local midnight on both sides.
    const before = startOfLocalDay(new Date('2026-10-30T12:00:00.000Z'), NY);
    const after = startOfLocalDay(new Date('2026-11-03T12:00:00.000Z'), NY);
    expect(getLocalParts(before, NY).hour).toBe(0);
    expect(getLocalParts(after, NY).hour).toBe(0);
  });
});

describe('processing windows', () => {
  it('TODAY covers exactly one local day', () => {
    const window = resolveWindow('TODAY', { timezone: IST, now: NOW });
    expect(window.end.getTime() - window.start.getTime()).toBe(86_400_000);
  });

  it('YESTERDAY ends where TODAY begins', () => {
    const today = resolveWindow('TODAY', { timezone: IST, now: NOW });
    const yesterday = resolveWindow('YESTERDAY', { timezone: IST, now: NOW });
    expect(yesterday.end.toISOString()).toBe(today.start.toISOString());
  });

  it('LAST_7_DAYS spans seven local days', () => {
    const window = resolveWindow('LAST_7_DAYS', { timezone: IST, now: NOW });
    expect(Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000)).toBe(7);
  });

  it('LAST_WEEK is a full Monday-to-Monday span', () => {
    const window = resolveWindow('LAST_WEEK', { timezone: IST, now: NOW });
    expect(Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000)).toBe(7);
    expect(localWeekday(new Date(window.start.getTime() + 3_600_000), IST)).toBe(1);
  });

  it('LAST_MONTH covers the previous calendar month', () => {
    const window = resolveWindow('LAST_MONTH', { timezone: IST, now: NOW });
    expect(getLocalParts(window.start, IST).month).toBe(7);
    expect(getLocalParts(window.start, IST).day).toBe(1);
    expect(getLocalParts(window.end, IST).month).toBe(8);
  });

  it('SINCE_LAST_SUCCESSFUL_RUN starts at the cursor', () => {
    const cursor = new Date('2026-08-11T23:59:00.000Z');
    const window = resolveWindow('SINCE_LAST_SUCCESSFUL_RUN', {
      timezone: IST,
      now: NOW,
      lastSuccessfulRunAt: cursor,
    });

    expect(window.start.toISOString()).toBe(cursor.toISOString());
    expect(window.unbounded).toBe(false);
  });

  it('bounds the first run rather than scanning all history', () => {
    // With no cursor, an unbounded window would send the entire message history
    // to the AI on the very first run.
    const window = resolveWindow('SINCE_LAST_SUCCESSFUL_RUN', {
      timezone: IST,
      now: NOW,
      lastSuccessfulRunAt: null,
      maxLookbackDays: 30,
    });

    expect(window.unbounded).toBe(true);
    const days = (window.end.getTime() - window.start.getTime()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(31);
  });

  it('CURRENT_MESSAGE brackets a single message', () => {
    const timestamp = new Date('2026-08-12T10:31:00.000Z');
    const window = resolveWindow('CURRENT_MESSAGE', { messageTimestamp: timestamp, now: NOW });
    expect(window.start.getTime()).toBeLessThan(timestamp.getTime());
    expect(window.end.getTime()).toBeGreaterThan(timestamp.getTime());
  });
});

describe('dashboard presets', () => {
  it('resolves each preset to a non-empty range', () => {
    for (const preset of ['today', 'yesterday', 'last7', 'last30', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth']) {
      const range = resolvePreset(preset, IST, NOW);
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
      expect(range.label.length).toBeGreaterThan(0);
    }
  });

  it('honours an explicit custom range', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-12T00:00:00.000Z');
    const range = resolvePreset('custom', IST, NOW, { from, to });
    expect(range.start.toISOString()).toBe(from.toISOString());
    expect(range.end.toISOString()).toBe(to.toISOString());
  });
});

describe('day enumeration', () => {
  it('produces one bucket per local day', () => {
    const start = startOfLocalDay(new Date('2026-08-06T10:00:00.000Z'), IST);
    const end = startOfLocalDay(new Date('2026-08-13T10:00:00.000Z'), IST);
    const buckets = enumerateDays(start, end, IST);

    expect(buckets).toHaveLength(7);
    expect(new Set(buckets.map((b) => b.key)).size).toBe(7);
  });
});

describe('scheduling', () => {
  it('builds cron expressions from business-language settings', () => {
    expect(buildCronExpression({ processingMode: 'DAILY', scheduleHour: 23, scheduleMinute: 0 })).toBe('0 23 * * *');
    expect(buildCronExpression({ processingMode: 'WEEKLY', scheduleHour: 1, scheduleMinute: 0, scheduleWeekday: 1 })).toBe('0 1 * * 1');
    expect(buildCronExpression({ processingMode: 'MONTHLY', scheduleHour: 2, scheduleMinute: 0, scheduleDay: 1 })).toBe('0 2 1 * *');
  });

  it('does not schedule real-time or manual automations', () => {
    expect(buildCronExpression({ processingMode: 'REAL_TIME' })).toBeNull();
    expect(buildCronExpression({ processingMode: 'MANUAL' })).toBeNull();
  });

  it('caps the monthly day at 28 so February never skips', () => {
    expect(buildCronExpression({ processingMode: 'MONTHLY', scheduleDay: 31 })).toContain(' 28 ');
  });

  it('computes the next run in the tenant timezone', () => {
    const next = computeNextRun(
      { processingMode: 'DAILY', scheduleHour: 23, scheduleMinute: 0, timezone: IST },
      new Date('2026-08-12T10:00:00.000Z'),
    );

    expect(next).not.toBeNull();
    expect(getLocalParts(next!, IST).hour).toBe(23);
  });

  it('validates cron expressions', () => {
    expect(isValidCron('0 23 * * *')).toBe(true);
    expect(isValidCron('not a cron')).toBe(false);
  });

  it('returns null rather than throwing on a bad expression', () => {
    expect(computeNextRun({ processingMode: 'CUSTOM', cronExpression: 'nonsense' })).toBeNull();
  });

  it('describes schedules in plain language', () => {
    expect(describeSchedule({ processingMode: 'REAL_TIME' })).toMatch(/each message/i);
    expect(describeSchedule({ processingMode: 'DAILY', scheduleHour: 23, scheduleMinute: 0 })).toBe('Every day at 23:00');
    expect(describeSchedule({ processingMode: 'WEEKLY', scheduleWeekday: 1, scheduleHour: 9, scheduleMinute: 0 })).toBe('Every Monday at 09:00');
  });
});
