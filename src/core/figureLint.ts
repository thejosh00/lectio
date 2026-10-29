/**
 * What a reader at phone width would notice about a picture (M17): labels too small to read,
 * a diagram too wide to read, names in a caption instead of on the parts, a caption that only
 * repeats the alt. These are warnings, never refusals: whether a picture teaches is the
 * tutor's call. They are the mechanical things it can't easily see from the source.
 *
 * Pure.
 */
import {diagramParts} from '../blocks/diagram.ts';
import {svgLabels} from './assets.ts';
import {diagramHeader} from './palette.ts';

/** How wide a figure shows on a phone: a 390 px screen, less the page's margins and the paper's. */
export const PHONE_FIGURE_WIDTH = 340;
/** The smallest label that reads at arm's length. */
export const MIN_LABEL_PX = 12;
/** One accent and a few kinds; past this, colour stops pointing at anything. */
export const MAX_COLORS = 6;
export const CAPTION_WORDS_MAX = 40;
/** Nodes left to right before each one is too small to read at phone width. */
export const ROW_NODES_MAX = 5;
/** Things to read in one picture before it is two ideas. */
export const FIGURE_ELEMENTS_MAX = 25;

/** Block types that are a picture, and so must show something a concept needs. */
export const PICTURE_TYPES: ReadonlySet<string> = new Set(['image', 'diagram']);

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];

