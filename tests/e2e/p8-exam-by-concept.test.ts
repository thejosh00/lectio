/**
 * #8: a finished checkup's results per concept stay in the subject's measures for every run
 * after it, not only the one run whose `exams` shows its questions. Counts only: no question
 * text and no answers outlive that window.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {answerQ, ownershipLesson, rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
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

const item = (key: string) => ({
  question: {type: 'short_text', aim: key === 'moves' ? 'transfer' : 'apply', difficulty: 3, concepts: [key], prompt: `CHECKUP-MARKER about ${key}: is it so?`, body: {accept: ['yes']}, explanation: `About ${key}.`},
});

test('the tutor can name the concepts a checkup missed in every run after it, from counts alone', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, ownershipLesson({
    concepts: KEYS.map(key => ({key, role: 'new'})),
    blocks: [{type: 'markdown', approach: 'explanation', concepts: KEYS, body: {md: 'Stack, heap, owners and moves.'}}],
    questions: [],
  }));
  expect(lesson.code).toBe(0);
  await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'Day one.'], TUTOR);
  await lc.j(['finish', lesson.json.lesson.id]);
  lc.advance({days: 1});

  // Before any checkup: the field is there, and empty.
  const empty = (await lc.j(['context'], TUTOR)).json.subjects[0].measures.exams;
  expect(empty).toMatchObject({checkups: 0, by_concept: []});

  const examRun = (await lc.j(['run', 'start'], EXAMINER)).json.run.id as string;
  expect((await lc.j(['exam', 'start', subject, '--run', examRun], EXAMINER)).code).toBe(0);
  const submitted = await lc.j(['exam', 'submit', subject, '--run', examRun, '--file', lc.file('exam.json', {items: KEYS.map(item)})], EXAMINER);
  expect(submitted.code).toBe(0);
  const quiz = submitted.json.quiz.id as string;
  const ids = submitted.json.question_ids as string[];
  const keyOf = new Map<string, string>();
  for (const id of ids) keyOf.set(id, (lc.db.query('SELECT c.key FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id WHERE qc.question_id = ?').get(id) as {key: string}).key);
  // Stack-vs-heap right; ownership wrong; moves right but a guess.
  const answer = {'stack-vs-heap': {answer: 'yes'}, ownership: {answer: 'no'}, moves: {answer: 'yes', confidence: 'guess' as const}};
  for (const id of ids) await answerQ(lc, {question: id, quiz, ...answer[keyOf.get(id) as keyof typeof answer]});
  const day = lc.ctx().today();
  const expected = [
    {concept: 'moves', asked: 1, right: 0, aims: ['transfer'], last_checkup: day, last_asked: 1, last_right: 0},
    {concept: 'ownership', asked: 1, right: 0, aims: ['apply'], last_checkup: day, last_asked: 1, last_right: 0},
    {concept: 'stack-vs-heap', asked: 1, right: 1, aims: ['apply'], last_checkup: day, last_asked: 1, last_right: 1},
  ];

  // The run after it finishes: the questions in `exams`, and the counts in the measures.
  const first = (await lc.j(['context'], TUTOR)).json.subjects[0];
  expect(first.exams).toHaveLength(1);
  expect(first.measures.exams).toMatchObject({checkups: 1, by_concept: expected});
  lc.advance({hours: 1});
  const tutorRun = await startRun(lc);
  await lc.j(['run', 'finish', tutorRun, '--outcome', 'ok', '--summary', 'Read the checkup.'], TUTOR);

  // Every run after: `exams` is gone, the counts stay, and nothing of the questions does.
  lc.advance({days: 3});
  const later = (await lc.j(['context'], TUTOR)).json.subjects[0];
  expect(later.exams).toEqual([]);
  expect(later.measures.exams.by_concept).toEqual(expected);
  expect(JSON.stringify(later)).not.toContain('CHECKUP-MARKER');
  // The learner's progress carries the same counts.
  expect((await lc.j(['progress', '--subject', subject])).json.progress.exams.by_concept).toEqual(expected);
});
