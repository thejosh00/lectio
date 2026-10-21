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
import {EventHub, eventsSince, latestEventSeq} from '../db/events.ts';
import {handleApi} from './api.ts';
import {staticRoutes} from './static.ts';
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

function eventStream(db: Database, hub: EventHub, request: Request): Response {
  const encoder = new TextEncoder();
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
        for (const event of eventsSince(db, lastSeen)) send(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
      }
      const unsubscribe = hub.subscribe(event => send(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`));
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

  const server = Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? '127.0.0.1',
    development: options.development ?? false,
    routes: {
      '/': homepage,
      ...staticRoutes,
      ...options.routes,
      // Unauthenticated, so a ship can wait for the new commit to come up.
      '/api/health': () => json({ok: true, version: VERSION, ...options.health?.()}),
      '/api/session': {
        GET: request => {
          const caller = callerOf(db, request);
          return caller === undefined ? unauthorized() : json({ok: true, actor: caller.actor});
        },
        POST: request => signIn(db, request, now),
        DELETE: request => {
          const session = cookie(request, SESSION_COOKIE);
          if (session !== undefined) endSession(db, session);
          return json({ok: true}, 200, {'set-cookie': sessionCookie('', 0)});
        },
      },
      '/api/events': request => {
        if (callerOf(db, request) === undefined) return unauthorized();
        server.timeout(request, 0);
        return eventStream(db, hub, request);
      },
      '/api/*': async request => {
        const caller = callerOf(db, request);
        if (caller === undefined) return unauthorized();
        const url = new URL(request.url);
        const response = await handleApi(new Ctx(deps, caller.actor), request, url, options.log);
        return response ?? errorResponse(new AppError(`no such endpoint: ${request.method} ${url.pathname}`, EXIT_NOT_FOUND));
      },
    },
    fetch() {
      return new Response('Not found', {status: 404});
    },
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
