/**
 * #4: the arms of a two-arm lesson, timed where the tutor can see it. The submit and the
 * revise give each arm's seconds; the warning names the longer arm and the gap; a picture's
 * estimate counts its SVG's labels, including for an asset stored before labels were counted.
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
const LABELS = ['PUMP', 'BLOCK', 'HEAD', 'THERMOSTAT', 'upper hose', 'RADIATOR', 'FAN', 'lower hose', '1', '2', '3', '4'];
const LOOP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">\n${LABELS.map((label, i) => `  <text x="10" y="${20 + i * 20}">${label}</text>`).join('\n')}\n  <text x="0" y="0"> </text>\n</svg>\n`;
const words = (n: number) => Array.from({length: n}, () => 'coolant').join(' ');

function loopLesson(asset: string, description: number): Record<string, any> {
  return ownershipLesson({
    concepts: [{key: 'ownership', role: 'new'}],
    experiment: {name: 'drawing_vs_description', arms: {a: 'a labelled drawing of the loop', b: 'the loop described in words'}},
    blocks: [
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], body: {md: 'SHARED: follow one drop round the loop.'}},
      // 10 s to look + 12 labels + 10 words of caption (3 s) = 25 s.
      {type: 'image', approach: 'visual', concepts: ['ownership'], arm: 'a', body: {asset, alt: 'the coolant loop, numbered', caption: words(10)}},
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], arm: 'b', body: {md: words(description)}},
      {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q1'}},
    ],
  });
}

test('the submit and the revise time each arm, and the warning says which is longer and by how much', async () => {
  const subject = await rustSubject(lc);
  const put = await lc.j(['asset', 'put', lc.file('loop.svg', LOOP_SVG)], TUTOR);
  expect(put.json.asset.labels).toBe(12);

  // 30 words of description is 9 s against the drawing's 25 s.
  const short = await submitLesson(lc, subject, await startRun(lc), loopLesson(put.json.asset.id, 30));
  expect(short.code).toBe(0);
  expect(short.json.arm_seconds).toEqual({
    shared: 3 + 45,
    a: 25,
    b: 9,
    longer: 'a',
    blocks: {a: [{position: 1, type: 'image', seconds: 25}], b: [{position: 2, type: 'markdown', seconds: 9}]},
  });
  const warning = short.json.warnings.find((w: string) => w.startsWith('the arms take different time'));
  expect(warning).toContain('a about 25 s, b about 9 s (a is 16 s longer, 178% more)');
  expect(warning).toContain('about 54 words of text');

  // One revision, by the gap it named, clears it.
  const id = short.json.lesson.id as string;
  const evened = await lc.j(['lesson', 'revise', id, '--file', lc.file('l.json', loopLesson(put.json.asset.id, 30 + 54))], TUTOR);
  expect(evened.code).toBe(0);
  expect(evened.json.arm_seconds).toMatchObject({a: 25, b: 26, longer: 'b'});
  expect(evened.json.warnings.join(' ')).not.toContain('the arms take different time');
  const plain = await lc.cli(['lesson', 'revise', id, '--file', lc.file('l2.json', loopLesson(put.json.asset.id, 30 + 54))], TUTOR);
  expect(plain.stdout).toContain('arms: a about 25 s, b about 26 s, shared about 48 s');

  // The lesson's own estimate counts the labels too.
  const shown = (await lc.j(['lesson', 'show', id], TUTOR)).json.lesson;
  expect(shown.estimate_minutes).toBe(Math.round((3 + 45 + 26) / 60));
});

test('a lesson without an experiment has no arm_seconds', async () => {
  const subject = await rustSubject(lc);
  const submitted = await submitLesson(lc, subject, await startRun(lc));
  expect(submitted.code).toBe(0);
  expect(submitted.json.arm_seconds).toBeNull();
});

test('an SVG stored before labels were counted is counted from its bytes, and a put stores the count', async () => {
  const subject = await rustSubject(lc);
  const put = await lc.j(['asset', 'put', lc.file('loop.svg', LOOP_SVG)], TUTOR);
  const asset = put.json.asset.id as string;
  lc.db.query('UPDATE assets SET labels = NULL WHERE id = ?').run(asset);

  const submitted = await submitLesson(lc, subject, await startRun(lc), loopLesson(asset, 80));
  expect(submitted.json.arm_seconds).toMatchObject({a: 25});
  expect((lc.db.query('SELECT labels FROM assets WHERE id = ?').get(asset) as {labels: number | null}).labels).toBeNull();

  const again = await lc.j(['asset', 'put', lc.file('same.svg', LOOP_SVG)], TUTOR);
  expect(again.json).toMatchObject({existing: true, asset: {labels: 12}});
  expect((lc.db.query('SELECT labels FROM assets WHERE id = ?').get(asset) as {labels: number | null}).labels).toBe(12);
});
