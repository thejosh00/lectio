/**
 * Time estimates calibrated to this learner, per subject (#6).
 *
 * The generic estimate (about 200 words a minute, 45 s a question) is the same for
 * everyone. This learner's real time differs by subject, so a submit also gives a learner
 * estimate: the generic lesson estimate times the subject's median ratio of active seconds
 * to estimated seconds over its last few finished lessons, and a quiz at the median
 * seconds this learner takes per question there. Too little history falls back to the
 * generic estimate, and says so.
 */
import {median} from './measures.ts';

/** The finished lessons the ratio is the median over, newest first. */
export const CALIBRATION_LESSONS = 7;
/** Fewer finished, timed lessons than this and the lesson estimate stays generic. */
export const MIN_CALIBRATION_LESSONS = 3;
/** The first-try quiz answers the seconds per question is the median over, newest first. */
export const CALIBRATION_ANSWERS = 30;
/** Fewer timed answers than this and the quiz estimate stays generic. */
export const MIN_CALIBRATION_ANSWERS = 5;
/** An answer that took longer than this was left open, not worked on: it is not counted. */
export const ANSWER_SECONDS_MAX = 600;

/** A finished lesson: what its blocks were estimated at (the arm shown), and the active seconds recorded. */
export interface TimedLesson {
  estimate_seconds: number;
  active_seconds: number;
}

/** How this learner's time compares with the generic estimate in one subject. */
export interface Calibration {
  /** Median active ÷ estimated seconds, to 2 places; 1 when not calibrated. */
  ratio: number;
  /** The finished lessons it is the median over (each with an estimate and active seconds). */
  n: number;
  calibrated: boolean;
  /** Median seconds per first-try quiz answer; the generic figure when not calibrated. */
  seconds_per_question: number;
  /** The answers it is the median over. */
  question_n: number;
  question_calibrated: boolean;
}

/**
 * `lessons` and `answer_seconds` newest first. Lessons without an estimate or without active
 * seconds are left out, as are answers of 0 s or over {@link ANSWER_SECONDS_MAX}; then the
 * newest {@link CALIBRATION_LESSONS} and {@link CALIBRATION_ANSWERS} count.
 */
export function calibrate(input: {lessons: readonly TimedLesson[]; answer_seconds: readonly number[]; generic_seconds_per_question: number}): Calibration {
  const lessons = input.lessons.filter(l => l.estimate_seconds > 0 && l.active_seconds > 0).slice(0, CALIBRATION_LESSONS);
  const answers = input.answer_seconds.filter(s => s > 0 && s <= ANSWER_SECONDS_MAX).slice(0, CALIBRATION_ANSWERS);
  const calibrated = lessons.length >= MIN_CALIBRATION_LESSONS;
  const questionCalibrated = answers.length >= MIN_CALIBRATION_ANSWERS;
  return {
    ratio: calibrated ? round2(median(lessons.map(l => l.active_seconds / l.estimate_seconds))!) : 1,
    n: lessons.length,
    calibrated,
    seconds_per_question: questionCalibrated ? Math.round(median(answers)!) : input.generic_seconds_per_question,
    question_n: answers.length,
    question_calibrated: questionCalibrated,
  };
}

/** What a lesson's blocks will take this learner. */
export interface LessonLearnerEstimate {
  minutes: number;
  ratio: number;
  n: number;
  calibrated: boolean;
}

export function learnerLessonEstimate(genericSeconds: number, calibration: Calibration): LessonLearnerEstimate {
  return {minutes: Math.round((genericSeconds * calibration.ratio) / 60), ratio: calibration.ratio, n: calibration.n, calibrated: calibration.calibrated};
}

/** What a quiz will take this learner. */
export interface QuizLearnerEstimate {
  minutes: number;
  seconds_per_question: number;
  n: number;
  calibrated: boolean;
}

/** Calibrated, the quiz is its questions at this learner's median; otherwise its generic estimate. */
export function learnerQuizEstimate(input: {questions: number; generic_seconds: number}, calibration: Calibration): QuizLearnerEstimate {
  const seconds = calibration.question_calibrated ? input.questions * calibration.seconds_per_question : input.generic_seconds;
  return {
    minutes: Math.max(1, Math.round(seconds / 60)),
    seconds_per_question: calibration.seconds_per_question,
    n: calibration.question_n,
    calibrated: calibration.question_calibrated,
  };
}

/**
 * The day's lesson and quiz, as this learner will take them, against the subject's daily
 * budget. Only when at least one of them is calibrated: uncalibrated, the generic checks
 * already said what there is to say. `quiz` null means the day's quiz isn't written yet, so
 * its share of the budget stands in for it.
 */
export function dayBudgetWarning(input: {
  minutes_per_day: number;
  lesson: {minutes: number; calibrated: boolean} | null;
  quiz: {minutes: number; calibrated: boolean} | null;
}): string | null {
  const lessonShare = Math.round(input.minutes_per_day * 0.6);
  const quizShare = input.minutes_per_day - lessonShare;
  if (!(input.lesson?.calibrated === true || input.quiz?.calibrated === true)) return null;
  const lessonMinutes = input.lesson?.minutes ?? 0;
  const quizMinutes = input.quiz?.minutes ?? quizShare;
  const total = lessonMinutes + quizMinutes;
  if (total <= input.minutes_per_day) return null;
  const lessonPart = input.lesson === null ? 'no lesson' : `the lesson about ${lessonMinutes} min`;
  const quizPart = input.quiz === null ? `the quiz's share of ${quizShare} min` : `the quiz about ${quizMinutes} min`;
  return `for this learner, ${lessonPart} and ${quizPart} come to about ${total} min, over this subject's ${input.minutes_per_day} min/day. Cut an idea rather than compress the sentences.`;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
