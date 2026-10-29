/** M21: the widget block — what an animation and an interactive must say, and how one is wrapped. */
import {expect, test} from 'bun:test';
import {widgetBlock} from '../../src/blocks/widget.ts';
import {blockFigureWarnings} from '../../src/core/figureLint.ts';
import {networkReach, wrapWidget} from '../../src/core/widget.ts';

const ctx = {path: 'blocks[3].body', conceptKeys: new Set<string>(), assets: new Set<string>(), questionRefs: new Set<string>(), diagrams: new Map<string, string | null>(), limits: {widget_max_bytes: 2000}};
const paths = (body: unknown) => {
  const result = widgetBlock.validate(body, ctx);
  return result.ok ? [] : result.issues.map(i => i.path);
};
const animation = {kind: 'animation', html: '<canvas></canvas>', height: 240, alt: 'a kernel slides across', duration: 8, steps: [{at: 0, caption: 'top left'}, {at: 4, caption: 'next row'}]};

test('an animation has a duration and steps in order; an interactive has a goal', () => {
  expect(widgetBlock.validate(animation, ctx)).toEqual({ok: true, value: {...animation, libs: [], caption: null, goal: null, predict: null}} as never);
  expect(paths({...animation, duration: undefined})).toEqual(['blocks[3].body.duration']);
  expect(paths({...animation, steps: [{at: 4, caption: 'a'}, {at: 2, caption: 'b'}]})).toEqual(['blocks[3].body.steps[1].at']);
  expect(paths({...animation, steps: [{at: 9, caption: 'past the end'}]})).toEqual(['blocks[3].body.steps[0].at']);
  expect(paths({...animation, goal: 'watch'})).toEqual(['blocks[3].body.goal']);
  const interactive = {kind: 'interactive', html: '<input type=range>', height: 200, alt: 'a threshold slider', goal: 'find the threshold that keeps only the edges'};
  expect(widgetBlock.validate(interactive, ctx).ok).toBe(true);
  expect(paths({...interactive, goal: undefined})).toEqual(['blocks[3].body.goal']);
  expect(paths({...interactive, duration: 5, steps: []})).toEqual(['blocks[3].body.duration', 'blocks[3].body.steps']);
  expect(paths({...interactive, libs: ['d3', 'jquery'], height: 50, html: 'x'.repeat(2001)})).toEqual(['blocks[3].body.html', 'blocks[3].body.libs[1]', 'blocks[3].body.height']);
});

test('timed by what it asks of the learner, and printed with its steps or goal', () => {
  const body = widgetBlock.validate({...animation, predict: 'Where does it go next?'}, ctx);
  if (!body.ok) throw new Error('invalid');
  // 10 s to look, 8 s of it, the steps' words, 5 s for the guess.
  expect(widgetBlock.estimateSeconds(body.value, {assetLabels: new Map()})).toBe(10 + 8 + 2 + 5);
  expect(widgetBlock.plainText(body.value)).toBe('[Animation: a kernel slides across]\n(guess first: Where does it go next?)\nat 0 s: top left\nat 4 s: next row');
});

test('wrapped with the theme, the bridge and only the libraries asked for; lines counted from the widget’s own', () => {
  const page = wrapWidget('<p>hi</p>', {libs: ['d3', 'nope']});
  expect(page).toContain('<script src="/w/lib/d3.js"></script>');
  expect(page).not.toContain('nope');
  expect(page).toContain('--lectio-focus: #d55e00');
  expect(page).toContain('window.lectio = lectio');
  const offset = Number(/const OFFSET = (\d+);/.exec(page)![1]);
  expect(page.split('\n')[offset]).toBe('<p>hi</p>');
});

test('ways to reach the network are found; XML namespaces are names, not requests', () => {
  expect(networkReach('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual([]);
  expect(networkReach('fetch ("/x"); new WebSocket(u); import("https://cdn.example.com/lib.js")')).toEqual(['fetch(', 'WebSocket', 'import(', 'https://cdn.example.com/lib.js']);
  const warnings = blockFigureWarnings({type: 'widget', concepts: ['c'], body: {...animation, steps: [], duration: 30, html: 'fetch("/a")'}}, 'blocks[3]', new Map());
  expect(warnings).toEqual([expect.stringMatching(/^blocks\[3\]\.body\.html reaches for the network \(fetch\(\)/), expect.stringMatching(/^blocks\[3\]\.body\.steps: a 30 s animation with no steps/)]);
});
