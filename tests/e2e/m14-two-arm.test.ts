/**
 * M14: two-arm lessons. The app picks which arm the learner sees, keeps arms balanced
 * without being predictable, hides the pick from agents until the lesson is finished, and
 * leaves the unshown arm out of the measures and of reading time.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {ownershipLesson, rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};
const ARMS = {a: 'a worked trace, then the rule', b: 'a problem to try first, then the rule'};
const ARM_A = 'WORKED-TRACE: let s1 = …; let s2 = s1; s1 is gone.';
const ARM_B = 'PROBLEM-FIRST: predict what printing s1 does after the move.';

function experimentLesson(over: Record<string, unknown> = {}, concept = 'ownership', role = 'new'): Record<string, any> {
  return ownershipLesson({
    concepts: [{key: concept, role}],
    experiment: {name: 'worked_vs_problem_first', arms: ARMS},
    blocks: [
      {type: 'markdown', approach: 'explanation', concepts: [concept], body: {md: 'SHARED: every value has one owner.'}},
      {type: 'markdown', approach: 'worked_example', concepts: [concept], arm: 'a', body: {md: ARM_A}},
      {type: 'markdown', approach: 'problem_first', concepts: [concept], arm: 'b', body: {md: ARM_B}},
      {type: 'question', approach: 'retrieval', concepts: [concept], body: {ref: 'q1'}},
    ],
    ...over,
  });
}

const learnerFetch = async (method: string, path: string, body?: unknown) =>
  (await (await fetch(`${lc.url}${path}`, {method, headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})})).json()) as any;

test('a lesson declares an experiment and tags blocks with arms; what an experiment needs is checked', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const refused = async (lesson: unknown, message: string) => {
    const result = await submitLesson(lc, subject, run, lesson);
    expect(result.code).toBe(2);
    expect(result.json.errors.map((e: {message: string}) => e.message).join(' | ')).toContain(message);
  };
  await refused(experimentLesson({experiment: undefined}), 'arms belong to an experiment');
  const oneArm = experimentLesson();
  await refused({...oneArm, blocks: (oneArm.blocks as Array<{arm?: string}>).filter(b => b.arm !== 'b')}, 'arm b has no blocks');
  const twoConcepts = experimentLesson();
  twoConcepts.blocks[2] = {...twoConcepts.blocks[2], concepts: ['stack-vs-heap']};
  await refused({...twoConcepts, concepts: [{key: 'ownership', role: 'new'}, {key: 'stack-vs-heap', role: 'new'}]}, 'the arms teach different concepts');
  const armedCheck = experimentLesson();
  armedCheck.blocks[3] = {...armedCheck.blocks[3], arm: 'a'};
  await refused(armedCheck, 'an inline check is shared by both arms');
  await refused(experimentLesson({experiment: {name: 'Worked vs problem', arms: ARMS}}), 'lowercase slug');

  const long = experimentLesson();
  long.blocks[1] = {...long.blocks[1], body: {md: `${ARM_A} ${'More words. '.repeat(300)}`}};
  const submitted = await submitLesson(lc, subject, run, long);
  expect(submitted.code).toBe(0);
  expect(submitted.json.warnings.join(' ')).toContain('the arms take different time');
  // The submit says nothing of which arm the learner will see.
  expect(JSON.stringify(submitted.json)).not.toMatch(/"(arm|assigned_arm)":"[ab]"/);
});

test('the learner sees the shared blocks and one arm; agents see both, and which one only once it is finished', async () => {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc), experimentLesson());
  const id = lesson.json.lesson.id as string;

  const mine = (await learnerFetch('GET', `/api/lessons/${id}`)).lesson;
  const texts = mine.blocks.map((b: {text: string}) => b.text).join('\n');
  expect(texts).toContain('SHARED');
  const sawA = texts.includes('WORKED-TRACE');
  expect(sawA).toBe(!texts.includes('PROBLEM-FIRST'));
  const printed = (await lc.cli(['lesson', 'show', id])).stdout;
  expect(printed.includes('WORKED-TRACE')).toBe(sawA);
  expect(printed.includes('PROBLEM-FIRST')).toBe(!sawA);

  const tutorView = (await lc.j(['lesson', 'show', id], TUTOR)).json.lesson;
  expect(tutorView.blocks.map((b: {arm: string | null}) => b.arm)).toEqual([null, 'a', 'b', null]);
  expect(tutorView.assigned_arm).toBeNull();
  expect(JSON.stringify((await lc.j(['context'], TUTOR)).json)).not.toMatch(/"assigned_arm":"[ab]"/);

  // Reading time and reactions only count for what was shown.
  const unshown = tutorView.blocks.find((b: {arm: string | null}) => b.arm === (sawA ? 'b' : 'a'));
  const shown = tutorView.blocks.find((b: {arm: string | null}) => b.arm === (sawA ? 'a' : 'b'));
  await learnerFetch('POST', `/api/lessons/${id}/activity`, {active_seconds: 30, blocks: [{id: unshown.id, seen_seconds: 30}, {id: shown.id, seen_seconds: 25}]});
  expect(lc.db.query('SELECT seen_seconds FROM blocks WHERE id = ?').get(unshown.id)).toEqual({seen_seconds: 0});
  expect(lc.db.query('SELECT seen_seconds FROM blocks WHERE id = ?').get(shown.id)).toEqual({seen_seconds: 25});
  expect((await lc.j(['rate', 'block', unshown.id, 'helpful'])).code).toBe(3);
  expect((await lc.j(['rate', 'block', shown.id, 'helpful'])).code).toBe(0);

  await lc.j(['finish', id]);
  expect((await lc.j(['lesson', 'show', id], TUTOR)).json.lesson.assigned_arm).toBe(sawA ? 'a' : 'b');
  // The approach measures count only the arm that taught.
  const approaches = (await lc.j(['progress', '--subject', subject])).json.progress.approaches as Array<{approach: string; blocks: number; with: {concepts: number}}>;
  const used = approaches.find(a => a.approach === (sawA ? 'worked_example' : 'problem_first'));
  const unused = approaches.find(a => a.approach === (sawA ? 'problem_first' : 'worked_example'));
  expect(used).toMatchObject({blocks: 1, with: {concepts: 1}});
  expect(unused).toBeUndefined();
});

test('arms stay balanced across lessons, and an experiment keeps its arms until it is closed', async () => {
  const subject = await rustSubject(lc);
  for (let day = 0; day < 20; day++) {
    const lesson = await submitLesson(lc, subject, await startRun(lc), experimentLesson({}, 'ownership', day === 0 ? 'new' : 'deepen'));
    expect(lesson.code).toBe(0);
    await lc.j(['finish', lesson.json.lesson.id]);
    lc.advance({days: 1});
  }
  const counts = lc.db.query("SELECT arm, COUNT(*) AS n FROM lesson_arms GROUP BY arm ORDER BY arm").all() as Array<{arm: string; n: number}>;
  expect(counts.map(c => c.arm)).toEqual(['a', 'b']);
  expect(Math.abs(counts[0]!.n - counts[1]!.n)).toBeLessThanOrEqual(8);

  const run = await startRun(lc);
  const otherArms = await submitLesson(lc, subject, run, experimentLesson({experiment: {name: 'worked_vs_problem_first', arms: {a: 'x', b: 'y'}}}, 'ownership', 'deepen'));
  expect(otherArms.code).toBe(1);
  expect(otherArms.json.error).toContain('use the same arms');

  const report = (await lc.j(['progress', '--subject', subject])).json.progress.experiments;
  expect(report).toHaveLength(1);
  expect(report[0].a.lessons + report[0].b.lessons).toBe(20);
  expect(report[0]).toMatchObject({name: 'worked_vs_problem_first', status: 'open', enough: false});

  expect((await lc.j(['experiment', 'close', 'worked_vs_problem_first', '--note', 'Too few reviews either way; stopping.'], TUTOR)).code).toBe(0);
  expect((await lc.j(['experiments'])).json.experiments[0]).toMatchObject({status: 'closed', verdict: 'Too few reviews either way; stopping.'});
  const closed = await submitLesson(lc, subject, run, experimentLesson({}, 'ownership', 'deepen'));
  expect(closed.code).toBe(1);
  expect(closed.json.error).toContain('is closed');
  expect((await lc.j(['experiment', 'close', 'worked_vs_problem_first', '--note', 'x'])).code).toBe(2);
});

test('a revise keeps the arm while the experiment stays the same; a block fix keeps its arm and refuses a new one', async () => {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc), experimentLesson());
  const id = lesson.json.lesson.id as string;
  const arm = lc.db.query('SELECT arm FROM lesson_arms WHERE lesson_id = ?').get(id);
  for (let i = 0; i < 5; i++) {
    expect((await lc.j(['lesson', 'revise', id, '--file', lc.file('l.json', experimentLesson({title: `Take ${i}`}))], TUTOR)).code).toBe(0);
    expect(lc.db.query('SELECT arm FROM lesson_arms WHERE lesson_id = ?').get(id)).toEqual(arm);
  }
  // Without the experiment, the lesson is an ordinary one again.
  const plain = await lc.j(['lesson', 'revise', id, '--file', lc.file('l.json', ownershipLesson())], TUTOR);
  expect(plain.code).toBe(0);
  expect(lc.db.query('SELECT arm FROM lesson_arms WHERE lesson_id = ?').get(id)).toBeNull();

  const again = await lc.j(['lesson', 'revise', id, '--file', lc.file('l.json', experimentLesson())], TUTOR);
  expect(again.code).toBe(0);
  const block = (await lc.j(['lesson', 'show', id], TUTOR)).json.lesson.blocks.find((b: {arm: string | null}) => b.arm === 'a');
  const fixed = await lc.j(['block', 'fix', block.id, '--file', lc.file('b.json', {type: 'markdown', approach: 'worked_example', concepts: ['ownership'], body: {md: `${ARM_A} Fixed.`}})], TUTOR);
  expect(fixed.code).toBe(0);
  expect(fixed.json.block.arm).toBe('a');
  expect((await lc.j(['block', 'fix', block.id, '--file', lc.file('b.json', {type: 'markdown', approach: 'worked_example', concepts: ['ownership'], arm: 'b', body: {md: 'x'}})], TUTOR)).code).toBe(2);
});
