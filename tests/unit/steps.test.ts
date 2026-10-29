/** M18: the step-through block — one thing per frame, each frame checked like any picture, timed by what changes. */
import {expect, test} from 'bun:test';
import {stepsBlock, type StepsBody} from '../../src/blocks/steps.ts';
import {blockFigureWarnings, figureAssets} from '../../src/core/figureLint.ts';
import {diagramSources} from '../../src/server/diagrams.ts';

const ID = 'a'.repeat(64);
const GOOD = 'flowchart TD\n  a --> b';
const ctx = {path: 'blocks[1].body', conceptKeys: new Set<string>(), assets: new Set([ID]), questionRefs: new Set<string>(), diagrams: new Map<string, string | null>([[GOOD, null], ['flowchart TD\n  a -->', 'Parse error']]), limits: {widget_max_bytes: 1000}};
const paths = (body: unknown) => {
  const result = stepsBlock.validate(body, ctx);
  return result.ok ? [] : result.issues.map(i => i.path);
};

test('each frame is one picture or a few lines, with a caption; an ask is a guess at the next frame', () => {
  const body = {frames: [{asset: ID, caption: 'Before', ask: 'What moves?'}, {mermaid: GOOD, caption: 'After'}, {md: '`s2` owns it', caption: 'In words'}], alt: 'a move in three steps'};
  expect(stepsBlock.validate(body, ctx)).toEqual({
    ok: true,
    value: {frames: [{asset: ID, caption: 'Before', ask: 'What moves?'}, {mermaid: GOOD, caption: 'After', ask: null}, {md: '`s2` owns it', caption: 'In words', ask: null}], alt: 'a move in three steps', autoplay_ms: null},
  } as never);
  expect(paths({frames: [{asset: ID, caption: 'x'}], alt: 'x'})).toEqual(['blocks[1].body.frames']);
  expect(paths({frames: [{caption: 'x'}, {asset: ID, mermaid: GOOD, caption: 'y'}], alt: 'x'})).toEqual(['blocks[1].body.frames[0]', 'blocks[1].body.frames[1]']);
  expect(paths({frames: [{asset: 'b'.repeat(64), caption: 'x'}, {mermaid: 'flowchart TD\n  a -->', caption: 'y'}], alt: 'x'})).toEqual(['blocks[1].body.frames[0].asset', 'blocks[1].body.frames[1].mermaid']);
  expect(paths({frames: [{md: 'x', caption: 'a'}, {md: 'y', caption: 'b', ask: 'and then?'}], alt: 'x'})).toEqual(['blocks[1].body.frames[1].ask']);
  expect(paths({frames: [{md: 'x', caption: ''}, {md: 'y', caption: 'b', svg: '<svg/>'}], alt: '', autoplay_ms: 100})).toEqual([
    'blocks[1].body.frames[0].caption',
    'blocks[1].body.frames[1].svg',
    'blocks[1].body.alt',
    'blocks[1].body.autoplay_ms',
  ]);
});

test('timed by what changes: the first picture in full, a few seconds for each later one, the words, and each guess', () => {
  const body: StepsBody = {frames: [{asset: ID, caption: 'one two three four five six seven eight nine ten', ask: 'next?'}, {mermaid: GOOD, caption: 'b', ask: null}, {md: 'w '.repeat(20), caption: 'c', ask: null}], alt: 'x', autoplay_ms: null};
  // 10 + 3 labels + 3 (caption) + 5 (ask); 3 + 1; 6 + 1.
  expect(stepsBlock.estimateSeconds(body, {assetLabels: new Map([[ID, 3]])})).toBe(21 + 4 + 7);
  expect(stepsBlock.plainText(body)).toBe('[Step-through: x]\n1. one two three four five six seven eight nine ten (guess: next?)\n2. b\n3. w w w w w w w w w w w w w w w w w w w w — c');
});

test("its mermaid frames are checked with the lesson's diagrams, and its frames are linted like pictures", () => {
  const block = {type: 'steps', concepts: ['moves'], body: {frames: [{mermaid: GOOD, caption: 'a'}, {asset: ID, caption: 'b'}, {md: 'x', caption: 'c'}], alt: 'x'}};
  expect(diagramSources({blocks: [block]})).toEqual([GOOD]);
  expect(figureAssets([block])).toEqual([ID]);
  const wide = {...block, concepts: [], body: {frames: Array.from({length: 9}, (_, i) => (i === 0 ? {mermaid: 'flowchart LR\n  a --> b --> c --> d --> e --> f', caption: 'x'} : {asset: ID, caption: 'x'}))}};
  expect(blockFigureWarnings(wide, 'blocks[2]', new Map([[ID, ['it has no labels']]]))).toEqual([
    expect.stringMatching(/^blocks\[2\]: a picture that serves no concept/),
    expect.stringMatching(/^blocks\[2\]\.body\.frames: 9 frames/),
    expect.stringMatching(/^blocks\[2\]\.body\.frames\[0\]\.mermaid: 6 nodes left to right/),
    ...Array.from({length: 8}, (_, i) => `blocks[2].body.frames[${i + 1}].asset: it has no labels`),
  ]);
});
