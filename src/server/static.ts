/**
 * Files the page loads on demand, served from the installed packages rather than a CDN,
 * so lectio works offline and on a home network.
 *
 * KaTeX's stylesheet carries sixty fonts; bundled, they would make every page load pay
 * for math most lessons don't have. So the page links `/katex/katex.min.css` only when a
 * lesson renders math, and the browser fetches just the fonts it uses.
 */
import {existsSync} from 'node:fs';
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

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** A file under `root` by its path relative to it, or a 404. Never outside `root`. */
export function serveFrom(root: string, relative: string): Response {
  const path = normalize(join(root, relative));
  const extension = /\.[a-z0-9]+$/.exec(path)?.[0] ?? '';
  if (!path.startsWith(root + sep) || TYPES[extension] === undefined || !existsSync(path)) return new Response('Not found', {status: 404});
  return new Response(Bun.file(path), {
    headers: {'content-type': TYPES[extension]!, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff'},
  });
}

export const staticRoutes: Record<string, (request: Request) => Response> = {
  '/katex/*': request => {
    const root = katex();
    return root === undefined ? new Response('Not found', {status: 404}) : serveFrom(root, decodeURIComponent(new URL(request.url).pathname.slice('/katex/'.length)));
  },
};
