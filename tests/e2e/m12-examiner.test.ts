/**
 * M12: the examiner. The app draws a checkup's concepts, the examiner writes it from the
 * syllabus alone, the learner answers, and the tutor sees nothing of it until it is
 * finished. Checkup answers never touch memory or the existing measures.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {expireExams} from '../../src/db/exams.ts';
import {answerQ, ownershipLesson, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance({settings: {exam_min_age_days: '1'}});
});
afterEach(async () => {
  await lc.stop();
});

const EXAMINER = {as: 'agent:examiner'};
const TUTOR = {as: 'agent:tutor'};
const KEYS = ['stack-vs-heap', 'ownership', 'moves'];

/** A lesson that introduces three concepts, finished; then a day passes so they can be examined. */
async function threeConcepts() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = ownershipLesson({
    concepts: KEYS.map(key => ({key, role: 'new'})),
    blocks: [{type: 'markdown', approach: 'explanation', concepts: KEYS, body: {md: 'Stack, heap, owners and moves.'}}],
    questions: [],
  });
  const submitted = await submitLesson(lc, subject, run, lesson);
  expect(submitted.code).toBe(0);
  await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'Day one.'], TUTOR);
  await lc.j(['finish', submitted.json.lesson.id]);
  lc.advance({days: 1});
  return {subject, lessonId: submitted.json.lesson.id as string};
}

const question = (key: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  question: {type: 'short_text', aim: 'apply', difficulty: 3, concepts: [key], prompt, body: {accept: ['yes']}, explanation: `About ${key}.`, ...extra},
});
const CHECKUP = {rationale: 'A week in.', items: KEYS.map(k => question(k, `CHECKUP-MARKER about ${k}: is it so?`))};

async function writeCheckup(subject: string, exam: unknown = CHECKUP) {
  const run = (await lc.j(['run', 'start'], EXAMINER)).json.run.id as string;
  const start = await lc.j(['exam', 'start', subject, '--run', run], EXAMINER);
  expect(start.code).toBe(0);
  const submitted = await lc.j(['exam', 'submit', subject, '--run', run, '--file', lc.file('exam.json', exam)], EXAMINER);
  return {run, start, submitted};
}

test('the app draws the concepts; the examiner sees the syllabus and objectives, not the lessons, and must cover every drawn concept', async () => {
  const {subject} = await threeConcepts();
  expect((await lc.j(['exam', 'due'], EXAMINER)).json).toMatchObject({due: true, subjects: [{id: subject, why: 'checkup'}], flags: []});
  expect((await lc.j(['exam', 'due'], TUTOR)).code).toBe(2);

  const run = (await lc.j(['run', 'start'], EXAMINER)).json.run.id;
  const start = await lc.j(['exam', 'start', subject, '--run', run], EXAMINER);
  const context = start.json.context;
  expect(context.plan.concepts.toSorted()).toEqual(KEYS.toSorted());
  expect(context.subject).toMatchObject({title: 'Rust ownership', goal: 'read and change Rust services'});
  expect(context.concepts[0]).toMatchObject({objectives: ['Explain why Rust needs no garbage collector', 'Predict where a value is dropped'], past_prompts: []});
  expect(JSON.stringify(start.json)).not.toContain('Stack, heap, owners and moves');
  // Drawn once a day: asking again gives the same draw.
  expect((await lc.j(['exam', 'start', subject, '--run', run], EXAMINER)).json).toMatchObject({existing: true, context: {plan: {id: context.plan.id}}});

  const refuse = async (exam: unknown, message: string) => {
    const result = await lc.j(['exam', 'submit', subject, '--run', run, '--file', lc.file('bad.json', exam)], EXAMINER);
    expect(result.code).toBe(2);
    expect(result.json.errors.map((e: {message: string}) => e.message).join(' | ')).toContain(message);
  };
  await refuse({items: KEYS.slice(0, 2).map(k => question(k, 'q?'))}, 'nothing asks about "moves"');
  await refuse({items: [...CHECKUP.items, question('borrowing', 'q?')]}, `"borrowing" isn't in this checkup`);
  await refuse({items: [question(KEYS[0]!, 'q?', {hints: ['a hint']}), ...CHECKUP.items.slice(1)]}, 'a checkup gives no hints');
  await refuse(
    {items: [{question: {type: 'free_response', aim: 'transfer', difficulty: 3, concepts: [KEYS[0]], prompt: 'Why?', body: {model_answer: 'x', rubric: ['x']}, explanation: 'x'}}, ...CHECKUP.items.slice(1)]},
    'a checkup is graded by the app',
  );

  const written = await lc.j(['exam', 'submit', subject, '--run', run, '--file', lc.file('exam.json', CHECKUP)], EXAMINER);
  expect(written.code).toBe(0);
  expect(written.json.quiz).toMatchObject({kind: 'exam', state: 'ready', added_by: 'agent:examiner'});
  expect((await lc.j(['exam', 'submit', subject, '--run', run, '--file', lc.file('exam.json', CHECKUP)], EXAMINER)).json.existing).toBe(true);
  expect((await lc.j(['exam', 'due'], EXAMINER)).json.waiting[0]).toMatchObject({why: 'waiting_for_learner'});
});

