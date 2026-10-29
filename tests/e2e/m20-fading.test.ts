/**
 * M20: fading on evidence. Each concept in the tutor's context says how durable it is
 * (`stability_days`) and what kinds of block taught it (`taught_with`); and a two-arm lesson
 * can count every concept it teaches (`counts: "taught"`), so keeping a picture against
 * fading it, on an idea already met, is measured by the reviews that follow.
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
const DIAGRAM = 'flowchart TD\n  s1["s1 owns the buffer"] -->|closing brace| drop["freed, once"]\n  class drop focus';

function fadingLesson(counts: 'taught' | 'new') {
  return {
    title: 'Ownership again, with or without the picture',
    objectives: ['Say who frees a value, and when'],
    estimated_minutes: 3,
    rationale: 'Ownership holds; does the diagram still help?',
    concepts: [{key: 'ownership', role: 'review'}],
    experiment: {name: 'keep_vs_fade', arms: {a: 'the diagram again', b: 'the same words, no diagram'}, counts},
    blocks: [
      {type: 'markdown', approach: 'retrieval', concepts: ['ownership'], body: {md: 'Before reading on: who frees a `String`, and when?'}},
      {type: 'diagram', approach: 'visual', concepts: ['ownership'], arm: 'a', body: {mermaid: DIAGRAM, alt: 's1 owns the buffer; at the closing brace it is freed, once.'}},
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], arm: 'b', body: {md: 'Its owner frees it, once, at the closing brace of the owner’s scope: no garbage collector, no manual free.'}},
    ],
  };
}

test('a taught-counting experiment measures a review lesson by the reviews after it; the context says how durable each concept is', async () => {
  const subject = await rustSubject(lc);
  // Day 0: ownership is introduced and quizzed.
  const first = await submitLesson(lc, subject, await startRun(lc));
  const quiz = await submitQuiz(lc, subject, await startRun(lc), ownershipQuiz(first.json.lesson.id));
  const shortText = quiz.json.question_ids[0] as string;
  await lc.j(['finish', first.json.lesson.id]);
  expect((await answerQ(lc, {question: shortText, quiz: quiz.json.quiz.id, answer: 'owner'})).ok).toBe(true);

  // Day 1: the same idea again, the diagram kept in one arm and faded in the other.
  lc.advance({days: 1});
  const run = await startRun(lc);
  const fading = await submitLesson(lc, subject, run, fadingLesson('taught'));
  expect(fading.code).toBe(0);
  // An experiment keeps what it counts.
  const changed = await lc.j(['lesson', 'revise', fading.json.lesson.id, '--file', lc.file('l.json', fadingLesson('new'))], TUTOR);
  expect(changed.code).toBe(1);
  expect(changed.json.error).toContain('"counts": "taught"');
  await lc.j(['finish', fading.json.lesson.id]);
  const arm = (lc.db.query('SELECT arm FROM lesson_arms WHERE lesson_id = ?').get(fading.json.lesson.id) as {arm: 'a' | 'b'}).arm;

  const concept = (await lc.j(['context'], TUTOR)).json.subjects[0].concepts.find((c: {key: string}) => c.key === 'ownership');
  expect(concept.stability_days).toBeGreaterThan(0);
  expect(concept.taught_with).toEqual(expect.arrayContaining(['code', 'markdown', 'question', ...(arm === 'a' ? ['diagram'] : [])]));
  if (arm === 'b') expect(concept.taught_with).not.toContain('diagram');

  // Day 3: a delayed review of ownership counts for the arm the learner saw.
  lc.advance({days: 2});
  const review = await submitQuiz(lc, subject, await startRun(lc), {rationale: 'Ownership is due.', items: [{role: 'review', existing: shortText, predict: 0.8}]});
  expect(review.code).toBe(0);
  expect((await answerQ(lc, {question: shortText, quiz: review.json.quiz.id, answer: 'owner'})).ok).toBe(true);

  const [experiment] = (await lc.j(['context'], TUTOR)).json.subjects[0].measures.experiments;
  const other = arm === 'a' ? 'b' : 'a';
  expect(experiment).toMatchObject({name: 'keep_vs_fade', counts: 'taught', [arm]: {lessons: 1, concepts: 1, retention: {n: 1, rate: 1}}, [other]: {lessons: 0, concepts: 0, retention: {n: 0}}});
});

test('an experiment counts what its lessons introduce unless it says otherwise', async () => {
  const subject = await rustSubject(lc);
  const lesson = ownershipLesson({experiment: {name: 'worked_vs_told', arms: {a: 'worked', b: 'told'}}});
  lesson.blocks = [...lesson.blocks, {type: 'markdown', approach: 'explanation', concepts: ['ownership'], arm: 'a', body: {md: 'a'}}, {type: 'markdown', approach: 'explanation', concepts: ['ownership'], arm: 'b', body: {md: 'b'}}] as never;
  const submitted = await submitLesson(lc, subject, await startRun(lc), lesson);
  expect(submitted.code).toBe(0);
  expect((await lc.j(['experiments'])).json.experiments[0]).toMatchObject({name: 'worked_vs_told', counts: 'new'});
  await lc.j(['finish', submitted.json.lesson.id]);
  const bad = ownershipLesson({experiment: {name: 'x', arms: {a: 'a', b: 'b'}, counts: 'all'}});
  lc.advance({days: 1});
  const refused = await submitLesson(lc, subject, await startRun(lc), bad);
  expect(refused.json.errors).toContainEqual({path: 'experiment.counts', message: 'must be one of new, taught'});
});
