/**
 * `lectio widget check <file.html>` (M21): a widget looked at before it ships. Runs where the
 * tutor runs; needs no server.
 *
 * 1. Static: its size, its libraries, and any way it would reach the network (the sandbox
 *    would block it, and the learner would see a broken widget).
 * 2. Frames, with Chrome: the widget wrapped as lectio serves it, under the same sandbox, drawn
 *    at phone width once per requested time — an animation through `lectio.animate` at exactly
 *    that moment — and a PNG of each for the tutor to look at, with any error it threw.
 */
import {mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SETTINGS} from '../core/settings.ts';
import {byteLength} from '../core/validate.ts';
import {networkReach, WIDGET_LIB_NAMES, widgetCsp, wrapWidget} from '../core/widget.ts';
import {widgetLibPath} from '../server/widgets.ts';
import {inPage, withPages} from './chrome.ts';

export interface WidgetCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  frames: Array<{at: number; path: string; errors: string[]}>;
}

/** A widget's frame at phone width: a 390 px screen less its 16 px gutters. */
export const WIDGET_PHONE_WIDTH = 358;

export async function widgetCheck(
  html: string,
  options: {libs: string[]; frames: number[]; kind?: string | undefined; height?: number | undefined; chrome: string | null; out?: string | undefined},
): Promise<WidgetCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const max = Number(SETTINGS['widget_max_bytes']!.default);
  if (byteLength(html) > max) errors.push(`it is ${byteLength(html)} bytes; the most is ${max} (widget_max_bytes)`);
  for (const lib of options.libs) if (!(WIDGET_LIB_NAMES as string[]).includes(lib)) errors.push(`no library "${lib}"; there are ${WIDGET_LIB_NAMES.join(', ')}`);
  for (const reach of networkReach(html)) errors.push(`it reaches for the network (${reach}): the sandbox blocks it, so the widget would break; draw everything from the page itself`);
  if (options.kind === 'animation' && !/lectio\.animate\s*\(/.test(html)) errors.push('an animation draws through lectio.animate(draw, {duration}), so the page can play, pause and step it');
  if (options.chrome === null) {
    warnings.push('no Chrome on this machine, so no frames were drawn: install it, or set CHROME_PATH');
    return {ok: errors.length === 0, errors, warnings, frames: []};
  }
  const chrome = options.chrome;
  const page = wrapWidget(html, {libs: options.libs, check: true});
  const dir = options.out ?? join(tmpdir(), `lectio-widget-${new Bun.CryptoHasher('sha256').update(html).digest('hex').slice(0, 12)}`);
  mkdirSync(dir, {recursive: true});
  const frames = await withPages(
    (path, origin) => {
      if (path === '/w/check') return new Response(page, {headers: {'content-type': 'text/html; charset=utf-8', 'content-security-policy': widgetCsp(origin)}});
      if (path.startsWith('/w/lib/')) {
        const lib = widgetLibPath(path.slice('/w/lib/'.length).replace(/\.js$/, ''));
        return lib === undefined ? undefined : new Response(Bun.file(lib), {headers: {'content-type': 'text/javascript; charset=utf-8'}});
      }
      return undefined;
    },
    async served => {
      const out: WidgetCheck['frames'] = [];
      for (const at of options.frames) {
        const png = join(dir, `frame-${String(at).replace('.', '_')}s.png`);
        const frame = await inPage(chrome, `${served}/w/check?t=${at}`, {width: WIDGET_PHONE_WIDTH, height: options.height ?? 300}, async page => {
          const thrown = String((await page.eval("document.getElementById('lectio-errors')?.textContent || '[]'")) ?? '[]');
          const frameErrors = (JSON.parse(thrown) as Array<{message: string; line: number}>).map(e => `${e.message}${e.line > 0 ? ` (line ${e.line})` : ''}`);
          if (options.kind === 'animation' && (await page.eval('document.documentElement.dataset.lectioDrawn')) === undefined) frameErrors.push('lectio.animate was never called, so nothing was drawn at this moment');
          await page.png(png);
          return {at, path: png, errors: frameErrors};
        });
        out.push(frame);
      }
      return out;
    },
  );
  for (const frame of frames) for (const error of frame.errors) if (!errors.includes(error)) errors.push(error);
  return {ok: errors.length === 0, errors, warnings, frames};
}

export function widgetCheckText(check: WidgetCheck): string[] {
  return [
    check.ok ? 'checked: no problems found' : `${check.errors.length} problem${check.errors.length === 1 ? '' : 's'}`,
    ...check.errors.map(e => `  error: ${e}`),
    ...check.warnings.map(w => `  warning: ${w}`),
    ...check.frames.map(f => `  look at ${f.at} s: ${f.path}`),
  ];
}
