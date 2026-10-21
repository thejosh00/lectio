/**
 * M4: memory per concept, counted attempts, due dates and recall, practice, and the
 * measures over a real history lived across several days.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {answerQ, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

async function dayOne() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run);
  const inline = lesson.json.question_ids.q1 as string;
  const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id, inline));
  const [shortText, mc, free] = quiz.json.question_ids as [string, string, string];
  await answerQ(lc, {question: inline, lesson: lesson.json.lesson.id, answer: 'b'});
  await lc.j(['finish', lesson.json.lesson.id]);
  lc.advance({minutes: 10});
  const first = await answerQ(lc, {question: shortText, quiz: quiz.json.quiz.id, answer: 'owner', confidence: 'sure'});
  lc.advance({minutes: 1});
  const second = await answerQ(lc, {question: mc, quiz: quiz.json.quiz.id, answer: 'scope', confidence: 'sure'});
  return {subject, quizId: quiz.json.quiz.id as string, inline, shortText, mc, free, first, second};
}

const memoryOf = async (key: string) => {
  const subject = await lc.j(['subject', 'show', 'Rust ownership']);
  return subject.json.concepts.find((c: {key: string}) => c.key === key).memory;
};

test('the first counted attempt on a newly introduced concept creates its memory; later ones that day do not count', async () => {
  const {first, second} = await dayOne();
  expect(first.attempt.counts_for_memory).toBe(true);
  expect(first.attempt.gap_hours).toBeCloseTo(10 / 60, 2);
  expect(second.attempt.counts_for_memory).toBe(false);
  expect(await memoryOf('ownership')).toMatchObject({reps: 1, lapses: 0, due: '2026-09-15', recall_now: 1, is_due: false});
  // Inline checks never count; concepts not yet introduced have no memory.
  expect(lc.db.query("SELECT COUNT(*) AS n FROM attempts WHERE context = 'lesson' AND counts_for_memory = 1").get()).toEqual({n: 0});
  expect(await memoryOf('moves')).toBeNull();
});

test('a clock moved across days shows concepts falling due and practice picking them', async () => {
  const {free} = await dayOne();
  lc.advance({days: 2});
  expect((await lc.j(['today'])).json.subjects[0].practice_due).toBe(0);
  lc.advance({days: 1});
  const today = await lc.j(['today']);
  expect(today.json.subjects[0].practice_due).toBe(1);
  expect((await memoryOf('ownership')).is_due).toBe(true);
  expect((await memoryOf('ownership')).recall_now).toBeCloseTo(0.88095, 4);

  // Practice picks one question per due concept: the one answered least recently (here,
  // never), and it counts once it is graded.
  const practice = await lc.cli(['practice'], {lines: ['One owner, so drops are known.', 's', 'g']});
  expect(practice.code).toBe(0);
  expect(practice.stdout).toContain('Why can Rust free memory without a garbage collector?');
  const picked = lc.db.query("SELECT question_id, context, counts_for_memory, gap_hours FROM attempts WHERE context = 'practice'").all() as Array<{question_id: string; counts_for_memory: number; gap_hours: number}>;
  expect(picked).toHaveLength(1);
  expect(picked[0]!.question_id).toBe(free);
  expect(picked[0]!.counts_for_memory).toBe(1);
  expect(picked[0]!.gap_hours).toBeGreaterThan(70);
  const after = await memoryOf('ownership');
  expect(after).toMatchObject({reps: 2, is_due: false});
  expect(after.due > '2026-09-25').toBe(true);

  // Nothing is due now, so practice has nothing to offer.
  expect((await lc.cli(['practice'])).stdout).toContain('Nothing is due');
});

test('retention counts delayed, first-try, clean answers; same-day, guessed and hinted ones do not count as retained', async () => {
  const {subject, shortText, mc} = await dayOne();
  const day = async (days: number, question: string, body: Record<string, unknown>) => {
    lc.advance({days});
    const run = (await lc.j(['run', 'start'], {as: 'agent:tutor'})).json.run.id;
    const quiz = await submitQuiz(lc, subject, run, {rationale: 'reviews', items: [{role: 'review', existing: question}]});
    expect(quiz.code).toBe(0);
    return answerQ(lc, {question, quiz: quiz.json.quiz.id, ...body});
  };
  await day(3, shortText, {answer: 'owner', confidence: 'sure'}); // retained
  await day(4, mc, {answer: 'scope', confidence: 'guess'}); // counted, not retained
  await day(5, shortText, {answer: 'owner', confidence: 'think', hints_used: 1}); // counted, not retained

  const progress = (await lc.j(['progress', '--subject', subject])).json.progress;
  expect(progress.retention).toEqual({n: 3, rate: 0.333});
  expect(progress.same_day_accuracy).toEqual({n: 2, rate: 1});
  expect(progress.calibration.by_confidence.guess).toEqual({n: 1, rate: 1});
  expect(progress.concepts).toMatchObject({introduced: 1, total: 4});
  expect(progress.question_types.map((g: {group: string}) => g.group)).toEqual(['multiple_choice', 'short_text']);
  expect(progress.approaches.find((a: {approach: string}) => a.approach === 'worked_example').with).toMatchObject({concepts: 1, n: 3});
  expect(progress.load.budget_minutes).toBe(15);
});
