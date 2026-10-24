/**
 * The HTTP API. Every CLI command is one of these endpoints; the web app uses the same.
 *
 * Handlers are thin: they read the request, call into `src/db/`, and return the fields
 * of the success envelope. Anything thrown as an `AppError` becomes the failure
 * envelope with its exit code. Who may call what is decided here, in one place, from
 * each route's `allow` — never by a handler remembering to check.
 */
import {AppError, EXIT_ERROR, describe, refused} from '../core/errors.ts';
import {DEFAULT_READERS} from '../core/permissions.ts';
import type {Ctx} from '../db/context.ts';
import {contractDocument, contractVersion} from '../db/contract.ts';
import {VERSION} from '../version.ts';
import {compile, errorResponse, json, readBody, whose, type CompiledRoute, type Route} from './http.ts';
import {assetRoutes} from './routes/assets.ts';
import {attemptRoutes} from './routes/attempts.ts';
import {examRoutes} from './routes/exams.ts';
import {experimentRoutes} from './routes/experiments.ts';
import {feedbackRoutes} from './routes/feedback.ts';
import {lessonRoutes} from './routes/lessons.ts';
import {noteRoutes} from './routes/notes.ts';
import {playbookRoutes} from './routes/playbook.ts';
import {proposalRoutes} from './routes/proposals.ts';
import {questionRoutes} from './routes/questions.ts';
import {quizRoutes} from './routes/quizzes.ts';
import {settingsRoutes} from './routes/settings.ts';
import {subjectRoutes} from './routes/subjects.ts';
import {tutorRoutes} from './routes/tutor.ts';

const ROUTES: Route[] = [
  {method: 'GET', path: '/api/whoami', readers: ['learner', 'tutor', 'builder', 'examiner'], handler: ctx => ({actor: ctx.actor, role: ctx.role, version: VERSION, today: ctx.today(), timezone: ctx.timeZone})},
  {method: 'GET', path: '/api/agents', readers: ['learner', 'tutor', 'builder', 'examiner'], handler: ctx => ({document: contractDocument(ctx), contract_version: contractVersion(ctx)})},
  ...subjectRoutes,
  ...lessonRoutes,
  ...quizRoutes,
  ...attemptRoutes,
  ...feedbackRoutes,
  ...questionRoutes,
  ...noteRoutes,
  ...playbookRoutes,
  ...assetRoutes,
  ...proposalRoutes,
  ...tutorRoutes,
  ...examRoutes,
  ...experimentRoutes,
  ...settingsRoutes,
];

const COMPILED: CompiledRoute[] = ROUTES.map(compile);

export function allRoutes(): readonly CompiledRoute[] {
  return COMPILED;
}

/**
 * `log` gets one line per failed request, so an error the web app only flashes on screen
 * can be read back later from the server's output (`lectio service logs`).
 */
export async function handleApi(ctx: Ctx, request: Request, url: URL, log: (line: string) => void = () => {}): Promise<Response | undefined> {
  let pathMatched = false;
  for (const route of COMPILED) {
    const match = route.regex.exec(url.pathname);
    if (match === null) continue;
    pathMatched = true;
    if (route.method !== request.method) continue;

    const params: Record<string, string> = {};
    route.names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]!);
    });
    try {
      if (route.method !== 'GET' && (route.allow === undefined || !route.allow.includes(ctx.role))) {
        throw refused(capitalise(route.what ?? `${route.method} ${route.path}`), route.allow === undefined ? 'nobody\'s' : whose(route.allow));
      }
      const readers = route.readers ?? DEFAULT_READERS;
      if (route.method === 'GET' && !readers.includes(ctx.role)) throw refused(`Reading ${route.path}`, whose(readers));
      const body = await readBody(request);
      const result = await route.handler(ctx, {params, query: url.searchParams, body, request});
      return json({ok: true, ...result});
    } catch (error) {
      const failed = error instanceof AppError ? error : new AppError(`internal error: ${describe(error)}`, EXIT_ERROR, {}, 500);
      const response = errorResponse(failed);
      log(`${ctx.now()} ${request.method} ${url.pathname} ${response.status} (${ctx.actor}): ${failed.message}`);
      if (!(error instanceof AppError) && error instanceof Error && error.stack !== undefined) log(error.stack);
      return response;
    }
  }
  if (pathMatched) return errorResponse(new AppError(`${request.method} is not supported on ${url.pathname}`, 2, {}, 405));
  return undefined;
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
