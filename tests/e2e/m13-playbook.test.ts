/**
 * M13: the living playbook. The tutor seeds it, rewrites it with a reason at most every
 * playbook_min_days, and every lesson records the version it was written under. The learner
 * sees each change and can put an earlier version back without the restored lines becoming
 * theirs.
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
const setPlaybook = (text: string, note: string, as = TUTOR) => lc.j(['playbook', 'set', '--stdin', '--note', note], {...as, stdin: text});
const learnerPost = async (path: string, body: unknown = {}) =>
  (await (await fetch(`${lc.url}${path}`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, body: JSON.stringify(body)})).json()) as any;

test('the tutor seeds it, then changes it with a reason at most every playbook_min_days; the learner any time', async () => {
  expect((await lc.j(['playbook'], TUTOR)).json.playbook.version).toBe(0);
  expect((await setPlaybook('- worked examples first', 'seeded from teaching.md')).json.playbook.version).toBe(1);
  // The seed doesn't count against the wait.
  expect((await setPlaybook('- problems first', 'problem-first intros held 4 of 4')).json.playbook.version).toBe(2);
  const tooSoon = await setPlaybook('- problems first\n- shorter', 'trying shorter');
  expect(tooSoon.code).toBe(1);
  expect(tooSoon.json).toMatchObject({why: 'cooldown', next_change_from: '2026-09-15'});
  expect((await lc.j(['context'], TUTOR)).json.playbook).toMatchObject({version: 2, next_change_from: '2026-09-15'});
  expect((await setPlaybook('x', '')).code).toBe(2);

  // The learner isn't held to the wait, and their lines are theirs.
  const mine = await setPlaybook('- problems first\n- never more than one new idea a day', 'mine', {as: 'you'});
  expect(mine.json.playbook).toMatchObject({version: 3, learner_lines: ['- never more than one new idea a day']});

  lc.advance({days: 3});
  expect((await setPlaybook('- problems first\n- never more than one new idea a day\n- shorter', 'trying shorter lessons')).code).toBe(0);
  const capped = await lc.j(['settings', 'set', 'playbook_max_bytes', '256']);
  expect(capped.code).toBe(0);
  lc.advance({days: 3});
  const big = await setPlaybook('x'.repeat(300), 'too long');
  expect(big.code).toBe(1);
  expect(big.json.error).toContain('playbook_max_bytes');
});

test("the learner puts an earlier version back; restored tutor lines don't become the learner's", async () => {
  await setPlaybook('- worked examples first\n- one idea a day', 'seeded from teaching.md');
  await setPlaybook('- problems first\n- one idea a day', 'problem first');
  const reverted = await learnerPost('/api/playbook/revert', {version: 1});
  expect(reverted.playbook).toMatchObject({version: 3, body: '- worked examples first\n- one idea a day', learner_lines: []});
  const history = (await lc.j(['playbook', '--history'])).json.history;
  expect(history[0]).toMatchObject({version: 3, actor: 'you', restored_from: 1, note: 'restored v1'});
  expect((await lc.j(['playbook', 'revert', '1'], TUTOR)).code).toBe(2);
  expect((await lc.cli(['playbook', 'revert', '9'])).code).toBe(3);
});

test('each lesson records the playbook version it was written under, and a revise takes the current one', async () => {
  const subject = await rustSubject(lc);
  const before = await submitLesson(lc, subject, await startRun(lc));
  expect(lc.db.query('SELECT playbook_version FROM lessons WHERE id = ?').get(before.json.lesson.id)).toEqual({playbook_version: null});
  await lc.j(['finish', before.json.lesson.id]);

  lc.advance({days: 1});
  await setPlaybook('- worked examples first', 'seeded from teaching.md');
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, ownershipLesson({concepts: [{key: 'moves', role: 'new'}], blocks: [{type: 'markdown', approach: 'explanation', concepts: ['moves'], body: {md: 'Moves.'}}], questions: []}));
  expect(lesson.json.lesson.playbook_version).toBe(1);
  await setPlaybook('- problems first', 'problem first');
  const revised = await lc.j(['lesson', 'revise', lesson.json.lesson.id, '--file', lc.file('l.json', ownershipLesson({title: 'Moves, again', concepts: [{key: 'moves', role: 'new'}], blocks: [{type: 'markdown', approach: 'explanation', concepts: ['moves'], body: {md: 'Moves.'}}], questions: []}))], TUTOR);
  expect(revised.code).toBe(0);
  expect(revised.json.lesson.playbook_version).toBe(2);
  await lc.j(['finish', lesson.json.lesson.id]);

  const versions = (await lc.j(['progress', '--subject', subject])).json.progress.playbook_versions;
  expect(versions.map((v: {version: number | null; lessons: number; concepts: number}) => [v.version, v.lessons, v.concepts])).toEqual([
    [null, 1, 1],
    [2, 1, 1],
  ]);
});

test("Today says when the tutor changed how it teaches, until the learner has looked", async () => {
  await setPlaybook('- worked examples first', 'seeded from teaching.md');
  expect((await lc.j(['today'])).json.playbook_changed).toBeNull();
  await setPlaybook('- problems first', 'problem-first intros held 4 of 4');
  expect((await lc.j(['today'])).json.playbook_changed).toMatchObject({version: 2, note: 'problem-first intros held 4 of 4'});
  expect((await learnerPost('/api/playbook/seen')).ok).toBe(true);
  expect((await lc.j(['today'])).json.playbook_changed).toBeNull();
  // The learner's own edits never raise it.
  await setPlaybook('- problems first\n- mine', 'mine', {as: 'you'});
  expect((await lc.j(['today'])).json.playbook_changed).toBeNull();
});

test('the context says when the last placement-kind quiz was, and progress carries throughput (M15)', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const placement = {
    rationale: 'Where to start.',
    items: [{role: 'probe', question: {type: 'short_text', aim: 'recall', difficulty: 1, concepts: ['stack-vs-heap'], prompt: 'Where do fixed-size locals live?', body: {accept: ['stack']}, explanation: 'On the stack.'}}],
  };
  expect((await lc.j(['quiz', 'submit', subject, '--day', lc.ctx().today(), '--run', run, '--kind', 'placement', '--file', lc.file('p.json', placement)], TUTOR)).code).toBe(0);
  const context = (await lc.j(['context'], TUTOR)).json;
  expect(context.subjects[0].last_placement).toBe(lc.ctx().today());
  const lesson = await submitLesson(lc, subject, run);
  await lc.j(['finish', lesson.json.lesson.id]);
  const weeks = (await lc.j(['progress', '--subject', subject])).json.progress.throughput;
  expect(weeks).toEqual([expect.objectContaining({week: '2026-09-07', introduced: 1, retained_per_hour: null})]);
});