test('the examiner reads only its own routes, and writes only checkups, runs and fixes to its own questions', async () => {
  const {subject, lessonId} = await threeConcepts();
  for (const args of [['context'], ['due'], ['today'], ['questions'], ['lesson', 'show', lessonId], ['progress']]) {
    expect({args, code: (await lc.j(args, EXAMINER)).code}).toEqual({args, code: 2});
  }
  expect((await lc.j(['agents'], EXAMINER)).code).toBe(0);
  const run = (await lc.j(['run', 'start'], EXAMINER)).json.run.id;
  const lesson = await lc.j(['lesson', 'submit', subject, '--day', lc.ctx().today(), '--run', run, '--file', lc.file('l.json', ownershipLesson())], EXAMINER);
  expect(lesson.code).toBe(2);
  expect(lesson.json.error).toContain("is the learner's or the tutor's to do");
  expect((await lc.j(['notes', 'set', '--stdin', '--note', 'x'], {...EXAMINER, stdin: 'x'})).code).toBe(2);
});

test('the tutor sees nothing of a checkup before it is finished, and its results after', async () => {
  const {subject} = await threeConcepts();
  const {submitted} = await writeCheckup(subject);
  const quizId = submitted.json.quiz.id as string;
  const [first, second, third] = submitted.json.question_ids as [string, string, string];

  // The learner sees it as a checkup on Today; the tutor doesn't see it at all.
  expect((await lc.j(['today'])).json.subjects[0].quizzes.map((q: {kind: string}) => q.kind)).toEqual(['exam']);
  expect((await lc.j(['today'], TUTOR)).json.subjects[0].quizzes).toEqual([]);
  const answered = await answerQ(lc, {question: first, quiz: quizId, answer: 'yes'});
  expect(answered.attempt).toMatchObject({context: 'exam', role: 'exam', counts_for_memory: false});
  for (const args of [['quiz', 'show', quizId], ['question', 'show', first]]) {
    expect({args, code: (await lc.j(args, TUTOR)).code}).toEqual({args, code: 3});
  }
  const attempt = await fetch(`${lc.url}/api/attempts/${answered.attempt.id}`, {headers: {authorization: `Bearer ${lc.token('agent:tutor')}`}});
  expect(attempt.status).toBe(404);
  const before = JSON.stringify((await lc.j(['context'], TUTOR)).json);
  expect(before).not.toContain('CHECKUP-MARKER');
  expect(before).not.toContain(quizId);
  expect(JSON.stringify((await lc.j(['questions', '--status', 'all'], TUTOR)).json)).not.toContain('CHECKUP-MARKER');

  await answerQ(lc, {question: second, quiz: quizId, answer: 'no', confidence: 'sure'});
  await answerQ(lc, {question: third, quiz: quizId, answer: 'yes', confidence: 'guess'});
  const context = (await lc.j(['context'], TUTOR)).json;
  const exams = context.subjects[0].exams;
  expect(exams).toHaveLength(1);
  expect(exams[0].items.map((i: {score: number}) => i.score)).toEqual([1, 0, 1]);
  expect(exams[0].items[0].prompt).toContain('CHECKUP-MARKER');
  // Checkup questions are never reused: still not the tutor's to put in a quiz.
  const run = await startRun(lc);
  expect((await submitQuiz(lc, subject, run, {rationale: 'r', items: [{role: 'review', existing: first}]})).code).toBe(2);

  // Delayed by a day since the lesson: one right, one wrong, one a guess. Nothing in memory yet,
  // so the memory model has no expectation.
  const progress = (await lc.j(['progress', '--subject', subject])).json.progress;
  expect(progress.exams).toMatchObject({checkups: 1, score: {n: 3, rate: 0.333}, expected: null, gap: null});
  expect(progress.exams.by_aim).toEqual([{aim: 'apply', n: 3, rate: 0.333}]);
});

