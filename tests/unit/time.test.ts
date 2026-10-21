import {expect, test} from 'bun:test';
import {lessonReadiness, isScheduled, nextScheduledDay, normalizeDays} from '../../src/core/schedule.ts';
import {addDays, daysBetween, isDay, localDate, localHour, weekdayOf} from '../../src/core/time.ts';

test('the local day depends on the time zone', () => {
  const at = '2026-09-13T03:30:00Z';
  expect(localDate(at, 'America/Chicago')).toBe('2026-09-12');
  expect(localDate(at, 'Europe/London')).toBe('2026-09-13');
  expect(localHour(at, 'America/Chicago')).toBe(22);
});

test('day arithmetic is calendar arithmetic, across daylight saving', () => {
  expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
  expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
  expect(isDay('2026-02-30')).toBe(false);
  expect(weekdayOf('2026-09-12')).toBe('sat');
});

test('days: normalised, and which days are scheduled', () => {
  expect(normalizeDays('Fri, mon')).toBe('mon,fri');
  expect(normalizeDays('wednesday,friday')).toBe('wed,fri');
  expect(normalizeDays('someday')).toBeUndefined();
  expect(isScheduled('weekdays', '2026-09-12')).toBe(false);
  expect(isScheduled('weekends', '2026-09-12')).toBe(true);
  expect(isScheduled('mon,fri', '2026-09-14')).toBe(true);
  expect(nextScheduledDay('mon,fri', '2026-09-12')).toBe('2026-09-14');
});

test('readiness gives the real reason, most actionable first', () => {
  const base = {status: 'active', days: 'daily', today: '2026-09-12', hour: 10, readyHour: 5, hasLessonToday: false, unfinishedEarlier: false};
  expect(lessonReadiness(base)).toEqual({ready: true});
  expect(lessonReadiness({...base, hour: 4})).toMatchObject({ready: false, why: 'before_ready_hour'});
  expect(lessonReadiness({...base, hour: 4, unfinishedEarlier: true})).toMatchObject({why: 'unfinished_lesson'});
  expect(lessonReadiness({...base, days: 'weekdays'})).toMatchObject({why: 'not_scheduled_today'});
  expect(lessonReadiness({...base, hasLessonToday: true})).toMatchObject({why: 'has_lesson_today'});
  expect(lessonReadiness({...base, status: 'paused'})).toMatchObject({why: 'paused'});
});
