/**
 * #6: time estimates calibrated to this learner, per subject. A subject with 3 or more
 * finished, timed lessons gets a lesson estimate scaled by the median ratio of active to
 * estimated seconds, quizzes at the learner's median seconds a question, and a warning when
 * the day's lesson and quiz at that pace run past the subject's budget. With fewer, the
 * estimate stays generic and says so.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {shownSeconds} from '../../src/db/estimate.ts';
import {answerQ, ownershipLesson, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};
const ACTIVE = 600;

const activity = (lesson: string, body: unknown) =>
  fetch(`${lc.url}/api/lessons/${lesson}/activity`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});

const lessonFor = (day: number) => ownershipLesson({concepts: [{key: 'ownership', role: day === 0 ? 'new' : 'deepen'}]});

/** A day the learner reads the lesson slowly and, if `quiz`, answers its quiz at 120 s a question. Returns the lesson's estimated seconds. */
async function slowDay(subject: string, day: number, quiz: boolean): Promise<number> {
  const run = await startRun(lc);
  const submitted = await submitLesson(lc, subject, run, lessonFor(day));
  expect(submitted.code).toBe(0);
  const id = submitted.json.lesson.id as string;
  expect((await activity(id, {active_seconds: ACTIVE})).status).toBe(200);
  await lc.j(['finish', id]);
  if (quiz) {
    const q = await submitQuiz(lc, subject, run, ownershipQuiz(id));
    expect(q.code).toBe(0);
    const answers = ['owner', 'scope', 'One owner.'];
    for (const [i, question] of (q.json.question_ids as string[]).entries()) await answerQ(lc, {question, quiz: q.json.quiz.id, answer: answers[i], seconds: 120});
  }
  await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'day'], TUTOR);
  lc.advance({days: 1});
  return shownSeconds(lc.ctx('agent:tutor'), id);
}

test('three slow lessons calibrate the estimate, and the day over budget is warned about', async () => {
  const subject = await rustSubject(lc);
  const estimates: number[] = [];
  for (let day = 0; day < 3; day++) estimates.push(await slowDay(subject, day, true));
  const ratio = Math.round((ACTIVE / estimates[0]!) * 100) / 100;
  expect(estimates.every(e => e === estimates[0])).toBe(true);
  expect(ratio).toBeGreaterThan(2);

  const context = (await lc.j(['context'], TUTOR)).json.subjects[0];
  expect(context.calibration).toEqual({ratio, n: 3, calibrated: true, seconds_per_question: 120, question_n: 9, question_calibrated: true});

  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, lessonFor(3));
  expect(lesson.code).toBe(0);
  const generic = lesson.json.estimate_minutes as number;
  const minutes = Math.round((estimates[0]! * ratio) / 60);
  expect(minutes).toBeGreaterThan(9);
  expect(lesson.json.learner_estimate).toEqual({minutes, ratio, n: 3, calibrated: true});
  expect(minutes).toBeGreaterThan(generic);
  // 15 min/day: the lesson's share is 9, the quiz's 6. No quiz yet, so its share stands in.
  expect(lesson.json.warnings).toContain(`for this learner, the lesson about ${minutes} min and the quiz's share of 6 min come to about ${minutes + 6} min, over this subject's 15 min/day. Shorter beats complete.`);
  // The human output says it too.
  const id = lesson.json.lesson.id as string;
  const revised = await lc.cli(['lesson', 'revise', id, '--file', lc.file('lesson.json', lessonFor(3))], TUTOR);
  expect(revised.code).toBe(0);
  expect(revised.stdout).toContain(`for this learner: about ${minutes} min (${ratio}× the estimate over 3 lessons)`);
  expect(revised.stdout).toContain('warning: for this learner, the lesson about');

  // The quiz: 3 questions at 120 s, beside the day's lesson.
  await activity(id, {active_seconds: 30});
  await lc.j(['finish', id]);
  const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(id));
  expect(quiz.code).toBe(0);
  expect(quiz.json.estimate_minutes).toBe(2);
  expect(quiz.json.learner_estimate).toEqual({minutes: 6, seconds_per_question: 120, n: 9, calibrated: true});
  expect(quiz.json.warnings).toContain(`for this learner, the lesson about ${minutes} min and the quiz about 6 min come to about ${minutes + 6} min, over this subject's 15 min/day. Shorter beats complete.`);
});

test('under three finished lessons the estimate stays generic, with no new warning', async () => {
  const subject = await rustSubject(lc);
  for (let day = 0; day < 2; day++) await slowDay(subject, day, false);
  expect((await lc.j(['context'], TUTOR)).json.subjects[0].calibration).toEqual({ratio: 1, n: 2, calibrated: false, seconds_per_question: 45, question_n: 0, question_calibrated: false});

  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, lessonFor(2));
  expect(lesson.code).toBe(0);
  expect(lesson.json.learner_estimate).toEqual({minutes: lesson.json.estimate_minutes, ratio: 1, n: 2, calibrated: false});
  expect(lesson.json.warnings.filter((w: string) => w.startsWith('for this learner'))).toEqual([]);
  const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id));
  expect(quiz.json.learner_estimate).toEqual({minutes: 2, seconds_per_question: 45, n: 0, calibrated: false});
  expect(quiz.json.warnings.filter((w: string) => w.startsWith('for this learner'))).toEqual([]);
});
