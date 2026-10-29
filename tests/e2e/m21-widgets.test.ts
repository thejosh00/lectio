/**
 * M21: widgets. A lesson can carry an animation or an interactive; what goes wrong in one
 * reaches the tutor's context with its message and line, and a fix clears it; a widget that
 * reaches for the network is warned about when it is written; and `widget check` finds that,
 * and what it throws, before it ships, drawing an animation at the moments asked for.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
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
const ANIMATION = `<canvas id="c" width="340" height="200"></canvas>
<script>
  const g = document.getElementById('c').getContext('2d');
  lectio.animate(t => {
    g.fillStyle = lectio.theme.paper; g.fillRect(0, 0, 340, 200);
    g.fillStyle = lectio.theme.focus; g.fillRect(20 + t * 30, 80, 40, 40);
  }, {duration: 8});
</script>`;
const widget = (body: Record<string, unknown>) => ({type: 'widget', approach: 'animation', concepts: ['ownership'], body: {kind: 'animation', html: ANIMATION, height: 220, alt: 'a square moves right', duration: 8, steps: [{at: 0, caption: 'It starts at the left.'}], ...body}});

test("a widget's errors reach the tutor with their line, and a fix clears them; the network is warned about at once", async () => {
  const subject = await rustSubject(lc);
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, widget({html: `${ANIMATION}<script>fetch('/x')</script>`})] as never;
  const submitted = await submitLesson(lc, subject, await startRun(lc), lesson);
  expect(submitted.code).toBe(0);
  expect(submitted.json.warnings).toContainEqual(expect.stringMatching(/^blocks\[4\]\.body\.html reaches for the network \(fetch\(\)/));
  const id = submitted.json.lesson.id as string;
  const block = (await lc.j(['lesson', 'show', id], TUTOR)).json.lesson.blocks[4];
  expect(block.text).toBe('[Animation: a square moves right]\nat 0 s: It starts at the left.');

  // The page reports what the bridge told it.
  await fetch(`${lc.url}/api/lessons/${id}/activity`, {
    method: 'POST',
    headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'},
    body: JSON.stringify({active_seconds: 10, blocks: [{id: block.id, seen_seconds: 10, interactions: 2, errors: 1, last_error: 'blocked by the sandbox: connect-src (line 9:2)'}]}),
  });
  const errors = (await lc.j(['context'], TUTOR)).json.subjects[0].widget_errors;
  expect(errors).toEqual([expect.objectContaining({id: block.id, type: 'widget', errors: 1, last_error: 'blocked by the sandbox: connect-src (line 9:2)'})]);

  const fixed = await lc.j(['block', 'fix', block.id, '--stdin', '--reply', 'Drew it without fetching.'], {...TUTOR, stdin: JSON.stringify(widget({}))});
  expect(fixed.json).toMatchObject({block: {version: 2, errors: 0, last_error: null}, warnings: []});
  expect((await lc.j(['context'], TUTOR)).json.subjects[0].widget_errors).toEqual([]);
});

const chrome = chromePath(realToolDeps(process.env));
test.skipIf(chrome === null)('widget check draws an animation at each moment asked for, and finds what a broken one throws', async () => {
  const out = join(lc.dir, 'frames');
  const good = await lc.j(['widget', 'check', lc.file('w.html', ANIMATION), '--kind', 'animation', '--frames', '0,4', '--height', '220', '--out', out]);
  expect(good.json).toMatchObject({ok: true, errors: [], frames: [{at: 0}, {at: 4}]});
  for (const frame of good.json.frames) expect(existsSync(frame.path)).toBe(true);
  // The moments differ: the square has moved.
  expect(await Bun.file(good.json.frames[0].path).bytes()).not.toEqual(await Bun.file(good.json.frames[1].path).bytes());

  const broken = await lc.j(['widget', 'check', lc.file('b.html', '<script>\nnotDefined();\n</script>'), '--kind', 'animation', '--out', join(lc.dir, 'b')]);
  expect(broken.code).toBe(2);
  expect(broken.json.errors).toEqual(['an animation draws through lectio.animate(draw, {duration}), so the page can play, pause and step it', expect.stringMatching(/notDefined is not defined \(line 2\)/), 'lectio.animate was never called, so nothing was drawn at this moment']);
}, 60_000);

test('the ladder says widgets are here, and the contract describes them', async () => {
  const tools = (await lc.j(['tools'])).json.media as Array<{type: string; lectio: string}>;
  expect(tools.find(m => m.type === 'widget')!.lectio).toBe('available');
  const doc = (await lc.j(['agents'], TUTOR)).json.document as string;
  expect(doc).toContain('| `widget` |');
  expect(doc).toContain('lectio.animate(draw, {duration})');
});
