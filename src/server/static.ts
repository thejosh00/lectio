/**
 * Files the page loads on demand, served from the installed packages rather than a CDN,
 * so lectio works offline and on a home network.
 *
 * KaTeX's stylesheet carries sixty fonts; bundled, they would make every page load pay
 * for math most lessons don't have. So the page links `/katex/katex.min.css` only when a
 * lesson renders math, and the browser fetches just the fonts it uses.
 *
 * Mermaid is bigger still (megabytes), and Bun's HTML bundler would inline a dynamic import
 * of it into the page's one script. So it is served the same way, from the installed
 * package's own ES-module build under `/mermaid/`, and the diagram renderer imports it by
 * URL: only a lesson with a diagram fetches it, and then only the parts its diagrams use.
 */
import {existsSync} from 'node:fs';
import instrumentSans from '../web/fonts/instrument-sans-latin-wght-normal.woff2' with {type: 'file'};
import jetbrainsMono from '../web/fonts/jetbrains-mono-latin-wght-normal.woff2' with {type: 'file'};
import newsreaderItalic from '../web/fonts/newsreader-latin-opsz-italic.woff2' with {type: 'file'};
import newsreader from '../web/fonts/newsreader-latin-opsz-normal.woff2' with {type: 'file'};
import {dirname, join, normalize, sep} from 'node:path';

/** Where the installed KaTeX lives; undefined in a compiled binary, where math then renders unstyled. */
let katexDir: string | null | undefined;
function katex(): string | undefined {
  if (katexDir === undefined) {
    try {
      katexDir = dirname(Bun.resolveSync('katex/dist/katex.min.css', import.meta.dir));
    } catch {
      katexDir = null;
    }
  }
  return katexDir ?? undefined;
}

/** Where the installed mermaid's browser build lives; undefined in a compiled binary, where diagrams show their alt. */
let mermaidDir: string | null | undefined;
function mermaid(): string | undefined {
  if (mermaidDir === undefined) {
    try {
      mermaidDir = dirname(Bun.resolveSync('mermaid/dist/mermaid.esm.min.mjs', import.meta.dir));
    } catch {
      mermaidDir = null;
    }
  }
  return mermaidDir ?? undefined;
}

const TYPES: Record<string, string> = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** A file under `root` by its path relative to it, or a 404. Never outside `root`. */
export function serveFrom(root: string, relative: string, only?: readonly string[]): Response {
  const path = normalize(join(root, relative));
  const extension = /\.[a-z0-9]+$/.exec(path)?.[0] ?? '';
  if (!path.startsWith(root + sep) || TYPES[extension] === undefined || (only !== undefined && !only.includes(extension)) || !existsSync(path)) return new Response('Not found', {status: 404});
  return new Response(Bun.file(path), {
    headers: {'content-type': TYPES[extension]!, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff'},
  });
}

/**
 * The page's typefaces (SIL Open Font License; src/web/fonts/LICENSES.txt). Imported as
 * files, so a compiled binary carries them too. Bundled into the stylesheet they would be
 * inlined as base64 and every stylesheet load would pay for them; served here, each is
 * fetched once and cached.
 */
const FONT_FILES: Record<string, string> = {
  'newsreader-latin-opsz-normal.woff2': newsreader,
  'newsreader-latin-opsz-italic.woff2': newsreaderItalic,
  'instrument-sans-latin-wght-normal.woff2': instrumentSans,
  'jetbrains-mono-latin-wght-normal.woff2': jetbrainsMono,
};

const face = (family: string, style: string, weight: string, file: string) =>
  `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url('/fonts/${file}') format('woff2')}`;

export const FONTS_CSS = [
  face('Newsreader', 'normal', '200 800', 'newsreader-latin-opsz-normal.woff2'),
  face('Newsreader', 'italic', '200 800', 'newsreader-latin-opsz-italic.woff2'),
  face('Instrument Sans', 'normal', '400 700', 'instrument-sans-latin-wght-normal.woff2'),
  face('JetBrains Mono', 'normal', '100 800', 'jetbrains-mono-latin-wght-normal.woff2'),
].join('\n');

function font(request: Request): Response {
  const name = decodeURIComponent(new URL(request.url).pathname.slice('/fonts/'.length));
  if (name === 'fonts.css') return new Response(FONTS_CSS, {headers: {'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff'}});
  const path = Object.hasOwn(FONT_FILES, name) ? FONT_FILES[name] : undefined;
  if (path === undefined) return new Response('Not found', {status: 404});
  return new Response(Bun.file(path), {headers: {'content-type': 'font/woff2', 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff'}});
}

export const staticRoutes: Record<string, (request: Request) => Response> = {
  '/fonts/*': font,
  '/katex/*': request => {
    const root = katex();
    return root === undefined ? new Response('Not found', {status: 404}) : serveFrom(root, decodeURIComponent(new URL(request.url).pathname.slice('/katex/'.length)), ['.css', '.woff2', '.woff', '.ttf']);
  },
  '/mermaid/*': request => {
    const root = mermaid();
    return root === undefined ? new Response('Not found', {status: 404}) : serveFrom(root, decodeURIComponent(new URL(request.url).pathname.slice('/mermaid/'.length)), ['.mjs']);
  },
};
