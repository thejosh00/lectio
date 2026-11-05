import {expect, test} from 'bun:test';
import {ANSWER_SECONDS_MAX, calibrate, dayBudgetWarning, learnerLessonEstimate, learnerQuizEstimate} from '../../src/core/estimate.ts';

const lesson = (estimate_seconds: number, active_seconds: number) => ({estimate_seconds, active_seconds});
const none = {answer_seconds: [], generic_seconds_per_question: 45};

test('under 3 timed lessons the ratio is 1 and not calibrated', () => {
  const c = calibrate({...none, lessons: [lesson(100, 300), lesson(100, 300)]});
  expect(c).toMatchObject({ratio: 1, n: 2, calibrated: false});
  expect(learnerLessonEstimate(600, c)).toEqual({minutes: 10, ratio: 1, n: 2, calibrated: false});
});

test('the ratio is the median of active ÷ estimated over the newest 7, to 2 places', () => {
  // Newest first: the 8th (a 10× outlier) is past the window; the median of the 7 is 2.1.
  const lessons = [lesson(100, 210), lesson(100, 150), lesson(200, 500), lesson(100, 210), lesson(300, 300), lesson(100, 400), lesson(100, 190), lesson(100, 1000)];
  const c = calibrate({...none, lessons});
  expect(c).toMatchObject({ratio: 2.1, n: 7, calibrated: true});
  expect(learnerLessonEstimate(600, c)).toEqual({minutes: 21, ratio: 2.1, n: 7, calibrated: true});
  // An even count takes the middle two; thirds round to 2 places.
  expect(calibrate({...none, lessons: [lesson(300, 400), lesson(300, 500), lesson(300, 600), lesson(300, 700)]}).ratio).toBe(1.83);
});

test('lessons without an estimate or without active seconds are left out', () => {
  const c = calibrate({...none, lessons: [lesson(0, 300), lesson(100, 0), lesson(100, 200), lesson(100, 200)]});
  expect(c).toMatchObject({ratio: 1, n: 2, calibrated: false});
});

test('seconds per question: the median of the newest 30 timed answers, from 5', () => {
  const generic = {lessons: [], generic_seconds_per_question: 45};
  expect(calibrate({...generic, answer_seconds: [60, 70, 80, 90]})).toMatchObject({seconds_per_question: 45, question_n: 4, question_calibrated: false});
  // 0 s and over-ceiling answers don't count.
  const c = calibrate({...generic, answer_seconds: [0, ANSWER_SECONDS_MAX + 1, 60, 70, 80, 90, 3600, 100]});
  expect(c).toMatchObject({seconds_per_question: 80, question_n: 5, question_calibrated: true});
  expect(calibrate({...generic, answer_seconds: [...Array(30).fill(20), ...Array(40).fill(500)]}).seconds_per_question).toBe(20);
  expect(learnerQuizEstimate({questions: 4, generic_seconds: 180}, c)).toEqual({minutes: 5, seconds_per_question: 80, n: 5, calibrated: true});
});

test('an uncalibrated quiz keeps its generic estimate, figures and widgets included', () => {
  const c = calibrate({lessons: [], answer_seconds: [], generic_seconds_per_question: 45});
  expect(learnerQuizEstimate({questions: 4, generic_seconds: 240}, c)).toEqual({minutes: 4, seconds_per_question: 45, n: 0, calibrated: false});
  expect(learnerQuizEstimate({questions: 0, generic_seconds: 0}, c).minutes).toBe(1);
});

test('the day budget warning: only when calibrated, and naming both numbers', () => {
  const day = {minutes_per_day: 15};
  // Uncalibrated: the generic checks speak for it.
  expect(dayBudgetWarning({...day, lesson: {minutes: 20, calibrated: false}, quiz: {minutes: 10, calibrated: false}})).toBeNull();
  // Within budget.
  expect(dayBudgetWarning({...day, lesson: {minutes: 9, calibrated: true}, quiz: {minutes: 6, calibrated: false}})).toBeNull();
  // Over: lesson 12 + quiz 6.
  expect(dayBudgetWarning({...day, lesson: {minutes: 12, calibrated: true}, quiz: {minutes: 6, calibrated: false}})).toBe(
    "for this learner, the lesson about 12 min and the quiz about 6 min come to about 18 min, over this subject's 15 min/day. Cut an idea rather than compress the sentences.",
  );
  // No quiz yet: its share (15 − 9 = 6) stands in.
  expect(dayBudgetWarning({...day, lesson: {minutes: 10, calibrated: true}, quiz: null})).toContain("the lesson about 10 min and the quiz's share of 6 min come to about 16 min");
  expect(dayBudgetWarning({...day, lesson: {minutes: 9, calibrated: true}, quiz: null})).toBeNull();
  // A quiz with no lesson that day.
  expect(dayBudgetWarning({...day, lesson: null, quiz: {minutes: 16, calibrated: true}})).toContain('no lesson and the quiz about 16 min come to about 16 min');
});