/** Every font size the SVG sets, in its own units: attributes, inline styles and `font:` shorthands. */
function fontSizes(svg: string): number[] {
  const sizes: number[] = [];
  for (const m of svg.matchAll(/font-size\s*[:=]\s*["']?\s*([\d.]+)\s*(px|pt)?(?![\d.]*\s*(?:em|rem|%))/gi)) sizes.push(Number(m[1]) * (m[2]?.toLowerCase() === 'pt' ? 4 / 3 : 1));
  for (const m of svg.matchAll(/\bfont\s*:\s*[^;"'}]*?([\d.]+)px/gi)) sizes.push(Number(m[1]));
  return sizes.filter(size => Number.isFinite(size) && size > 0);
}

function rgbOf(color: string): [number, number, number] | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  return rgb === null ? undefined : [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** The distinct colours an SVG paints with, leaving out black, white and greys. */
function colorsOf(svg: string): Set<string> {
  const out = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) {
    const rgb = rgbOf(m[1]!);
    if (rgb === undefined || Math.max(...rgb) - Math.min(...rgb) < 24) continue;
    out.add(rgb.join(','));
  }
  return out;
}

/** What an SVG asset will look like on a phone, from its source. Empty when nothing stands out. */
export function svgLint(svg: string): string[] {
  const out: string[] = [];
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const box = attr(root, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  const hasBox = box !== undefined && box.length === 4 && box.every(Number.isFinite) && box[2]! > 0;
  const widthText = attr(root, 'width');
  const widthPx = widthText !== undefined && /^\s*[\d.]+\s*(px)?\s*$/.test(widthText) ? parseFloat(widthText) : undefined;
  if (!hasBox) out.push('it has no viewBox, so a phone may crop it rather than scale it: add viewBox="0 0 <width> <height>"');
  const labels = svgLabels(svg);
  if (labels === 0) out.push("it has no labels (`<text>`): name the parts on the picture, beside what they name, not in a caption or a legend");
  const drawnWidth = hasBox ? box[2]! : widthPx;
  if (labels > 0 && drawnWidth !== undefined) {
    const shown = Math.min(PHONE_FIGURE_WIDTH, widthPx ?? PHONE_FIGURE_WIDTH);
    const scale = shown / drawnWidth;
    const sizes = fontSizes(svg);
    // Text with no size set is drawn at 16.
    const smallest = sizes.length === 0 ? 16 : Math.min(...sizes);
    const px = smallest * scale;
    if (px < MIN_LABEL_PX) {
      out.push(
        `its smallest labels show at about ${Math.round(px)} px on a phone (font-size ${smallest} in a drawing ${drawnWidth} wide, shown ${Math.round(shown)} px wide): ` +
          `make them at least ${Math.ceil(MIN_LABEL_PX / scale)}, or draw it narrower`,
      );
    }
  }
  const colors = colorsOf(svg).size;
  if (colors > MAX_COLORS) out.push(`it paints with ${colors} colours: signal with one accent (focus) and a few kinds, from the figure palette`);
  const external = [...svg.matchAll(/\s(?:xlink:)?href\s*=\s*["']\s*([^"'#\s][^"']*)["']/gi)].map(m => m[1]!).filter(href => !/^data:/i.test(href));
  if (external.length > 0) {
    out.push(`it refers to ${external[0]!.slice(0, 80)}${external.length > 1 ? ` and ${external.length - 1} more` : ''}: a picture shown through \`<img>\` loads nothing outside itself; embed it as a data: URI`);
  }
  return out;
}

/** One picture, wherever it sits: an image or diagram block's body, a step's frame, a question's figure. */
export interface FigureFields {
  asset?: unknown;
  mermaid?: unknown;
  alt?: unknown;
  caption?: unknown;
}

const words = (text: string) => text.split(/\s+/).filter(word => word !== '').length;
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The warnings for one picture; `path` is where it sits (`blocks[3].body`). */
export function figureWarnings(figure: FigureFields, path: string, svgWarnings: ReadonlyMap<string, readonly string[]>): string[] {
  const out: string[] = [];
  const caption = typeof figure.caption === 'string' ? figure.caption : '';
  const alt = typeof figure.alt === 'string' ? figure.alt : '';
  if (words(caption) > CAPTION_WORDS_MAX) {
    out.push(`${path}.caption: ${words(caption)} words under a picture split the reader's eye between them; put the names on the picture and the explanation in the text beside it`);
  }
  if (caption !== '' && plain(caption) === plain(alt)) {
    out.push(`${path}.caption repeats the alt: the alt is the picture in words for someone who can't see it; the caption is what a reader who can needs to look for`);
  }
  if (typeof figure.mermaid === 'string') {
    const {direction} = diagramHeader(figure.mermaid);
    const {nodes, labels} = diagramParts(figure.mermaid);
    if ((direction === 'LR' || direction === 'RL') && nodes > ROW_NODES_MAX) {
      out.push(`${path}.mermaid: ${nodes} nodes left to right shrink to unreadable at phone width; draw it top-down (TD), or split it`);
    }
    if (nodes + labels > FIGURE_ELEMENTS_MAX) out.push(`${path}.mermaid: ${nodes + labels} things to read in one picture; one idea per picture — split it, or build it up a step at a time`);
  }
  if (typeof figure.asset === 'string') for (const warning of svgWarnings.get(figure.asset) ?? []) out.push(`${path}.asset: ${warning}`);
  return out;
}

export interface BlockLike {
  type: string;
  concepts: readonly string[];
  body: Record<string, unknown>;
}

/** The warnings for a block's pictures; `path` is the block's (`blocks[3]`). */
export function blockFigureWarnings(block: BlockLike, path: string, svgWarnings: ReadonlyMap<string, readonly string[]>): string[] {
  if (!PICTURE_TYPES.has(block.type)) return [];
  const out: string[] = [];
  if (block.concepts.length === 0) out.push(`${path}: a picture that serves no concept is decoration, and decoration costs the reader attention; name the concept it shows, or cut it`);
  out.push(...figureWarnings(block.body, `${path}.body`, svgWarnings));
  return out;
}

export const lessonFigureWarnings = (blocks: readonly BlockLike[], svgWarnings: ReadonlyMap<string, readonly string[]>) => blocks.flatMap((block, i) => blockFigureWarnings(block, `blocks[${i}]`, svgWarnings));

/** The assets a block's pictures show, for looking up their SVG warnings. */
export function figureAssets(blocks: readonly BlockLike[]): string[] {
  return blocks.flatMap(block => (PICTURE_TYPES.has(block.type) && typeof block.body['asset'] === 'string' ? [block.body['asset']] : []));
}
