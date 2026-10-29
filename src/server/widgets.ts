/**
 * Serving widgets (M21). `/w/<block-id>` is a widget's own document, wrapped with the theme,
 * the bridge and its libraries, under a CSP whose `sandbox` gives it an opaque origin: it can't
 * read the session cookie or call `/api`, even opened in a tab of its own, and reaches no
 * network. `/w/lib/<name>.js` is one of the pinned libraries, public code that carries no data.
 */
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {AppError, EXIT_NOT_FOUND} from '../core/errors.ts';
import {widgetCsp, WIDGET_LIBS, wrapWidget, type WidgetLib} from '../core/widget.ts';
import type {Ctx} from '../db/context.ts';
import {getBlock} from '../db/lessons.ts';
import {getQuestion} from '../db/questions.ts';
import {errorResponse} from './http.ts';

/** The headers every widget document is served with. */
export const widgetHeaders = (origin: string) => ({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': widgetCsp(origin),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-cache',
});

export function serveWidget(ctx: Ctx, request: Request): Response {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.slice('/w/'.length));
  const block = getBlock(ctx, id);
  if (block === undefined || block.type !== 'widget') return errorResponse(new AppError(`no widget "${id}"`, EXIT_NOT_FOUND, {}, 404));
  const html = wrapWidget(String(block.body['html'] ?? ''), {libs: Array.isArray(block.body['libs']) ? (block.body['libs'] as string[]) : []});
  return new Response(html, {headers: widgetHeaders(url.origin)});
}

/** A file in the nearest node_modules up from here; null when there is none (a compiled binary). A package's `exports` can hide its browser build from module resolution, so this looks on disk. */
function inNodeModules(file: string): string | null {
  for (let dir = import.meta.dir; ; dir = dirname(dir)) {
    const path = join(dir, 'node_modules', file);
    if (existsSync(path)) return path;
    if (dirname(dir) === dir) return null;
  }
}

/** Where each library's browser build is; undefined in a compiled binary, where widgets that need one break and say so. */
const libPaths = new Map<string, string | null>();
export function widgetLibPath(name: string): string | undefined {
  if (!(name in WIDGET_LIBS)) return undefined;
  if (!libPaths.has(name)) {
    libPaths.set(name, inNodeModules(WIDGET_LIBS[name as WidgetLib].file));
  }
  return libPaths.get(name) ?? undefined;
}

export function serveWidgetLib(request: Request): Response {
  const name = new URL(request.url).pathname.slice('/w/lib/'.length).replace(/\.js$/, '');
  const path = widgetLibPath(name);
  if (path === undefined) return new Response('Not found', {status: 404});
  return new Response(Bun.file(path), {headers: {'content-type': 'text/javascript; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400'}});
}

/** `/w/q/<question-id>`: a widget question's document (M22), in the same sandbox. Never a checkup's to an agent that can't see checkups. */
export function serveWidgetQuestion(ctx: Ctx, request: Request): Response {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.slice('/w/q/'.length));
  const question = getQuestion(ctx, id);
  if (question === undefined || question.type !== 'widget' || (question.status === 'exam' && !ctx.seesExams)) return errorResponse(new AppError(`no widget question "${id}"`, EXIT_NOT_FOUND, {}, 404));
  const html = wrapWidget(String(question.body['html'] ?? ''), {libs: Array.isArray(question.body['libs']) ? (question.body['libs'] as string[]) : []});
  return new Response(html, {headers: widgetHeaders(url.origin)});
}