test('checkup answers leave memory, the existing measures and later reviews\' gaps unchanged', async () => {
  const {subject} = await threeConcepts();
  // A daily quiz first, so ownership has a memory.
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, ownershipLesson({concepts: [{key: 'ownership', role: 'deepen'}]}));
  const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id));
  await lc.j(['finish', lesson.json.lesson.id]);
  await answerQ(lc, {question: quiz.json.question_ids[0], quiz: quiz.json.quiz.id, answer: 'owner'});
  const memoryBefore = lc.db.query("SELECT * FROM concept_memory m JOIN concepts c ON c.id = m.concept_id WHERE c.key = 'ownership'").get();
  const progressBefore = (await lc.j(['progress', '--subject', subject])).json.progress;

  lc.advance({days: 2});
  const {submitted} = await writeCheckup(subject);
  for (const id of submitted.json.question_ids) await answerQ(lc, {question: id, quiz: submitted.json.quiz.id, answer: 'no'});
  expect(lc.db.query("SELECT * FROM concept_memory m JOIN concepts c ON c.id = m.concept_id WHERE c.key = 'ownership'").get()).toEqual(memoryBefore);
  const progressAfter = (await lc.j(['progress', '--subject', subject])).json.progress;
  for (const key of ['retention', 'same_day_accuracy', 'calibration', 'misconceptions', 'question_types', 'aims']) expect({key, value: progressAfter[key]}).toEqual({key, value: progressBefore[key]});
  // The memory model now has something to expect from: ownership was reviewed two days before.
  expect(progressAfter.exams.expected).toBeGreaterThan(0.5);

  // A review an hour after the checkup is still two days after the learner last met the idea.
  lc.advance({hours: 1});
  const review = await submitQuiz(lc, subject, await startRun(lc), {rationale: 'due', items: [{role: 'review', existing: quiz.json.question_ids[0]}]});
  const reviewed = await answerQ(lc, {question: quiz.json.question_ids[0], quiz: review.json.quiz.id, answer: 'owner'});
  expect(reviewed.attempt.gap_hours).toBeGreaterThan(48);
  expect(reviewed.attempt.counts_for_memory).toBe(true);
});

test('flags on a checkup go to the examiner; asks wait until it is finished', async () => {
  const {subject} = await threeConcepts();
  const {run, submitted} = await writeCheckup(subject);
  const [first] = submitted.json.question_ids as [string];
  const flag = await lc.j(['rate', 'question', first, 'wrong_key', '--note', '"yep" should count']);
  expect(flag.code).toBe(0);
  expect((await lc.j(['ask', first, 'Why is this the answer?'])).code).toBe(1);

  expect((await lc.j(['due'], TUTOR)).json.subjects.map((s: {why: string}) => s.why)).not.toContain('needs_fix');
  expect((await lc.j(['reply', flag.json.feedback.id, '--body', 'x'], TUTOR)).code).toBe(3);
  const due = (await lc.j(['exam', 'due'], EXAMINER)).json;
  expect(due.flags).toEqual([expect.objectContaining({id: flag.json.feedback.id, kind: 'wrong_key', question: expect.objectContaining({id: first})})]);

  const fixed = {...CHECKUP.items[0]!.question, body: {accept: ['yes', 'yep']}};
  const fix = await lc.j(['question', 'fix', first, '--file', lc.file('q.json', fixed), '--resolve', flag.json.feedback.id, '--reply', 'Accepts "yep" now.'], EXAMINER);
  expect(fix.code).toBe(0);
  expect(lc.db.query('SELECT status, version FROM questions WHERE id = ?').get(first)).toEqual({status: 'exam', version: 2});
  expect((await lc.j(['exam', 'due'], EXAMINER)).json.flags).toEqual([]);
  // The examiner can't touch the tutor's questions, nor turn a checkup question into one with hints.
  expect((await lc.j(['question', 'fix', first, '--file', lc.file('q.json', {...fixed, hints: ['h']})], EXAMINER)).code).toBe(2);
  expect(run).toBeString();
});

test('a checkup left unfinished expires, and the tutor still sees nothing of it', async () => {
  const {subject} = await threeConcepts();
  const {submitted} = await writeCheckup(subject);
  const quizId = submitted.json.quiz.id as string;
  lc.advance({days: 3});
  expect((await lc.j(['today'])).json.subjects[0].quizzes.filter((q: {kind: string}) => q.kind === 'exam')).toEqual([]);
  const late = await answerQ(lc, {question: submitted.json.question_ids[0], quiz: quizId, answer: 'yes'});
  expect(late.ok).toBe(false);
  expect(expireExams(lc.ctx())).toEqual([quizId]);
  expect(lc.db.query('SELECT state FROM quizzes WHERE id = ?').get(quizId)).toEqual({state: 'skipped'});
  expect(JSON.stringify((await lc.j(['context'], TUTOR)).json)).not.toContain('CHECKUP-MARKER');
  // Seven days after the last one, the next is due.
  lc.advance({days: 4});
  expect((await lc.j(['exam', 'due'], EXAMINER)).json.subjects).toEqual([{id: subject, title: 'Rust ownership', why: 'checkup'}]);
});
