/**
 * `lectio serve`: the one process that owns the database.
 *
 * It serves the web app, the JSON API the CLI and the tutor use, and a stream of changes
 * so an open browser shows a lesson the tutor submits without a reload.
 */
import type {Database} from 'bun:sqlite';
import type {Server} from 'bun';
import {AppError, EXIT_NOT_FOUND, EXIT_USAGE} from '../core/errors.ts';
import {nowIso} from '../core/time.ts';
import {callerForSession, callerForToken, createSession, endSession, type Caller} from '../db/auth.ts';
import {Ctx, type AppDeps} from '../db/context.ts';
import {EventHub, eventsSince, isExamEvent, latestEventSeq, type StoredEvent} from '../db/events.ts';
import {seesExams, roleOf} from '../core/permissions.ts';
import {assetFile} from '../db/assets.ts';
import {getSetting} from '../db/settings.ts';
import {handleApi} from './api.ts';
import {checkRequest, parseAllowedHosts} from './hostCheck.ts';
import {staticRoutes} from './static.ts';
import {serveWidget, serveWidgetLib} from './widgets.ts';
import {errorResponse, json, readBody} from './http.ts';
import {DEFAULT_PORT} from '../config.ts';
import {VERSION} from '../version.ts';
import homepage from '../web/index.html';

export const SESSION_COOKIE = 'lectio_session';
const KEEPALIVE_MS = 20_000;

export interface ServeOptions {
  db: Database;
  port?: number;
  hostname?: string;
  now?: () => string;
  /** The instance's data directory, for assets and backups. */
  dataDir?: string;
  development?: boolean;
  /** Extra routes outside `/api` (the widget sandbox, assets). */
  routes?: Record<string, (request: Request) => Response | Promise<Response>>;
  /** More for `/api/health` to report: the commit the server runs. */
  health?: () => Record<string, unknown>;
  /** Background work (backups). Off in tests, which drive it themselves. */
  background?: (deps: AppDeps) => () => void;
  /** Where failed API requests are reported. Off unless given. */
  log?: (line: string) => void;
}

export interface RunningServer {
  server: Server<undefined>;
  hub: EventHub;
  deps: AppDeps;
  url: string;
  stop(): Promise<void>;
}

function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function callerOf(db: Database, request: Request): Caller | undefined {
  const auth = request.headers.get('authorization');
  if (auth !== null) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    return match === null ? undefined : callerForToken(db, match[1]!.trim());
  }
  const session = cookie(request, SESSION_COOKIE);
  return session === undefined ? undefined : callerForSession(db, session);
}

const unauthorized = () =>
  errorResponse(new AppError('not signed in: send "Authorization: Bearer <token>" (see "lectio token"), or sign in from a browser', EXIT_USAGE, {}, 401));

/**
 * An asset's bytes, for an `<img>` in the web app (which sends the session cookie). The type is
 * the one sniffed when it was stored, the browser may not guess another, and the CSP keeps an
 * SVG opened on its own from running anything. Content-addressed, so it can be cached forever.
 */
