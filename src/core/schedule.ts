/**
 * Which days a subject is taught on, and whether it is ready for a lesson now.
 *
 * The no-stacking rule lives here: a subject is ready only when it is active, scheduled
 * today, past the ready hour, has no lesson for today, and every earlier lesson is
 * finished or skipped. A week away comes back to one lesson waiting, not seven. Pure.
 */
import {addDays, WEEKDAYS, weekdayOf, type Weekday} from './time.ts';

export const DAYS_HELP = 'daily, weekdays, weekends, or days like mon,wed,fri';

/** The canonical form of a `days` value, or undefined if it isn't one. */
export function normalizeDays(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'daily' || v === 'weekdays' || v === 'weekends') return v;
  const parts = v.split(',').map(p => p.trim().slice(0, 3)).filter(p => p !== '');
  if (parts.length === 0 || !parts.every(p => (WEEKDAYS as readonly string[]).includes(p))) return undefined;
  const set = new Set(parts);
  // Keep a fixed order, starting Monday, so "fri,mon" and "mon,fri" are the same value.
  return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(d => set.has(d)).join(',');
}

export function isScheduled(days: string, day: string): boolean {
  const weekday: Weekday = weekdayOf(day);
  if (days === 'daily') return true;
  if (days === 'weekdays') return weekday !== 'sat' && weekday !== 'sun';
  if (days === 'weekends') return weekday === 'sat' || weekday === 'sun';
  return days.split(',').includes(weekday);
}

/** The next scheduled day on or after `from`, within a week. */
export function nextScheduledDay(days: string, from: string): string | undefined {
  for (let i = 0; i < 7; i++) {
    const day = addDays(from, i);
    if (isScheduled(days, day)) return day;
  }
  return undefined;
}

export type WaitReason = 'paused' | 'has_lesson_today' | 'unfinished_lesson' | 'not_scheduled_today' | 'before_ready_hour';

export interface ReadinessInput {
  status: string;
  days: string;
  today: string;
  hour: number;
  readyHour: number;
  hasLessonToday: boolean;
  /** An earlier lesson that is still ready or open. */
  unfinishedEarlier: boolean;
}

export type Readiness = {ready: true} | {ready: false; why: WaitReason; message: string};

export function lessonReadiness(input: ReadinessInput): Readiness {
  const hh = `${String(input.readyHour).padStart(2, '0')}:00`;
  if (input.status !== 'active') return {ready: false, why: 'paused', message: `the subject is ${input.status}`};
  if (input.hasLessonToday) return {ready: false, why: 'has_lesson_today', message: 'it already has a lesson for today'};
  if (input.unfinishedEarlier) return {ready: false, why: 'unfinished_lesson', message: 'an earlier lesson is still unfinished; the learner finishes or skips it first'};
  if (!isScheduled(input.days, input.today)) {
    const next = nextScheduledDay(input.days, addDays(input.today, 1));
    return {ready: false, why: 'not_scheduled_today', message: `it isn't scheduled today (${input.days})${next === undefined ? '' : `; next on ${next}`}`};
  }
  if (input.hour < input.readyHour) return {ready: false, why: 'before_ready_hour', message: `lessons are written from ${hh} (lesson_ready_hour)`};
  return {ready: true};
}
