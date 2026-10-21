/**
 * Timestamps and calendar days.
 *
 * A moment is ISO-8601 in UTC, to the second: `2026-09-12T10:04:00Z`. A *day* — as in
 * "today's lesson" — is the local calendar day in the instance's time zone, because that
 * is the one the learner lives in. Days are `YYYY-MM-DD` strings, and arithmetic on them
 * is calendar arithmetic, never 24-hour steps, so daylight saving can't skip or repeat one.
 */

export function toIsoSeconds(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new RangeError('not a date');
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function nowIso(): string {
  return toIsoSeconds(new Date());
}

/** The system's time zone, for when the instance has none set. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: value});
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(at: Date | string, timeZone: string): Record<string, string> {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    formatters.set(timeZone, format);
  }
  const date = typeof at === 'string' ? new Date(at) : at;
  return Object.fromEntries(format.formatToParts(date).map(p => [p.type, p.value]));
}

/** The local calendar day a moment falls on, as `YYYY-MM-DD`. */
export function localDate(at: Date | string, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${p['year']}-${p['month']}-${p['day']}`;
}

/** The local hour (0–23) of a moment. */
export function localHour(at: Date | string, timeZone: string): number {
  return Number(parts(at, timeZone)['hour']);
}

/** The local time of a moment as `HH:MM`. */
export function localTime(at: Date | string, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${p['hour']}:${p['minute']}`;
}

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A day shifted by whole calendar days. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weekdayOf(day: string): Weekday {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
}

/** Hours between two moments, `to` minus `from`. */
export function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}

/** A moment shifted by whole 24-hour steps (fine for windows like "the last 30 days"). */
export function addDaysIso(at: string, days: number): string {
  return toIsoSeconds(new Date(new Date(at).getTime() + days * 86_400_000));
}
