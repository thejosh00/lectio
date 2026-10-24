import {expect, test} from 'bun:test';
import {diagramBlock} from '../../src/blocks/diagram.ts';
import type {ValidateCtx} from '../../src/blocks/types.ts';
import {checkMermaid, diagramSources} from '../../src/server/diagrams.ts';

const GOOD = 'flowchart TD\n  engine[Engine] --> gearbox[Transmission] --> shaft[Driveshaft]';
const BROKEN = 'flowchart TD\n  engine[Engine --> gearbox';

const ctx = (diagrams: Map<string, string | null>): ValidateCtx => ({
  path: 'blocks[0].body',
  conceptKeys: new Set(),
  assets: new Set(),
  questionRefs: new Set(),
  diagrams,
  limits: {widget_max_bytes: 100_000},
});

test("mermaid's own parser accepts a good diagram and names what's wrong with a broken one", async () => {
  const verdicts = await checkMermaid([GOOD, BROKEN, 'not a diagram at all', GOOD]);
  expect(verdicts.get(GOOD)).toBeNull();
  expect(verdicts.get(BROKEN)).toContain('Parse error');
  expect(verdicts.get('not a diagram at all')).toContain('No diagram type detected');
  expect(verdicts.size).toBe(3);
});

test('a checked, parsing diagram is accepted', async () => {
  const checked = diagramBlock.validate({mermaid: GOOD, alt: 'Engine to transmission to driveshaft', caption: 'The drivetrain'}, ctx(await checkMermaid([GOOD])));
  expect(checked).toEqual({ok: true, value: {mermaid: GOOD, alt: 'Engine to transmission to driveshaft', caption: 'The drivetrain'}});
  expect(diagramBlock.plainText({mermaid: GOOD, alt: 'Engine to wheels', caption: null})).toBe('[Diagram] Engine to wheels');
});

test('a broken mermaid source is refused at its path', async () => {
  const checked = diagramBlock.validate({mermaid: BROKEN, alt: 'Engine to transmission'}, ctx(await checkMermaid([BROKEN])));
  expect(checked.ok).toBe(false);
  if (checked.ok) return;
  expect(checked.issues).toHaveLength(1);
  expect(checked.issues[0]!.path).toBe('blocks[0].body.mermaid');
  expect(checked.issues[0]!.message).toStartWith("doesn't parse as mermaid: Parse error");
});

test('a source nobody checked is refused, not trusted', () => {
  const checked = diagramBlock.validate({mermaid: GOOD, alt: 'x'}, ctx(new Map()));
  expect(checked.ok).toBe(false);
  if (!checked.ok) expect(checked.issues).toEqual([{path: 'blocks[0].body.mermaid', message: "couldn't be checked against mermaid; try again"}]);
});

test('alt is required, and so is the source', async () => {
  const verdicts = await checkMermaid([GOOD]);
  const noAlt = diagramBlock.validate({mermaid: GOOD}, ctx(verdicts));
  expect(noAlt.ok ? [] : noAlt.issues).toEqual([{path: 'blocks[0].body.alt', message: 'is required'}]);
  const blank = diagramBlock.validate({mermaid: GOOD, alt: '  ', extra: 1}, ctx(verdicts));
  expect(blank.ok ? [] : blank.issues.map(i => i.path)).toEqual(['blocks[0].body.extra', 'blocks[0].body.alt']);
  const noSource = diagramBlock.validate({alt: 'x'}, ctx(verdicts));
  expect(noSource.ok ? [] : noSource.issues).toEqual([{path: 'blocks[0].body.mermaid', message: 'is required'}]);
});

test('the sources to check are found in a lesson or a single block', () => {
  const block = {type: 'diagram', body: {mermaid: GOOD}};
  expect(diagramSources({blocks: [{type: 'markdown', body: {md: 'x'}}, block, {type: 'diagram', body: {mermaid: 3}}]})).toEqual([GOOD]);
  expect(diagramSources(block)).toEqual([GOOD]);
  expect(diagramSources(null)).toEqual([]);
  expect(diagramSources({blocks: 'nope'})).toEqual([]);
});
