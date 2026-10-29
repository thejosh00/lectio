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
/** After a page has loaded over the DevTools protocol, how long to let it draw. */
const SETTLE_MS = 600;

/** Serve `route` on 127.0.0.1 for as long as `use` runs; `route` returns undefined for a 404. */
export async function withPages<T>(route: (path: string, origin: string) => Response | undefined, use: (origin: string) => Promise<T>): Promise<T> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: req => {
      const url = new URL(req.url);
      return route(url.pathname, url.origin) ?? new Response('not found', {status: 404});
    },
  });
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

/** A page open in headless Chrome over the DevTools protocol, at a real viewport of any width. */
export interface Page {
  /** The value of an expression in the page, awaited. */
  eval(expression: string): Promise<unknown>;
  /** Save a PNG of the viewport. */
  png(path: string): Promise<void>;
}

/**
 * Open `url` at `size` (CSS pixels, at twice the density, like a phone), let it load and draw,
 * then hand it to `use`. A window can't be made narrower than about 500 px; a viewport can.
 * (Virtual time would make the moment exact, but a screenshot never comes back under it.)
 */
export async function inPage<T>(
  chromePath: string,
  url: string,
  size: {width: number; height: number},
  use: (page: Page) => Promise<T>,
  options: {cookies?: Array<{name: string; value: string}>} = {},
): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), 'lectio-chrome-'));
  const proc = Bun.spawn([chromePath, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  let socket: WebSocket | undefined;
  try {
    const port = await until(async () => (await Bun.file(join(profile, 'DevToolsActivePort')).text().catch(() => '')).split('\n')[0] || undefined);
    const target = await until(async () => ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{type: string; webSocketDebuggerUrl: string}>).find(t => t.type === 'page'));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    socket = ws;
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let id = 0;
    const replies = new Map<number, (message: {result?: any; error?: {message: string}}) => void>();
    const events = new Map<string, () => void>();
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as {id?: number; method?: string; result?: unknown; error?: {message: string}};
      if (message.id !== undefined) replies.get(message.id)?.(message);
      if (message.method !== undefined) events.get(message.method)?.();
    });
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => reject(new Error(`Chrome didn't answer ${method}`)), 20_000);
        replies.set(n, reply => {
          clearTimeout(timer);
          if (reply.error === undefined) resolve(reply.result);
          else reject(new Error(`${method}: ${reply.error.message}`));
        });
        ws.send(JSON.stringify({id: n, method, params}));
      });
    const loaded = new Promise<void>(resolve => {
      events.set('Page.loadEventFired', resolve);
      setTimeout(resolve, 15_000);
    });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: size.width, height: size.height, deviceScaleFactor: 2, mobile: true});
    for (const cookie of options.cookies ?? []) await send('Network.setCookie', {...cookie, url});
    await send('Page.navigate', {url});
    await loaded;
    // A moment for what runs on load to draw.
    await Bun.sleep(SETTLE_MS);
    return await use({
      eval: async expression => (await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true})).result?.value,
      png: async path => {
        const shot = await send('Page.captureScreenshot', {format: 'png'});
        await Bun.write(path, Buffer.from(shot.data as string, 'base64'));
      },
    });
  } finally {
    socket?.close();
    proc.kill();
    await proc.exited;
    rmSync(profile, {recursive: true, force: true});
  }
}

/** Retry `get` every 50 ms, up to 10 s, until it gives a value. */
async function until<T>(get: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await get().catch(() => undefined);
    if (value !== undefined) return value;
    await Bun.sleep(50);
  }
  throw new Error('Chrome did not start');
}
