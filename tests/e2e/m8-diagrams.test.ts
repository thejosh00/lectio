/**
 * M8, the `diagram` block: mermaid source checked by mermaid's own parser when a lesson is
 * written, so a broken diagram is refused rather than shown; and mermaid kept out of the
 * page's main script, so a lesson without a diagram never loads it.
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
const DRIVETRAIN = 'flowchart TD\n  engine[Engine] --> gearbox[Transmission] --> shaft[Driveshaft]\n  shaft --> diff[Differential] --> cv[CV joints] --> wheels[Wheels]';
const ALT = 'Power flows down: engine, transmission, driveshaft, differential, CV joints, wheels.';
const diagram = (mermaid: string, extra: Record<string, unknown> = {}) => ({type: 'diagram', approach: 'visual', concepts: ['ownership'], body: {mermaid, alt: ALT, ...extra}});

test('a lesson with a broken diagram is refused at the source, and nothing is written', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, diagram('flowchart TD\n  engine[Engine --> gearbox'), diagram('a sketch of the drivetrain')] as never;
  const result = await submitLesson(lc, subject, run, lesson);
  expect(result.code).toBe(2);
  const n = lesson.blocks.length;
  expect(result.json.errors.map((e: {path: string}) => e.path)).toEqual([`blocks[${n - 2}].body.mermaid`, `blocks[${n - 1}].body.mermaid`]);
  expect(result.json.error).toContain("doesn't parse as mermaid: Parse error");
  expect(result.json.error).toContain('No diagram type detected');
  expect((await lc.j(['lessons'])).json.lessons).toEqual([]);
});

test('a good diagram is kept, prints as its alt, and a fix to a broken one is refused', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, diagram(DRIVETRAIN, {caption: 'From engine to wheels'})] as never;
  const submitted = await submitLesson(lc, subject, run, lesson);
  expect(submitted.code).toBe(0);
  const blocks = (await lc.j(['lesson', 'show', submitted.json.lesson.id])).json.lesson.blocks;
  const block = blocks[blocks.length - 1];
  expect(block).toMatchObject({type: 'diagram', body: {mermaid: DRIVETRAIN, alt: ALT, caption: 'From engine to wheels'}, text: `[Diagram: From engine to wheels] ${ALT}`});

  const broken = await lc.j(['block', 'fix', block.id, '--stdin'], {...TUTOR, stdin: JSON.stringify(diagram('flowchart TD\n  engine -->'))});
  expect(broken.code).toBe(2);
  expect(broken.json.errors.map((e: {path: string}) => e.path)).toEqual(['.body.mermaid']);
  const fixed = await lc.j(['block', 'fix', block.id, '--stdin'], {...TUTOR, stdin: JSON.stringify(diagram(`${DRIVETRAIN}\n  engine -.-> wheels`))});
  expect(fixed.json).toMatchObject({block: {version: 2, body: {alt: ALT, caption: null}}});
});

test("mermaid stays out of the page's script; it is served from the package, by URL, only as modules", async () => {
  const html = await (await fetch(`${lc.url}/`)).text();
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html).not.toContain('modulepreload');
  const main = await (await fetch(new URL(/<script[^>]+src="([^"]+)"/.exec(html)![1]!, lc.url))).text();
  // mermaid's code is not in the main script; it imports it by URL when a diagram renders.
  expect(main).not.toContain('No diagram type detected');
  expect(main).toContain('/mermaid/mermaid.esm.min.mjs');
  const entry = await fetch(`${lc.url}/mermaid/mermaid.esm.min.mjs`);
  expect(entry.status).toBe(200);
  expect(entry.headers.get('content-type')).toStartWith('text/javascript');
  // Its chunks are relative imports beside it, served the same way.
  const chunk = /from\s*"\.\/(chunks\/[^"]+\.mjs)"/.exec(await entry.text())?.[1];
  expect(chunk).toBeDefined();
  expect((await fetch(`${lc.url}/mermaid/${chunk}`)).status).toBe(200);
  // Only modules, and nothing outside the package's dist.
  expect((await fetch(`${lc.url}/mermaid/mermaid.esm.min.mjs.map`)).status).toBe(404);
  expect((await fetch(`${lc.url}/mermaid/..%2Fpackage.json`)).status).toBe(404);
  expect((await fetch(`${lc.url}/katex/katex.mjs`)).status).toBe(404);
});
