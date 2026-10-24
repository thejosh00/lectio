/**
 * M11: the tutor's predictions — stored with the quiz, scored against what happened beside
 * a formula, shown to the learner only once an answer is graded, and refused where there
 * is nothing to score.
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

const asLearner = async (path: string) => (await (await fetch(`${lc.url}${path}`, {headers: {authorization: `Bearer ${lc.token('you')}`}})).json()) as any;
const selfGrade = async (attempt: string, grade: string) =>
  (await (
    await fetch(`${lc.url}/api/attempts/${attempt}/self-grade`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, body: JSON.stringify({grade})})
  ).json()) as any;

/** Today's ownership quiz, with a prediction on every item. */
function predictedQuiz(lessonId: string, inline: string) {
  const quiz = ownershipQuiz(lessonId, inline);
  const predictions = [0.9, 0.2, 0.5, 0.7];
  return {...quiz, items: quiz.items.map((item, i) => ({...(item as object), predict: predictions[i]}))};
}

async function dayOne() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run);
  const lessonId = lesson.json.lesson.id as string;
  const inline = lesson.json.question_ids.q1 as string;
  const quiz = await submitQuiz(lc, subject, run, predictedQuiz(lessonId, inline));
  expect(quiz.code).toBe(0);
  const [shortText, mc, free] = quiz.json.question_ids as [string, string, string];
  return {subject, run, lessonId, inline, quiz, quizId: quiz.json.quiz.id as string, shortText, mc, free};
}

test('predictions are stored with the quiz, and an off-target mean on new items is a warning about the questions', async () => {
  const {quiz, quizId} = await dayOne();
  // The new items average 53% against a target of 85%.
  expect(quiz.json.warnings).toEqual([expect.stringContaining('change the questions (easier), not the predictions')]);
  const shown = (await lc.j(['quiz', 'show', quizId], {as: 'agent:tutor'})).json.quiz;
  expect(shown.items.map((i: {predicted: number}) => i.predicted)).toEqual([0.9, 0.2, 0.5, 0.7]);
});

test('the learner sees a prediction only once the answer is graded: after the reveal, or after the self-grade', async () => {
  const {lessonId, quizId, shortText, free} = await dayOne();
  await lc.j(['finish', lessonId]);
  const before = await asLearner(`/api/quizzes/${quizId}`);
  expect(JSON.stringify(before)).not.toContain('predicted');

  const right = await answerQ(lc, {question: shortText, quiz: quizId, answer: 'owner'});
  expect(right.outcome.predicted).toBe(0.9);

  const pending = await answerQ(lc, {question: free, quiz: quizId, answer: 'One owner, so the compiler knows where to drop.'});
  expect(pending.outcome.needs_self_grade).toBe(true);
  expect(pending.outcome.predicted).toBeNull();
  const graded = await selfGrade(pending.attempt.id, 'got_it');
  expect(graded.ok).toBe(true);
  expect(graded.outcome.predicted).toBe(0.5);

  // And in the quiz view, answered items carry it while unanswered ones say nothing.
  const after = await asLearner(`/api/quizzes/${quizId}`);
  const items = after.quiz.items as Array<{answered: {predicted: number | null} | null}>;
  expect(items.map(i => i.answered?.predicted ?? null)).toEqual([0.9, null, 0.5, null]);
  expect(items.some(i => 'predicted' in i)).toBe(false);
});

test('progress scores the tutor against the formula, and a confident miss is a surprise with its question', async () => {
  const {subject, lessonId, quizId, inline, shortText, mc, free} = await dayOne();
  await lc.j(['finish', lessonId]);
  // A minute apart, as real answers are: the first of the day is the one memory counts.
  await answerQ(lc, {question: shortText, quiz: quizId, answer: 'owner'});
  lc.advance({minutes: 1});
  await answerQ(lc, {question: mc, quiz: quizId, answer: 'gc'});
  lc.advance({minutes: 1});
  const freeAttempt = await answerQ(lc, {question: free, quiz: quizId, answer: 'One owner.'});
  await selfGrade(freeAttempt.attempt.id, 'got_it');
  lc.advance({minutes: 1});
  await answerQ(lc, {question: inline, quiz: quizId, answer: 'b'});

  let p = (await lc.j(['progress', '--subject', subject])).json.progress.predictions;
  expect(p.n).toBe(4);
  // Tutor: (0.1² + 0.2² + 0.5² + 0.3²) / 4. The formula has no memory to go on yet and
  // too few same-day answers before the quiz, so it says the target, 0.85, every time.
  expect(p.tutor.brier).toBeCloseTo(0.0975, 2);
  expect(p.formula.brier).toBeCloseTo((0.15 ** 2 * 3 + 0.85 ** 2) / 4, 2);
  expect(p.skill).toBeGreaterThan(0);
  expect(p.surprises).toEqual([]);

  // Two days on, a review the tutor was sure of is missed.
  lc.advance({days: 2});
  const run = await startRun(lc);
  const review = await submitQuiz(lc, subject, run, {rationale: 'ownership is due', items: [{role: 'review', existing: shortText, predict: 0.95}]});
  expect(review.code).toBe(0);
  const taken = await lc.cli(['quiz'], {lines: ['nobody', 's', '']});
  expect(taken.code).toBe(0);
  expect(taken.stdout).toContain('your tutor gave this a 95% chance');

  p = (await lc.j(['progress', '--subject', subject])).json.progress.predictions;
  expect(p.n).toBe(5);
  expect(p.surprises).toHaveLength(1);
  expect(p.surprises[0]).toMatchObject({question_id: shortText, predicted: 0.95, score: 0, answer: 'nobody', concept_keys: ['ownership']});
  expect(p.surprises[0].prompt).toContain('responsible for freeing');
  // Now the formula has a memory to replay: FSRS recall two days after one good review.
  expect(p.surprises[0].formula).toBeGreaterThan(0.85);
  expect(p.surprises[0].formula).toBeLessThan(1);

  // The tutor's context shows each answer beside what it predicted.
  const context = (await lc.j(['context'], {as: 'agent:tutor'})).json;
  const attempts = context.subjects[0].attempts_since_last_run as Array<{question: {id: string}; predicted: number | null; context: string}>;
  expect(attempts.filter(a => a.question.id === shortText && a.context === 'quiz').map(a => a.predicted)).toEqual([0.9, 0.95]);
  expect(context.subjects[0].measures.predictions.n).toBe(5);
});

test('a placement quiz refuses predictions: probes are never scored', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const placement = {
    rationale: 'Where to start.',
    items: [
      {
        role: 'probe',
        predict: 0.5,
        question: {type: 'short_text', aim: 'recall', difficulty: 1, concepts: ['stack-vs-heap'], prompt: 'Where do fixed-size locals live?', body: {accept: ['stack', 'the stack']}, explanation: 'On the stack.'},
      },
    ],
  };
  const refused = await submitQuiz(lc, subject, run, placement, 'placement');
  expect(refused.code).toBe(2);
  expect(refused.json.errors).toEqual([{path: 'items[0].predict', message: 'probes are never scored, so there is nothing to predict'}]);
});
