/**
 * M19: pictures in practice. A question can carry a figure it asks about and an answer figure
 * shown only with the answer; both are checked like any picture, wherever a question is
 * written (lesson, quiz, fix); a fix that changes one is a new version; and the measures
 * count questions with a picture beside those without.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {questionSeconds, SECONDS_PER_QUESTION} from '../../src/blocks/question.ts';
import {answerQ, ownershipLesson, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};
const POINTS = 'flowchart TD\n  A["A: after String::from"] -->|let s2 = s1| B["B: after the move"]';
const SKETCH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 120" font-size="14"><rect x="10" y="20" width="60" height="30"/><text x="22" y="40">s2</text></svg>';

const labelling = (over: Record<string, unknown> = {}) => ({
  ref: 'q2',
  type: 'matching',
  aim: 'understand',
  difficulty: 3,
  concepts: ['ownership'],
  prompt: 'Who owns the buffer at each lettered point?',
  figure: {mermaid: POINTS, alt: 'A, just after String::from; B, after let s2 = s1.'},
  body: {left: [{id: 'A', md: 'A'}, {id: 'B', md: 'B'}], right: [{id: 's1', md: '`s1`'}, {id: 's2', md: '`s2`'}], answer: {A: 's1', B: 's2'}},
  explanation: 's1 owns it, then s2.',
  ...over,
});

async function lessonWithFigures() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const sketch = (await lc.j(['asset', 'put', lc.file('sketch.svg', SKETCH)], TUTOR)).json.asset.id as string;
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q2'}}] as never;
  lesson.questions = [...lesson.questions, labelling({answer_figure: {asset: sketch, alt: 'The labelled diagram: A is s1, B is s2.'}})] as never;
  const submitted = await submitLesson(lc, subject, run, lesson);
  expect(submitted.code).toBe(0);
  return {subject, run, sketch, lessonId: submitted.json.lesson.id as string, questionId: submitted.json.question_ids.q2 as string};
}

test('the learner sees the figure with the prompt, and the answer figure only once they have answered', async () => {
  const {sketch, lessonId, questionId} = await lessonWithFigures();
  const learner = (await lc.j(['lesson', 'show', lessonId])).json.lesson.blocks[4];
  expect(learner.question).toMatchObject({figure: {mermaid: POINTS, alt: 'A, just after String::from; B, after let s2 = s1.'}});
  expect(JSON.stringify(learner)).not.toContain(sketch);
  expect(learner.text).toBe('[Check: q2]');
  // The terminal says there is a picture.
  expect((await lc.cli(['lesson', 'show', lessonId])).stdout).toContain('[figure: A, just after String::from; B, after let s2 = s1.]');

  const answered = await answerQ(lc, {question: questionId, lesson: lessonId, answer: {A: 's1', B: 's1'}});
  expect(answered.outcome).toMatchObject({score: 0.5, answer_figure: {asset: sketch, alt: 'The labelled diagram: A is s1, B is s2.'}});
  // The tutor's context says which question carried a picture.
  const attempt = (await lc.j(['context'], TUTOR)).json.subjects[0].attempts_since_last_run.find((a: {question: {id: string}}) => a.question.id === questionId);
  expect(attempt.question.figure).toBe('A, just after String::from; B, after let s2 = s1.');
  // And the measures count it beside those without.
  const groups = (await lc.j(['context'], TUTOR)).json.subjects[0].measures.question_figures.map((g: {group: string}) => g.group);
  expect(groups).toContain('with_figure');
});

test('a broken figure is refused where it sits; a long diagram is warned about; a fix that changes the figure is a new version', async () => {
  const {subject, run, lessonId} = await lessonWithFigures();
  const item = (question: Record<string, unknown>) => ({lesson: lessonId, rationale: 'x', items: [{role: 'new', predict: 0.7, question}]});
  const {ref: _ref, ...question} = labelling();
  const broken = await submitQuiz(lc, subject, run, item({...question, figure: {mermaid: 'flowchart TD\n  A -->', alt: 'x'}}));
  expect(broken.code).toBe(2);
  expect(broken.json.errors).toEqual([{path: 'items[0].question.figure.mermaid', message: expect.stringContaining("doesn't parse as mermaid")}]);
  const both = await submitQuiz(lc, subject, run, item({...question, figure: {mermaid: POINTS, asset: 'a'.repeat(64), alt: 'x'}}));
  expect(both.json.errors.map((e: {path: string}) => e.path)).toEqual(['items[0].question.figure']);

  const wide = `flowchart LR\n  ${'ABCDEF'.split('').join(' --> ')}`;
  const quiz = await submitQuiz(lc, subject, run, item({...question, figure: {mermaid: wide, alt: 'six points in a row'}}));
  expect(quiz.code).toBe(0);
  expect(quiz.json.warnings).toContainEqual(expect.stringMatching(/^items\[0\]\.question\.figure\.mermaid: 6 nodes left to right/));

  const id = quiz.json.question_ids[0] as string;
  const fix = (figure: unknown) => lc.j(['question', 'fix', id, '--stdin'], {...TUTOR, stdin: JSON.stringify({...question, figure})});
  const fixed = await fix({mermaid: wide.replace('LR', 'TD'), alt: 'six points, top to bottom'});
  expect(fixed.json).toMatchObject({changed: true, question: {version: 2, figure: {mermaid: wide.replace('LR', 'TD')}}, warnings: []});
  expect((await fix({mermaid: wide.replace('LR', 'TD'), alt: 'six points, top to bottom'})).json).toMatchObject({changed: false, question: {version: 2}});
  expect((await fix({mermaid: 'flowchart TD\n  A -->', alt: 'x'})).json.errors).toEqual([{path: 'figure.mermaid', message: expect.stringContaining("doesn't parse")}]);
});

test("a free response's model sketch comes with the comparison, before the self-grade", async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const sketch = (await lc.j(['asset', 'put', lc.file('sketch.svg', SKETCH)], TUTOR)).json.asset.id as string;
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q3'}}] as never;
  lesson.questions = [
    ...lesson.questions,
    {ref: 'q3', type: 'free_response', aim: 'understand', difficulty: 3, concepts: ['ownership'], prompt: 'On paper, sketch who owns the buffer after `let s2 = s1`.', body: {model_answer: 's2 points at the buffer; s1 points at nothing.', rubric: ['an arrow from s2 to the buffer', 's1 with no arrow']}, explanation: 'One owner.', answer_figure: {asset: sketch, alt: 's2 points at the buffer'}},
  ] as never;
  const submitted = await submitLesson(lc, subject, run, lesson);
  const outcome = (await answerQ(lc, {question: submitted.json.question_ids.q3, lesson: submitted.json.lesson.id, answer: 'drew it'})).outcome;
  expect(outcome).toMatchObject({needs_self_grade: true, answer_figure: {asset: sketch}});
});

test('a question with a figure is timed for a look at it', () => {
  expect(questionSeconds({figure: null}, new Map())).toBe(SECONDS_PER_QUESTION);
  expect(questionSeconds({figure: {asset: 'x', alt: 'y'}}, new Map([['x', 4]]))).toBe(SECONDS_PER_QUESTION + 10 + 4);
  expect(questionSeconds({figure: {mermaid: POINTS, alt: 'y'}}, new Map())).toBe(SECONDS_PER_QUESTION + 10 + 3);
});