function serveAsset(deps: AppDeps, request: Request): Response {
  const caller = callerOf(deps.db, request);
  if (caller === undefined) return unauthorized();
  try {
    const {asset, path} = assetFile(new Ctx(deps, caller.actor), decodeURIComponent(new URL(request.url).pathname.slice('/assets/'.length)));
    return new Response(Bun.file(path), {
      headers: {
        'content-type': asset.mime,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return errorResponse(error instanceof AppError ? error : new AppError(String(error), EXIT_NOT_FOUND, {}, 404));
  }
}

const sessionCookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** A browser signs in once with a `you` token and keeps a session cookie. */
async function signIn(db: Database, request: Request, now: () => string): Promise<Response> {
  let token: unknown;
  try {
    token = (await readBody(request))['token'];
  } catch (error) {
    return errorResponse(error as AppError);
  }
  const caller = typeof token === 'string' ? callerForToken(db, token.trim()) : undefined;
  if (caller === undefined) return errorResponse(new AppError('that token is not known here', EXIT_NOT_FOUND, {}, 403));
  if (caller.actor !== 'you') return errorResponse(new AppError('the web app is for you; sign in with a "you" token, not an agent token', EXIT_USAGE, {}, 403));
  const session = createSession(db, now());
  return json({ok: true, actor: 'you'}, 200, {'set-cookie': sessionCookie(session, 60 * 60 * 24 * 365)});
}

function eventStream(db: Database, hub: EventHub, request: Request, caller: Caller): Response {
  const encoder = new TextEncoder();
  // The tutor and the builder never hear about a checkup (M12).
  const hidden = seesExams(roleOf(caller.actor)) ? () => false : (event: StoredEvent) => isExamEvent(db, event);
  const lastSeen = Number(request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('since') ?? NaN);
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      send(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({seq: latestEventSeq(db)})}\n\n`);
      if (Number.isInteger(lastSeen)) {
        for (const event of eventsSince(db, lastSeen)) if (!hidden(event)) send(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
      }
      const unsubscribe = hub.subscribe(event => {
        if (!hidden(event)) send(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
      cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
      };
      request.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'}});
}

export function startServer(options: ServeOptions): RunningServer {
  const {db} = options;
  const now = options.now ?? nowIso;
  const hub = new EventHub();
  const deps: AppDeps = {db, hub, now, ...(options.dataDir === undefined ? {} : {dataDir: options.dataDir})};

  // Every request is checked before it is routed (see hostCheck.ts). allowed_hosts is
  // read per request, so `lectio settings set allowed_hosts …` applies at once. The web
  // app bundle at "/" and the packaged fonts, KaTeX and mermaid files are served by Bun
  // directly and carry no data.
  const guard =
    (handler: (request: Request) => Response | Promise<Response>) =>
    (request: Request): Response | Promise<Response> => {
      const refused = checkRequest(request, server.port ?? 0, parseAllowedHosts(getSetting(db, 'allowed_hosts')));
      return refused === undefined ? handler(request) : errorResponse(new AppError(refused, EXIT_USAGE, {}, 403));
    };
  const extraRoutes = Object.fromEntries(Object.entries(options.routes ?? {}).map(([path, handler]) => [path, guard(handler)]));

  const server = Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? '127.0.0.1',
    development: options.development ?? false,
    routes: {
      '/': homepage,
      ...staticRoutes,
      ...extraRoutes,
      // Unauthenticated, so a ship can wait for the new commit to come up.
      '/api/health': guard(() => json({ok: true, version: VERSION, ...options.health?.()})),
      '/api/session': {
        GET: guard(request => {
          const caller = callerOf(db, request);
          return caller === undefined ? unauthorized() : json({ok: true, actor: caller.actor});
        }),
        POST: guard(request => signIn(db, request, now)),
        DELETE: guard(request => {
          const session = cookie(request, SESSION_COOKIE);
          if (session !== undefined) endSession(db, session);
          return json({ok: true}, 200, {'set-cookie': sessionCookie('', 0)});
        }),
      },
      '/assets/:id': guard(request => serveAsset(deps, request)),
      '/w/lib/:name': guard(request => serveWidgetLib(request)),
      '/w/:id': guard(request => {
        const caller = callerOf(db, request);
        return caller === undefined ? unauthorized() : serveWidget(new Ctx(deps, caller.actor), request);
      }),
      '/api/events': guard(request => {
        const caller = callerOf(db, request);
        if (caller === undefined) return unauthorized();
        server.timeout(request, 0);
        return eventStream(db, hub, request, caller);
      }),
      '/api/*': guard(async request => {
        const caller = callerOf(db, request);
        if (caller === undefined) return unauthorized();
        const url = new URL(request.url);
        const response = await handleApi(new Ctx(deps, caller.actor), request, url, options.log);
        return response ?? errorResponse(new AppError(`no such endpoint: ${request.method} ${url.pathname}`, EXIT_NOT_FOUND));
      }),
    },
    fetch: guard(() => new Response('Not found', {status: 404})),
  });

  const stopBackground = options.background?.(deps);

  return {
    server,
    hub,
    deps,
    url: server.url.toString().replace(/\/$/, ''),
    async stop() {
      stopBackground?.();
      await server.stop(true);
    },
  };
}
