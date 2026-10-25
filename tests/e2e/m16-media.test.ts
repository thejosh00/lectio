/**
 * M16: a proposal names the media type it adds, its outcome waits for that type's evidence,
 * and two-arm lessons that differ by block type flow into the media measure.
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
const proposal = (over: Record<string, unknown> = {}) => ({
  title: 'A step-through block for algorithm traces',
  area: 'block_type',
  problem: 'Traces of a loop taught in prose are retained at 40% (n=10).',
  change: 'The planned steps block.',
  success: 'Trace concepts retain like the rest within two weeks.',
  evidence: [{kind: 'measure', note: 'retention 0.40 (n=10) on trace concepts'}],
  media: 'steps',
  ...over,
});

test("a media proposal's outcome waits for its evidence; got_in_the_way and unused don't", async () => {
  const run = await startRun(lc);
  expect((await lc.j(['proposal', 'add', '--file', lc.file('p.json', proposal({area: 'learner_ui'})), '--run', run], TUTOR)).code).toBe(2);
  const filed = await lc.j(['proposal', 'add', '--file', lc.file('p.json', proposal()), '--run', run], TUTOR);
  expect(filed.json.proposal.media).toBe('steps');
  await lc.j(['proposal', 'approve', '1']);
  await lc.j(['proposal', 'claim', '1'], {as: 'agent:builder'});
  await lc.j(['proposal', 'submit', '1', '--branch', 'lectio/p1-steps', '--commit', 'abc1234', '--note-file', lc.file('h.md', 'x')], {as: 'agent:builder'});
  await lc.j(['proposal', 'shipped', '1']);

  const waiting = (await lc.j(['context'], TUTOR)).json.awaiting_outcome[0];
  expect(waiting).toMatchObject({number: 1, media: 'steps', media_evidence: null, overdue: false});
  const refused = await lc.j(['proposal', 'outcome', '1', 'helped', '--note', 'felt better'], TUTOR);
  expect(refused.code).toBe(1);
  expect(refused.json).toMatchObject({why: 'not_enough_evidence'});
  expect(refused.json.error).toContain('two-arm lesson');
  // Long after shipping it is overdue anyway, and unused can always be said.
  lc.advance({days: 42});
  expect((await lc.j(['context'], TUTOR)).json.awaiting_outcome[0].overdue).toBe(true);
  expect((await lc.j(['proposal', 'outcome', '1', 'unused', '--note', 'Never needed a trace.'], TUTOR)).code).toBe(0);
});

test('a two-arm lesson whose arms differ by block type is evidence for that type', async () => {
  const subject = await rustSubject(lc);
  const lesson = ownershipLesson({
    experiment: {name: 'code_vs_prose', arms: {a: 'a code trace', b: 'the same in prose'}},
    blocks: [
      {type: 'code', approach: 'worked_example', concepts: ['ownership'], arm: 'a', body: {lang: 'rust', source: 'let s2 = s1;'}},
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], arm: 'b', body: {md: 'Assigning moves ownership.'}},
      {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q1'}},
    ],
  });
  const submitted = await submitLesson(lc, subject, await startRun(lc), lesson);
  expect(submitted.code).toBe(0);
  await lc.j(['finish', submitted.json.lesson.id]);
  const media = (await lc.j(['progress', '--subject', subject])).json.progress.media as Array<{type: string; experiments: Array<{name: string}>; blocks: number}>;
  // Only the arm the learner saw taught anything, so the type it used shows up, with the experiment.
  const tested = media.filter(m => m.experiments.some(e => e.name === 'code_vs_prose')).map(m => m.type);
  expect(tested).toHaveLength(1);
  expect(['code', 'markdown']).toContain(tested[0]!);
  expect(media.some(m => m.type === 'question')).toBe(false);
});
