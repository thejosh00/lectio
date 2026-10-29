/**
 * Widgets (M21): an animation or an interactive the tutor writes as HTML, run in a box. The
 * server serves each one from its own route with a CSP whose `sandbox` gives it an opaque
 * origin — no cookie, no `/api`, no network — and the page embeds it in a sandboxed iframe as a
 * second wall. It talks to the page only through the bridge below, by `postMessage`.
 *
 * Widgets sit on the figure paper, like every picture, and get the palette as CSS variables.
 * An animation hands its drawing to the page (`lectio.animate(draw, {duration})`): the page
 * owns play, pause, step and the scrubber, and shows the caption for each step, so every
 * animation is paced by the learner the same way, and `widget check` can draw any moment of it.
 *
 * Pure: strings in, strings out.
 */
import {FIGURE_PALETTE, PAPER} from './palette.ts';

/** The libraries a widget may ask for, by name: served by lectio, pinned in package.json. */
export const WIDGET_LIBS = {
  d3: {file: 'd3/dist/d3.min.js', what: 'd3 7: SVG, data, scales and transitions (global `d3`)'},
  p5: {file: 'p5/lib/p5.min.js', what: 'p5 1.11: canvas sketches and simulations (global mode, `setup`/`draw`)'},
} as const;
export type WidgetLib = keyof typeof WIDGET_LIBS;
export const WIDGET_LIB_NAMES = Object.keys(WIDGET_LIBS) as WidgetLib[];

