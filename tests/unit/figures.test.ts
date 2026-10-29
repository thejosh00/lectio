/** M17: the figure palette, and the warnings a picture gets when it won't read at phone width. */
import {describe, expect, test} from 'bun:test';
import {blockFigureWarnings, figureAssets, figureWarnings, lessonFigureWarnings, svgLint} from '../../src/core/figureLint.ts';
import {diagramHeader, FIGURE_PALETTE, PALETTE_CLASSES, withPalette} from '../../src/core/palette.ts';

const svg = (inner: string, attrs = 'viewBox="0 0 340 200"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const NONE = new Map<string, string[]>();

describe('the palette', () => {
  test('flowcharts and state diagrams get its classes; other kinds, and classes the source defines, are left alone', () => {
    const flow = withPalette('flowchart TD\n  a --> b\n  class a focus');
    for (const name of PALETTE_CLASSES) expect(flow).toContain(`classDef ${name} `);
    expect(withPalette('%% a comment\nstateDiagram-v2\n  [*] --> A')).toContain('classDef focus ');
    expect(withPalette('sequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram\n  A->>B: hi');
    const own = withPalette('graph LR\n  a --> b\n  classDef focus fill:#f00');
    expect(own.match(/classDef focus/g)?.length).toBe(1);
    expect(own).toContain('classDef c1 ');
    expect(FIGURE_PALETTE.map(c => c.name)).toEqual(['ink', 'muted', 'focus', 'c1', 'c2', 'c3', 'c4']);
  });

  test('a diagram says its kind and direction on its first line, or on a direction line', () => {
    expect(diagramHeader('flowchart LR\n  a --> b')).toEqual({kind: 'flowchart', direction: 'LR'});
    expect(diagramHeader('---\ntitle: x\n---\ngraph TD\n  a')).toEqual({kind: 'graph', direction: 'TD'});
    expect(diagramHeader('stateDiagram-v2\n  direction LR\n  A --> B')).toEqual({kind: 'stateDiagram-v2', direction: 'LR'});
    expect(diagramHeader('sequenceDiagram\n  A->>B: hi')).toEqual({kind: 'sequenceDiagram', direction: null});
  });
});

describe('an SVG at phone width', () => {
  test('a labelled drawing that fits the column has nothing to say', () => {
    expect(svgLint(svg('<rect width="10" height="10" fill="#0072b2"/><text x="4" y="20" font-size="14">owner</text>'))).toEqual([]);
  });

  test('no viewBox, no labels, and links out are each said', () => {
    const [box, labels, link] = svgLint('<svg width="300" height="100"><image href="https://example.com/a.png"/></svg>');
    expect(box).toContain('no viewBox');
    expect(labels).toContain('no labels');
    expect(link).toContain('https://example.com/a.png');
    expect(svgLint(svg('<image href="data:image/png;base64,AAAA"/><text font-size="16">x</text>'))).toEqual([]);
  });

  test('labels are measured as they show: a wide drawing shrinks them', () => {
    // 1200 wide, shown 340 px: 24 becomes about 7 px.
    const [small] = svgLint(svg('<text font-size="24">valve</text>', 'viewBox="0 0 1200 600"'));
    expect(small).toContain('about 7 px');
    expect(small).toContain('at least 43');
    // A style, a px unit and a font shorthand count too; text with no size is 16.
    expect(svgLint(svg('<text style="font-size: 9px">a</text>'))[0]).toContain('about 9 px');
    expect(svgLint(svg('<text style="font: bold 10px sans-serif">a</text>'))[0]).toContain('about 10 px');
    expect(svgLint(svg('<text>a</text>', 'viewBox="0 0 680 400"'))[0]).toContain('about 8 px');
    // A drawing given a small width shows at that width.
    expect(svgLint(svg('<text font-size="16">a</text>', 'width="170" viewBox="0 0 340 200"'))[0]).toContain('about 8 px');
  });

  test('more than six colours is said; black, white and greys are not colours', () => {
    const paints = ['#d55e00', '#0072b2', '#007a5a', '#b07800', '#b0558b', '#56b4e9', '#e69f00'].map(c => `<rect fill="${c}"/>`).join('');
    expect(svgLint(svg(`${paints}<text font-size="14">a</text>`))).toEqual([expect.stringContaining('7 colours')]);
    expect(svgLint(svg(`<rect fill="#000"/><rect stroke="#ffffff"/><rect fill="#777"/><rect style="fill: rgb(200,200,200)"/><text font-size="14">a</text>`))).toEqual([]);
  });
});

describe('a picture in a lesson', () => {
  test('a picture serving no concept, a long caption, and a caption repeating the alt', () => {
    const block = {type: 'image', concepts: [], body: {asset: 'x', alt: 'The owner moves to s2.', caption: 'The owner moves to s2'}};
    const warnings = blockFigureWarnings(block, 'blocks[2]', NONE);
    expect(warnings[0]).toStartWith('blocks[2]: a picture that serves no concept');
    expect(warnings[1]).toStartWith('blocks[2].body.caption repeats the alt');
    const long = figureWarnings({alt: 'x', caption: Array.from({length: 41}, () => 'word').join(' ')}, 'blocks[0].body', NONE);
    expect(long).toEqual([expect.stringContaining('41 words')]);
    // Text blocks are not pictures.
    expect(blockFigureWarnings({type: 'markdown', concepts: [], body: {md: 'x'}}, 'blocks[0]', NONE)).toEqual([]);
  });

  test('a wide left-to-right diagram, and one with too much in it', () => {
    const chain = `flowchart LR\n  ${'abcdef'.split('').join(' --> ')}`;
    expect(figureWarnings({mermaid: chain, alt: 'x'}, 'blocks[1].body', NONE)).toEqual([expect.stringContaining('6 nodes left to right')]);
    expect(figureWarnings({mermaid: chain.replace('LR', 'TD'), alt: 'x'}, 'blocks[1].body', NONE)).toEqual([]);
    const crowded = `flowchart TD\n${Array.from({length: 13}, (_, i) => `  n${i} --> m${i}`).join('\n')}`;
    expect(figureWarnings({mermaid: crowded, alt: 'x'}, 'blocks[1].body', NONE)).toEqual([expect.stringContaining('26 things to read')]);
  });

  test("an image's SVG warnings are said at its path", () => {
    const blocks = [
      {type: 'markdown', concepts: [], body: {md: 'x'}},
      {type: 'image', concepts: ['ownership'], body: {asset: 'abc', alt: 'x', caption: null}},
    ];
    expect(figureAssets(blocks)).toEqual(['abc']);
    expect(lessonFigureWarnings(blocks, new Map([['abc', ['it has no labels']]]))).toEqual(['blocks[1].body.asset: it has no labels']);
  });
});
