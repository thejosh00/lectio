/**
 * #7: a daily quiz can be corrected while it hasn't been opened. The learner sees the new
 * rationale and items, what it dropped doesn't come back in practice, and it is refused once
 * the quiz is opened.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
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

async function quizDay() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, ownershipLesson());
  const lessonId = lesson.json.lesson.id as string;
  const quiz = await submitQuiz(lc, subject, run, {...ownershipQuiz(lessonId), rationale: 'A false sentence.'});
  expect(quiz.code).toBe(0);
  return {subject, run, lessonId, quizId: quiz.json.quiz.id as string, questionIds: quiz.json.question_ids as string[]};
}

const revise = (quizId: string, body: unknown, as = TUTOR) => lc.j(['quiz', 'revise', quizId, '--file', lc.file('quiz.json', JSON.stringify(body))], as);
const shown = async (quizId: string) => (await lc.j(['quiz', 'show', quizId])).json.quiz;
const statusOf = async (question: string) => (lc.db.query('SELECT status FROM questions WHERE id = ?').get(question) as {status: string}).status;

test('a revise replaces the rationale and items the learner sees, and retires what it dropped', async () => {
  const {lessonId, quizId, questionIds} = await quizDay();
  const fixed = ownershipQuiz(lessonId) as {items: Array<{role: string; question: {prompt: string}}>};
  const items = [{role: 'new', existing: questionIds[0]}, {...fixed.items[1]!, question: {...fixed.items[1]!.question, prompt: 'When, exactly, is a `String` freed?'}}];
  const revised = await revise(quizId, {lesson: lessonId, rationale: 'What is true.', items});
  expect(revised.code).toBe(0);
  expect(revised.json).toMatchObject({existing: false, superseded: [], quiz: {id: quizId, state: 'ready', rationale: 'What is true.'}, estimate_minutes: expect.any(Number), learner_estimate: {calibrated: false}});
  expect(revised.json.question_ids[0]).toBe(questionIds[0]);
  expect(questionIds).not.toContain(revised.json.question_ids[1]);

  const after = await shown(quizId);
  expect(after.rationale).toBe('What is true.');
  expect(after.items.map((i: {question: {prompt: string}}) => i.question.prompt)).toEqual(['What is the variable responsible for freeing a value called?', 'When, exactly, is a `String` freed?']);
  expect(await statusOf(questionIds[0]!)).toBe('active');
  for (const dropped of questionIds.slice(1)) expect(await statusOf(dropped)).toBe('retired');

  // The record of what it said before is kept, and a second revise still retires what the first wrote.
  const events = lc.db.query("SELECT change FROM events WHERE entity = 'quiz' AND entity_id = ?").all(quizId) as Array<{change: string}>;
  const event = events.map(e => JSON.parse(e.change)).find(c => c.kind === 'revised');
  expect(event.before.rationale).toBe('A false sentence.');
  expect(event.before.items).toHaveLength(questionIds.length);
  const again = await revise(quizId, {lesson: lessonId, rationale: 'Shorter.', items: items.slice(0, 1)});
  expect(again.code).toBe(0);
  expect(await statusOf(revised.json.question_ids[1])).toBe('retired');
});

test('a question the quiz brought back is left alone when a revise drops it', async () => {
  const {subject, lessonId, questionIds} = await quizDay();
  await lc.j(['finish', lessonId]);
  lc.advance({days: 1});
  const run = await startRun(lc);
  const review = await submitQuiz(lc, subject, run, {rationale: 'Reviews.', items: [{role: 'review', existing: questionIds[0], predict: 0.7}, {role: 'review', existing: questionIds[1], predict: 0.7}]});
  expect(review.code).toBe(0);
  const revised = await revise(review.json.quiz.id, {rationale: 'One review.', items: [{role: 'review', existing: questionIds[0], predict: 0.7}]});
  expect(revised.code).toBe(0);
  expect(await statusOf(questionIds[1]!)).toBe('active');
});

test('an inline check of the lesson, brought into the quiz, is left alone when a revise drops it', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, ownershipLesson());
  const lessonId = lesson.json.lesson.id as string;
  const inline = lesson.json.question_ids.q1 as string;
  const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lessonId, inline));
  expect(quiz.code).toBe(0);
  expect(quiz.json.question_ids).toContain(inline);
  const revised = await revise(quiz.json.quiz.id, ownershipQuiz(lessonId));
  expect(revised.code).toBe(0);
  expect(await statusOf(inline)).toBe('active');
});

test('a dropped question already used by another quiz stays, and a warning names it', async () => {
  const {lessonId, quizId, questionIds} = await quizDay();
  lc.db.query("INSERT INTO quizzes (id, subject_id, day, kind, rationale, added_by, state, added) SELECT 'other', subject_id, '2000-01-01', 'practice', '', 'app', 'ready', added FROM quizzes WHERE id = ?").run(quizId);
  lc.db.query("INSERT INTO quiz_items (quiz_id, position, question_id, role) VALUES ('other', 0, ?, 'review')").run(questionIds[0]!);
  const revised = await revise(quizId, {lesson: lessonId, rationale: 'Without the first.', items: [{role: 'new', existing: questionIds[1], predict: 0.8}]});
  expect(revised.code).toBe(0);
  expect(await statusOf(questionIds[0]!)).toBe('active');
  expect(revised.json.warnings.join(' ')).toContain(`question ${questionIds[0]} left this quiz`);
});

test('a revise runs the same checks and warnings as a submit, and changes nothing when refused', async () => {
  const {lessonId, quizId, questionIds} = await quizDay();
  const bad = await revise(quizId, {lesson: lessonId, rationale: 'Bad.', items: [{role: 'probe', existing: questionIds[0]}]});
  expect(bad.code).toBe(2);
  expect(bad.json.errors.map((e: {path: string}) => e.path)).toEqual(['items[0].role']);
  expect((await shown(quizId)).rationale).toBe('A false sentence.');
  expect((await shown(quizId)).items).toHaveLength(questionIds.length);
  expect(await statusOf(questionIds[0]!)).toBe('active');

  const unpredicted = await revise(quizId, {lesson: lessonId, rationale: 'No predictions.', items: [{role: 'new', existing: questionIds[0]}]});
  expect(unpredicted.code).toBe(0);
  expect(unpredicted.json.warnings.join(' ')).toContain('have no predict');
});

test('resubmitting the same day still changes nothing', async () => {
  const {subject, run, lessonId, quizId} = await quizDay();
  const again = await submitQuiz(lc, subject, run, {...ownershipQuiz(lessonId), rationale: 'Corrected?'});
  expect(again.json).toMatchObject({existing: true, quiz: {id: quizId}});
  expect((await shown(quizId)).rationale).toBe('A false sentence.');
});

test('it is refused once the quiz is opened, and for a superseded or practice quiz', async () => {
  const {subject, lessonId, quizId, questionIds} = await quizDay();
  await lc.j(['finish', lessonId]);
  const body = {lesson: lessonId, rationale: 'Too late.', items: [{role: 'new', existing: questionIds[0], predict: 0.8}]};
  await answerQ(lc, {question: questionIds[0]!, quiz: quizId, answer: 'owner'});
  const late = await revise(quizId, body);
  expect(late.code).toBe(1);
  expect(late.json.error).toContain("only a quiz that hasn't been opened");
  expect((await shown(quizId)).rationale).toBe('A false sentence.');

  // Superseded: yesterday's still-unstarted quiz, replaced by today's.
  lc.advance({days: 1});
  const run = await startRun(lc);
  const second = await submitQuiz(lc, subject, run, {rationale: 'R.', items: [{role: 'review', existing: questionIds[1], predict: 0.7}]});
  lc.advance({days: 1});
  const third = await submitQuiz(lc, subject, await startRun(lc), {rationale: 'R.', items: [{role: 'review', existing: questionIds[1], predict: 0.7}]});
  expect(third.json.superseded).toEqual([second.json.quiz.id]);
  expect((await revise(second.json.quiz.id, {rationale: 'X.', items: [{role: 'review', existing: questionIds[1], predict: 0.7}]})).code).toBe(1);

  lc.db.query("INSERT INTO quizzes (id, subject_id, day, kind, rationale, added_by, state, added) VALUES ('prac', ?, '2000-01-01', 'practice', '', 'app', 'ready', '2000-01-01T00:00:00Z')").run(subject);
  const practice = await revise('prac', {rationale: 'X.', items: [{role: 'review', existing: questionIds[1], predict: 0.7}]});
  expect(practice.code).toBe(1);
  expect(practice.json.error).toContain('assembled by the app');
});