/** The widget's own route's policy. `origin` is the server's, so only lectio's libraries load. */
export function widgetCsp(origin: string): string {
  return [
    // An opaque origin: no cookie, no same-origin requests, even opened directly in a tab.
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src 'unsafe-inline' ${origin}/w/lib/`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** The palette as CSS variables: `--lectio-<name>` for a stroke or text, `--lectio-<name>-fill` for its fill. */
export function themeCss(): string {
  const vars = FIGURE_PALETTE.flatMap(c => [`--lectio-${c.name}: ${c.hex};`, `--lectio-${c.name}-fill: ${c.fill};`]);
  return `:root { --lectio-paper: ${PAPER}; ${vars.join(' ')} }
html, body { margin: 0; background: var(--lectio-paper); color: var(--lectio-ink); font: 15px/1.4 system-ui, -apple-system, sans-serif; }`;
}

const THEME = Object.fromEntries([['paper', PAPER], ...FIGURE_PALETTE.flatMap(c => [[c.name, c.hex], [`${c.name}_fill`, c.fill]])]);

/**
 * The bridge, injected before the widget's code as `window.lectio`. `checkAt` is set when
 * `widget check` draws a frame: the widget's animation is drawn at that time, once, and errors
 * are written into the page for the check to read back.
 */
export function bridgeScript(lineOffset = 0): string {
  return `(() => {
  'use strict';
  // Lines before the widget's own HTML in this document: an error's line is counted in the widget's.
  const OFFSET = ${lineOffset};
  const params = new URLSearchParams(location.search);
  const checkAt = params.has('t') ? Number(params.get('t')) : null;
  const send = message => { try { parent.postMessage(Object.assign({lectio: 1}, message), '*'); } catch (e) {} };
  const errors = [];
  const report = (message, line, column) => {
    const error = {type: 'error', message: String(message).slice(0, 500), line: line | 0, column: column | 0};
    send(error);
    if (checkAt === null) return;
    errors.push(error);
    const out = document.getElementById('lectio-errors');
    if (out) out.textContent = JSON.stringify(errors);
  };
  const here = location.href.split('?')[0];
  const own = (file, line) => (!file || file.split('?')[0] === here) && line > OFFSET ? line - OFFSET : line;
  addEventListener('error', e => report(e.message, own(e.filename, e.lineno), e.colno));
  addEventListener('unhandledrejection', e => report((e.reason && e.reason.message) || e.reason, 0, 0));
  document.addEventListener('securitypolicyviolation', e => report('blocked by the sandbox: ' + e.violatedDirective + ' ' + (e.blockedURI || ''), own(e.sourceFile, e.lineNumber), e.columnNumber));
  let timeline = null;
  let lastSent = 0;
  const draw = t => { try { timeline.draw(t); } catch (e) { report(e && e.message || e, 0, 0); } };
  const tell = () => send({type: 'time', t: timeline.t, playing: timeline.playing});
  const tick = now => {
    if (!timeline || !timeline.playing) return;
    if (timeline.last !== null) timeline.t += (now - timeline.last) / 1000;
    timeline.last = now;
    if (timeline.t >= timeline.duration) {
      timeline.t = timeline.duration;
      timeline.playing = false;
      draw(timeline.t);
      tell();
      send({type: 'done'});
      return;
    }
    draw(timeline.t);
    if (now - lastSent > 100) { lastSent = now; tell(); }
    requestAnimationFrame(tick);
  };
  const lectio = {
    theme: ${JSON.stringify(THEME)},
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    width: innerWidth,
    checking: checkAt !== null,
    event(name) { send({type: 'event', name: String(name).slice(0, 40)}); },
    done() { send({type: 'done'}); },
    resize(px) { send({type: 'resize', height: Math.round(Number(px)) || 0}); },
    answer(result) { send({type: 'answer', value: result && result.value, score: result && Number(result.score)}); },
    animate(drawAt, options) {
      if (typeof drawAt !== 'function') throw new Error('lectio.animate(draw, {duration}): draw is a function of the time in seconds');
      const duration = Math.max(0.1, Number(options && options.duration) || 0);
      const at = checkAt === null ? 0 : Math.max(0, Math.min(checkAt, duration));
      timeline = {draw: drawAt, duration, t: at, playing: false, last: null};
      draw(at);
      if (checkAt !== null) document.documentElement.dataset.lectioDrawn = String(at);
      send({type: 'timeline', duration});
    },
  };
  addEventListener('message', e => {
    const m = e.data;
    if (e.source !== parent || !m || m.lectio !== 1 || !timeline || checkAt !== null) return;
    if (m.type === 'play') {
      if (timeline.t >= timeline.duration) timeline.t = 0;
      timeline.playing = true;
      timeline.last = null;
      requestAnimationFrame(tick);
    } else if (m.type === 'pause') {
      timeline.playing = false;
      tell();
    } else if (m.type === 'seek' && Number.isFinite(Number(m.t))) {
      timeline.playing = false;
      timeline.t = Math.max(0, Math.min(Number(m.t), timeline.duration));
      draw(timeline.t);
      tell();
    }
  });
  addEventListener('resize', () => { lectio.width = innerWidth; dispatchEvent(new Event('lectio:resize')); });
  window.lectio = lectio;
})();`;
}

/** The document a widget is served as: the theme, the bridge and its libraries, then its own HTML. */
export function wrapWidget(html: string, options: {libs: readonly string[]; check?: boolean}): string {
  const libs = options.libs.filter((lib): lib is WidgetLib => lib in WIDGET_LIBS).map(lib => `<script src="/w/lib/${lib}.js"></script>`);
  const before = (offset: number) =>
    [
      '<!doctype html>',
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
      `<style>${themeCss()}</style>`,
      `<script>${bridgeScript(offset)}</script>`,
      ...libs,
      '</head><body>',
      ...(options.check === true ? ['<pre id="lectio-errors" hidden></pre>'] : []),
    ].join('\n');
  // The offset's digits don't change how many lines there are.
  const offset = before(0).split('\n').length;
  return [before(offset), html, '</body></html>'].join('\n');
}

/**
 * Ways a widget might reach the network, found in its source. The sandbox blocks every one;
 * `widget check` and the lesson's warnings say so before the learner finds a broken widget.
 * XML namespace URIs (`http://www.w3.org/…`) are names, not requests.
 */
export function networkReach(html: string): string[] {
  const found = new Set<string>();
  for (const [pattern, what] of [
    [/\bfetch\s*\(/, 'fetch('],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\bEventSource\b/, 'EventSource'],
    [/\bimport\s*\(/, 'import('],
    [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  ] as const) {
    if (pattern.test(html)) found.add(what);
  }
  for (const m of html.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>)]*/gi)) {
    if (!/^(?:https?:)?\/\/www\.w3\.org\//i.test(m[0])) found.add(m[0].slice(0, 80));
  }
  return [...found];
}

/** What a widget may say to the page; anything else is dropped. */
export type BridgeMessage =
  | {type: 'event'; name: string}
  | {type: 'done'}
  | {type: 'resize'; height: number}
  | {type: 'error'; message: string; line: number; column: number}
  | {type: 'timeline'; duration: number}
  | {type: 'time'; t: number; playing: boolean}
  | {type: 'answer'; value: unknown; score: number};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A message from a widget, if it is one of the bridge's shapes. */
export function readBridgeMessage(data: unknown): BridgeMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const m = data as Record<string, unknown>;
  if (m['lectio'] !== 1) return undefined;
  switch (m['type']) {
    case 'event':
      return typeof m['name'] === 'string' ? {type: 'event', name: m['name'].slice(0, 40)} : undefined;
    case 'done':
      return {type: 'done'};
    case 'resize': {
      const height = num(m['height']);
      return height === undefined ? undefined : {type: 'resize', height};
    }
    case 'error':
      return {type: 'error', message: String(m['message'] ?? '').slice(0, 500), line: num(m['line']) ?? 0, column: num(m['column']) ?? 0};
    case 'timeline': {
      const duration = num(m['duration']);
      return duration === undefined ? undefined : {type: 'timeline', duration};
    }
    case 'time': {
      const t = num(m['t']);
      return t === undefined ? undefined : {type: 'time', t, playing: m['playing'] === true};
    }
    case 'answer': {
      const score = num(m['score']);
      return score === undefined ? undefined : {type: 'answer', value: m['value'], score: Math.max(0, Math.min(1, score))};
    }
    default:
      return undefined;
  }
}
