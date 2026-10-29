/**
 * M17: pictures that teach. A picture gets warnings, never refusals, for what a reader at
 * phone width would notice — on asset put, lesson submit and revise, and block fix; diagrams
 * may use the figure palette's classes; an image can credit where it came from; and
 * `figure check` lints a picture and, with Chrome, draws it as a phone shows it.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {figureCheck} from '../../src/local/figure.ts';
import {chromePath, realToolDeps} from '../../src/local/tools.ts';
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
/** Drawn 1200 wide with 24-unit labels: about 7 px on a phone. */
const TINY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><rect width="300" height="200" fill="#dcebf5"/><text x="20" y="40" font-size="24">piston</text></svg>';
const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 120" font-family="sans-serif" font-size="14"><rect x="10" y="20" width="60" height="30" fill="#fbe3d3" stroke="#d55e00" stroke-width="3"/><text x="22" y="40">s2</text></svg>';
const CHAIN = 'flowchart LR\n  intake --> compress --> power --> exhaust --> scavenge --> idle\n  class power focus';

test('asset put says what a phone would show of an SVG, and still stores it', async () => {
  const put = await lc.j(['asset', 'put', lc.file('tiny.svg', TINY)], TUTOR);
  expect(put.code).toBe(0);
  expect(put.json.warnings).toEqual([expect.stringContaining('about 7 px on a phone')]);
  expect((await lc.cli(['asset', 'put', lc.file('tiny2.svg', TINY)], TUTOR)).stdout).toContain('  warning: its smallest labels show at about 7 px');
  expect((await lc.j(['asset', 'put', lc.file('good.svg', GOOD)], TUTOR)).json.warnings).toEqual([]);
});

test('a lesson with pictures that will read badly is written, with a warning at each one', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const tiny = (await lc.j(['asset', 'put', lc.file('tiny.svg', TINY)], TUTOR)).json.asset.id;
  const lesson = ownershipLesson();
  lesson.blocks = [
    ...lesson.blocks,
    {type: 'image', approach: 'visual', concepts: ['ownership'], body: {asset: tiny, alt: 'the piston at the top of its stroke', credit: 'Drawing: the tutor, CC0'}},
    {type: 'diagram', approach: 'visual', concepts: [], body: {mermaid: CHAIN, alt: 'The four strokes in a row.', caption: 'The four strokes in a row'}},
  ] as never;
  const submitted = await submitLesson(lc, subject, run, lesson);
  expect(submitted.code).toBe(0);
  expect(submitted.json.warnings).toEqual([
    expect.stringMatching(/^blocks\[4\]\.body\.asset: its smallest labels show at about 7 px/),
    expect.stringMatching(/^blocks\[5\]: a picture that serves no concept is decoration/),
    expect.stringMatching(/^blocks\[5\]\.body\.caption repeats the alt/),
    expect.stringMatching(/^blocks\[5\]\.body\.mermaid: 6 nodes left to right/),
  ]);

  // The credit is kept and printed; the palette's classes parse.
  const blocks = (await lc.j(['lesson', 'show', submitted.json.lesson.id])).json.lesson.blocks;
  expect(blocks[4]).toMatchObject({body: {credit: 'Drawing: the tutor, CC0'}, text: '[Image: the piston at the top of its stroke]\n(Drawing: the tutor, CC0)'});
  expect(blocks[5].body.mermaid).toBe(CHAIN);

  // A fix is told the same; a good one is told nothing.
  const fix = (body: Record<string, unknown>, concepts = ['ownership']) => lc.j(['block', 'fix', blocks[5].id, '--stdin'], {...TUTOR, stdin: JSON.stringify({type: 'diagram', approach: 'visual', concepts, body})});
  expect((await fix({mermaid: CHAIN, alt: 'The four strokes'})).json.warnings).toEqual([expect.stringMatching(/^block\.body\.mermaid: 6 nodes left to right/)]);
  const good = await fix({mermaid: CHAIN.replace('LR', 'TD'), alt: 'The four strokes, top to bottom; power in focus.', caption: 'Find the one stroke that pushes'});
  expect(good.json).toMatchObject({block: {version: 3}, warnings: []});
});

test('figure check lints a picture without a server, and without Chrome draws nothing', async () => {
  const svg = await figureCheck(new TextEncoder().encode(TINY), {chrome: null});
  expect(svg).toMatchObject({ok: true, kind: 'svg', png: null, warnings: [expect.stringContaining('about 7 px'), expect.stringContaining('no Chrome')]});
  const diagram = await figureCheck(new TextEncoder().encode(CHAIN), {chrome: null});
  expect(diagram).toMatchObject({ok: true, kind: 'mermaid', warnings: [expect.stringContaining('6 nodes left to right'), expect.stringContaining('no Chrome')]});
  const broken = await figureCheck(new TextEncoder().encode('flowchart TD\n  a -->'), {chrome: null});
  expect(broken).toMatchObject({ok: false, error: expect.stringContaining("doesn't parse as mermaid")});
});

const chrome = chromePath(realToolDeps(process.env));
test.skipIf(chrome === null)('with Chrome, figure check draws the picture at phone width and saves a PNG', async () => {
  const out = join(lc.dir, 'cycle.png');
  const result = await lc.j(['figure', 'check', lc.file('cycle.mmd', CHAIN.replace('LR', 'TD')), '--out', out]);
  expect(result.code).toBe(0);
  expect(result.json).toMatchObject({ok: true, kind: 'mermaid', png: out, warnings: []});
  expect(result.json.shown.width).toBeGreaterThan(0);
  expect(result.json.shown.width).toBeLessThanOrEqual(340);
  expect(existsSync(out)).toBe(true);
  const png = await Bun.file(out).bytes();
  expect([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join('')).toBe('PNG');
}, 30_000);
