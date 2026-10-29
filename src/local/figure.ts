/**
 * `lectio figure check <file>` (M17): a picture as a phone shows it, before it ships. Lints
 * the picture — the same warnings a lesson gets — and, when Chrome is here, draws it the way
 * the page does (on the figure paper, at phone width, a diagram with the palette) and saves a
 * PNG for the tutor to look at. Runs where the tutor runs; needs no server.
 */
import {dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {sniffImage} from '../core/assets.ts';
import {figureWarnings, PHONE_FIGURE_WIDTH, svgLint} from '../core/figureLint.ts';
import {MERMAID_CONFIG, naturalSize, PAPER, withPalette} from '../core/palette.ts';
import {checkMermaid} from '../server/diagrams.ts';
import {dumpDom, screenshot, withPages} from './chrome.ts';

export interface FigureCheck {
  ok: boolean;
  kind: 'svg' | 'raster' | 'mermaid';
  warnings: string[];
  /** Why it can't be shown: mermaid refused it, or it couldn't be drawn. */
  error: string | null;
  /** The PNG of it as a phone shows it; null without Chrome. */
  png: string | null;
  /** Its size on the page at phone width, in CSS pixels. */
  shown: {width: number; height: number} | null;
}

/** The page's column at phone width: a 390 px screen, its 16 px gutters; the paper inside. */
const CARD_WIDTH = PHONE_FIGURE_WIDTH + 22;
const GUTTER = 16;

function page(kind: FigureCheck['kind'], source: string | null): string {
  const data = JSON.stringify({kind, source, config: MERMAID_CONFIG}).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; background: #f5f3ee; }
.card { width: ${CARD_WIDTH}px; margin: ${GUTTER}px; padding: 10px; box-sizing: border-box; background: ${PAPER}; border: 1px solid #e2ded4; border-radius: 12px; }
img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
</style></head><body><div class="card"><img id="figure" alt=""></div><pre id="lectio-result" hidden></pre>
<script type="module">
const data = ${data};
const naturalSize = ${naturalSize.toString()};
const result = document.getElementById('lectio-result');
const img = document.getElementById('figure');
try {
  if (data.kind === 'mermaid') {
    const mermaid = (await import('/mermaid/mermaid.esm.min.mjs')).default;
    mermaid.initialize(data.config);
    const {svg} = await mermaid.render('lectio-figure', data.source);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(naturalSize(svg));
  } else img.src = '/figure';
  await img.decode();
  const card = document.querySelector('.card').getBoundingClientRect();
  result.textContent = JSON.stringify({width: img.clientWidth, height: img.clientHeight, page: Math.ceil(card.bottom) + ${GUTTER}});
} catch (error) {
  result.textContent = JSON.stringify({error: String(error && error.message || error)});
}
</script></body></html>`;
}

function mermaidDir(): string | undefined {
  try {
    return dirname(Bun.resolveSync('mermaid/dist/mermaid.esm.min.mjs', import.meta.dir));
  } catch {
    return undefined;
  }
}

export async function figureCheck(data: Uint8Array, options: {chrome: string | null; out?: string | undefined}): Promise<FigureCheck> {
  const mime = sniffImage(data);
  const text = new TextDecoder().decode(data);
  const kind: FigureCheck['kind'] = mime === 'image/svg+xml' ? 'svg' : mime !== undefined ? 'raster' : 'mermaid';
  const warnings = kind === 'svg' ? svgLint(text).map(w => `the SVG: ${w}`) : kind === 'mermaid' ? figureWarnings({mermaid: text}, 'figure', new Map()) : [];
  if (kind === 'mermaid') {
    const verdict = (await checkMermaid([text])).get(text);
    if (verdict !== null) return {ok: false, kind, warnings, error: verdict === undefined ? 'empty, or too long for a diagram' : `doesn't parse as mermaid: ${verdict}`, png: null, shown: null};
  }
  if (options.chrome === null) return {ok: true, kind, warnings: [...warnings, 'no Chrome on this machine, so nothing was drawn: install it, or set CHROME_PATH'], error: null, png: null, shown: null};

  const chrome = options.chrome;
  const html = page(kind, kind === 'mermaid' ? withPalette(text) : null);
  const dist = mermaidDir();
  const png = options.out ?? join(tmpdir(), `lectio-figure-${new Bun.CryptoHasher('sha256').update(data).digest('hex').slice(0, 12)}.png`);
  return withPages(
    path => {
      if (path === '/') return new Response(html, {headers: {'content-type': 'text/html; charset=utf-8'}});
      if (path === '/figure' && mime !== undefined) return new Response(new Blob([data as Uint8Array<ArrayBuffer>]), {headers: {'content-type': mime}});
      if (path.startsWith('/mermaid/') && dist !== undefined && !path.includes('..')) return new Response(Bun.file(join(dist, path.slice('/mermaid/'.length))), {headers: {'content-type': 'text/javascript; charset=utf-8'}});
      return undefined;
    },
    async origin => {
      const dom = await dumpDom(chrome, `${origin}/`);
      const raw = /<pre id="lectio-result"[^>]*>([\s\S]*?)<\/pre>/.exec(dom)?.[1];
      const drawn = raw === undefined || raw === '' ? {error: 'the page never finished drawing it'} : (JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) as {width?: number; height?: number; page?: number; error?: string});
      if (drawn.error !== undefined) return {ok: false, kind, warnings, error: `couldn't be drawn: ${drawn.error}`, png: null, shown: null};
      await screenshot(chrome, `${origin}/`, png, {width: CARD_WIDTH + GUTTER * 2, height: drawn.page ?? 600});
      return {ok: true, kind, warnings, error: null, png, shown: {width: drawn.width ?? 0, height: drawn.height ?? 0}};
    },
  );
}

export function figureCheckText(check: FigureCheck): string[] {
  return [
    check.error !== null ? `can't show it: ${check.error}` : check.shown === null ? `checked (${check.kind})` : `shown ${check.shown.width} × ${check.shown.height} px at phone width (${check.kind})`,
    ...(check.png === null ? [] : [`  look at it: ${check.png}`]),
    ...check.warnings.map(w => `  warning: ${w}`),
  ];
}
