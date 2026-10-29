/**
 * The figure palette (M17). Every picture a lesson shows sits on the same light "paper" in
 * both themes, so one set of colours works for an SVG the tutor draws (which can't see the
 * page's theme through `<img>`) and for a mermaid diagram lectio draws. The same colour
 * meaning the same thing in every lesson is what lets a learner link one picture to the next.
 *
 * The colours are from the Okabe–Ito set, which stays distinguishable with the common
 * colour-vision deficiencies, darkened where they carry text on paper.
 *
 * Pure.
 */

export const PAPER = '#fdfcf9';

export interface PaletteColor {
  name: string;
  hex: string;
  /** A light fill of the same hue, for a shape's inside. */
  fill: string;
  use: string;
}

export const FIGURE_PALETTE: readonly PaletteColor[] = [
  {name: 'ink', hex: '#1a1a18', fill: '#ffffff', use: 'lines, labels and text'},
  {name: 'muted', hex: '#8a857b', fill: '#f2f0eb', use: 'context the reader should look past'},
  {name: 'focus', hex: '#d55e00', fill: '#fbe3d3', use: 'the one part this picture is about; pair it with a thicker stroke or an arrow'},
  {name: 'c1', hex: '#0072b2', fill: '#dcebf5', use: 'a first kind of thing'},
  {name: 'c2', hex: '#007a5a', fill: '#d9efe7', use: 'a second kind'},
  {name: 'c3', hex: '#b07800', fill: '#f8ecd2', use: 'a third kind'},
  {name: 'c4', hex: '#b0558b', fill: '#f5e1ec', use: 'a fourth kind'},
];

/** The mermaid class each palette colour becomes. `ink` is mermaid's default look. */
const CLASS_DEFS: Record<string, string> = Object.fromEntries(
  FIGURE_PALETTE.filter(c => c.name !== 'ink').map(c => [
    c.name,
    c.name === 'focus' ? `fill:${c.fill},stroke:${c.hex},stroke-width:3px,color:#1a1a18` : c.name === 'muted' ? `fill:${c.fill},stroke:#b9b4aa,color:${c.hex}` : `fill:${c.fill},stroke:${c.hex},color:#1a1a18`,
  ]),
);

export const PALETTE_CLASSES = Object.keys(CLASS_DEFS);

/** How mermaid draws for the page and for `figure check`: light, plain SVG labels, nothing that runs. */
export const MERMAID_CONFIG = {startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, flowchart: {htmlLabels: false}} as const;

/** Diagram types whose grammar has `classDef`: the palette's classes are defined for these. */
const CLASSED = /^(flowchart|graph|stateDiagram(-v2)?)\b/;

/** The first line that says what kind of diagram it is: past `%%` comments, `%%{init}%%` and front matter. */
function header(source: string): string {
  let lines = source.split('\n');
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    lines = end === -1 ? [] : lines.slice(end + 1);
  }
  return lines.map(line => line.trim()).find(line => line !== '' && !line.startsWith('%%')) ?? '';
}

/**
 * A mermaid source with the palette's classes defined, so `class a focus` (or `a:::focus`)
 * means the same thing in every lesson. A class the source defines itself is left alone.
 * The server checks and the page draws this same text, so what was checked is what is drawn.
 */
export function withPalette(source: string): string {
  if (!CLASSED.test(header(source))) return source;
  const missing = PALETTE_CLASSES.filter(name => !new RegExp(`^\\s*classDef\\s+([\\w,]*,)?${name}\\b`, 'm').test(source));
  if (missing.length === 0) return source;
  return `${source.replace(/\s*$/, '')}\n${missing.map(name => `  classDef ${name} ${CLASS_DEFS[name]}`).join('\n')}\n`;
}

/** The kind of diagram a source declares (`flowchart`, `sequenceDiagram`…) and its direction, if it has one. */
export function diagramHeader(source: string): {kind: string; direction: string | null} {
  const [kind = '', onHeader] = header(source).split(/\s+/);
  // A state or class diagram says it on a line of its own: `direction LR`.
  const direction = onHeader ?? /^\s*direction\s+(\w+)/m.exec(source)?.[1];
  return {kind, direction: direction !== undefined && /^(TB|TD|BT|RL|LR)$/.test(direction) ? direction : null};
}

/**
 * Mermaid's SVG says `width="100%"`, which in an `<img>` blows a small diagram up to the
 * column. Its viewBox is its natural size: give it that, and CSS only ever scales it down.
 * Self-contained, so `figure check` can send it to the page it draws in.
 */
export function naturalSize(svg: string): string {
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (box === null) return svg;
  return svg.replace(/^<svg([^>]*?) width="100%"/, `<svg$1 width="${box[1]}" height="${box[2]}"`);
}
