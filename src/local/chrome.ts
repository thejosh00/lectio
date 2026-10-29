/**
 * Headless Chrome, for looking at what the learner will see before it ships (M17's `figure
 * check`, and later `widget check`). Runs where the tutor runs, like `lectio tools`.
 *
 * The page is served from a throwaway server on 127.0.0.1, because Chrome won't load modules
 * from file://, and Chrome runs in a throwaway profile, never the user's. Pages here hold no
 * open connection, so `--virtual-time-budget` returns as soon as the page is idle.
 */
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** How long a page may take to settle, in virtual milliseconds. */
const BUDGET_MS = 8000;

/** Serve `route` on 127.0.0.1 for as long as `use` runs; `route` returns undefined for a 404. */
export async function withPages<T>(route: (path: string) => Response | undefined, use: (origin: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, fetch: req => route(new URL(req.url).pathname) ?? new Response('not found', {status: 404})});
  try {
    return await use(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}

async function chrome(path: string, flags: string[], url: string): Promise<string> {
  const profile = mkdtempSync(join(tmpdir(), 'lectio-chrome-'));
  try {
    const proc = Bun.spawn([path, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--virtual-time-budget=${BUDGET_MS}`, ...flags, url], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) throw new Error(`Chrome exited with ${proc.exitCode}`);
    return out;
  } finally {
    rmSync(profile, {recursive: true, force: true});
  }
}

/** The page's DOM once it has settled. */
export const dumpDom = (chromePath: string, url: string) => chrome(chromePath, ['--dump-dom'], url);

/** A PNG of the page's top `width` × `height` pixels. */
export async function screenshot(chromePath: string, url: string, png: string, size: {width: number; height: number}): Promise<void> {
  await chrome(chromePath, [`--screenshot=${png}`, `--window-size=${Math.ceil(size.width)},${Math.ceil(size.height)}`], url);
}
