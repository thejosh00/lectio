/**
 * #4: how blocks are timed, so the arms of a two-arm lesson can be evened up. A picture is
 * timed by what it gives the reader to take in: an SVG's labels, a diagram's elements.
 */
import {expect, test} from 'bun:test';
import {diagramBlock, diagramElements} from '../../src/blocks/diagram.ts';
import {imageBlock} from '../../src/blocks/image.ts';
import {BLOCK_TYPES} from '../../src/blocks/index.ts';
import {CAPTION_MAX, NO_ESTIMATE_FACTS, SECONDS_PER_LABEL, SECONDS_TO_LOOK} from '../../src/blocks/types.ts';
import {svgLabels} from '../../src/core/assets.ts';

test("an SVG's labels are its <text> elements with words in them", () => {
  expect(svgLabels('<svg><text x="1">PUMP</text><text>2</text><text> </text><text/></svg>')).toBe(2);
  expect(svgLabels('<svg><text><tspan>upper</tspan> <tspan>hose</tspan></text>\n<TEXT font-size="9">fan</TEXT></svg>')).toBe(2);
  expect(svgLabels('<svg><rect/><line/></svg>')).toBe(0);
});

test("a diagram's elements are its nodes and the links, messages and notes that carry text", () => {
  const cases: Array<[string, number]> = [
    // 3 nodes, 2 labelled links: the contract's example.
    ['flowchart TD\n  s1["s1 owns the buffer"] -->|let s2 = s1| s2["s2 owns the buffer"]\n  s2 -->|closing brace| drop["buffer freed, once"]', 5],
    // A chain counts every node once; inline link text is a label; styling is nothing.
    ['flowchart LR\n  pump[Water pump] --> block[Engine block] --> head[Cylinder head] --> t{Thermostat}\n  t -- open --> rad[Radiator]\n  rad --> pump\n  style rad fill:#eef\n  %% a comment', 6],
    ['graph TD\n  A & B --> C\n  A:::warm --> C\n  classDef warm fill:#f96', 3],
    ['flowchart TD\n  subgraph Engine\n    a[Block] --> b[Head]\n  end\n  b --- c[Hose] --- d[Radiator]', 5],
    ['sequenceDiagram\n  participant C as Client\n  C->>S: GET /\n  S-->>C: 200 OK\n  Note over C,S: one round trip', 5],
    ['stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: start\n  Running --> [*]', 3],
    ['mindmap\n  root((Cooling))\n    Pump\n    Radiator\n      Fan', 4],
    ['pie title Pets\n  "Dogs" : 386\n  "Cats" : 85', 2],
  ];
  for (const [source, elements] of cases) expect({source, n: diagramElements(source)}).toEqual({source, n: elements});
});

test('a picture takes a look, a second per label or element, and its caption', () => {
  const image = {asset: 'a'.repeat(64), alt: 'the loop', caption: null};
  expect(imageBlock.estimateSeconds(image, NO_ESTIMATE_FACTS)).toBe(SECONDS_TO_LOOK);
  expect(imageBlock.estimateSeconds(image, {assetLabels: new Map([[image.asset, 35]])})).toBe(SECONDS_TO_LOOK + 35 * SECONDS_PER_LABEL);
  // Ten words of caption are three seconds at 200 words a minute.
  expect(imageBlock.estimateSeconds({...image, caption: 'one two three four five six seven eight nine ten'}, NO_ESTIMATE_FACTS)).toBe(SECONDS_TO_LOOK + 3);

  const small = {mermaid: 'flowchart TD\n  a --> b', alt: 'a to b', caption: null};
  const big = {mermaid: `flowchart TD\n${Array.from({length: 12}, (_, i) => `  n${i} --> n${i + 1}`).join('\n')}`, alt: 'a long chain', caption: null};
  expect(diagramBlock.estimateSeconds(small, NO_ESTIMATE_FACTS)).toBe(SECONDS_TO_LOOK + 2 * SECONDS_PER_LABEL);
  expect(diagramBlock.estimateSeconds(big, NO_ESTIMATE_FACTS)).toBe(SECONDS_TO_LOOK + 13 * SECONDS_PER_LABEL);
});

test('every block type says how it is timed, and the caption limit is the one the contract states', () => {
  for (const type of BLOCK_TYPES) expect(type.timed.length).toBeGreaterThan(0);
  const ctx = {path: 'b', conceptKeys: new Set<string>(), assets: new Set(['a'.repeat(64)]), questionRefs: new Set<string>(), diagrams: new Map<string, string | null>(), limits: {widget_max_bytes: 1000}};
  expect(imageBlock.validate({asset: 'a'.repeat(64), alt: 'x', caption: 'x'.repeat(CAPTION_MAX)}, ctx).ok).toBe(true);
  expect(imageBlock.validate({asset: 'a'.repeat(64), alt: 'x', caption: 'x'.repeat(CAPTION_MAX + 1)}, ctx).ok).toBe(false);
});
