/**
 * Talking to `lectio serve` from the command line.
 *
 * Where the server is and who you are come from `LECTIO_URL` / `LECTIO_TOKEN`, then from
 * `$LECTIO_DIR/client.json` (written by `lectio login`), then defaults. The file matters:
 * the tutor runs unattended under otto, where no shell profile sets the environment.
 *
 * Two agents work on one machine, so the file holds one token per actor. `--as <actor>`
 * picks one; without it the CLI uses the only token, else the one marked default.
 *
 * Custody (R5): the file never holds the learner's `you` token beside an agent's, so an
 * agent can't sign in as you — the browser is the learner's way in. The examiner's token
 * lives in its own file (`examiner.json`), not beside the tutor's, or comes from
 * `LECTIO_TOKEN` in the examiner's own run.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DEFAULT_PORT} from './config.ts';
import {AppError, EXIT_USAGE} from './core/errors.ts';
import {roleOf} from './core/permissions.ts';
import {EXAMINER_ACTOR, isAgent} from './core/types.ts';

export const CLIENT_FILE = 'client.json';
/** The examiner's own token file, apart from the tutor's `client.json`. */
export const EXAMINER_CLIENT_FILE = 'examiner.json';

/** Which file an actor's token is kept in. */
export const clientFileFor = (actor: string): string => (actor === EXAMINER_ACTOR ? EXAMINER_CLIENT_FILE : CLIENT_FILE);
export const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

export interface ClientConfig {
  url: string;
  token: string | undefined;
  /** Why there is no token, when there isn't one. */
  missing?: string;
}

export interface ClientFile {
  url?: string;
  tokens: Record<string, string>;
  default?: string;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function readClientFile(dataDir: string, name: string = CLIENT_FILE): ClientFile {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as Record<string, unknown>;
    const tokens: Record<string, string> = {};
    if (typeof parsed['tokens'] === 'object' && parsed['tokens'] !== null) {
      for (const [actor, token] of Object.entries(parsed['tokens'] as Record<string, unknown>)) if (typeof token === 'string') tokens[actor] = token;
    }
    // A single-token file, as legenda writes: its actor is unknown, so it is the default.
    if (typeof parsed['token'] === 'string' && Object.keys(tokens).length === 0) tokens['?'] = parsed['token'];
    return {
      ...(typeof parsed['url'] === 'string' ? {url: parsed['url']} : {}),
      tokens,
      ...(typeof parsed['default'] === 'string' ? {default: parsed['default']} : {}),
    };
  } catch {
    return {tokens: {}};
  }
}

export function clientConfig(env: Record<string, string | undefined>, dataDir: string, as?: string): ClientConfig {
  const file = readClientFile(dataDir);
  const url = (env['LECTIO_URL']?.trim() || file.url?.trim() || DEFAULT_URL).replace(/\/+$/, '');
  const fromEnv = env['LECTIO_TOKEN']?.trim();
  if (as === EXAMINER_ACTOR) {
    // Its own run's LECTIO_TOKEN first, then its own file; a token left in client.json by an
    // older setup still works (lectio service status warns about it).
    if (fromEnv) return {url, token: fromEnv};
    const own = readClientFile(dataDir, EXAMINER_CLIENT_FILE);
    const token = own.tokens[as] ?? own.tokens['?'] ?? file.tokens[as];
    return token === undefined
      ? {url, token: undefined, missing: `no token for ${as} in ${join(dataDir, EXAMINER_CLIENT_FILE)} and no LECTIO_TOKEN`}
      : {url: (env['LECTIO_URL']?.trim() || own.url?.trim() || file.url?.trim() || DEFAULT_URL).replace(/\/+$/, ''), token};
  }
  if (as !== undefined) {
    const token = file.tokens[as];
    return token === undefined ? {url, token: undefined, missing: `no token for ${as} in ${join(dataDir, CLIENT_FILE)}`} : {url, token};
  }
  if (fromEnv) return {url, token: fromEnv};
  const actors = Object.keys(file.tokens);
  if (actors.length === 1) return {url, token: file.tokens[actors[0]!]};
  if (file.default !== undefined && file.tokens[file.default] !== undefined) return {url, token: file.tokens[file.default]};
  if (actors.length > 1) return {url, token: undefined, missing: `client.json holds tokens for ${actors.join(', ')} and none is the default: pass --as <actor>`};
  return {url, token: undefined};
}

/**
 * Why `actor`'s token may not join a file already holding `actors`' tokens, if it may not:
 * the learner's `you` never shares a file with an agent's (either way round).
 */
export function tokenMixProblem(actors: readonly string[], actor: string): string | undefined {
  const others = actors.filter(a => a !== actor && a !== '?');
  if (actor === 'you') {
    const agents = others.filter(isAgent);
    if (agents.length > 0) return `client.json holds agent tokens (${agents.join(', ')}), so it can't hold yours too: an agent could sign in as you. Use the browser, or LECTIO_TOKEN in your own shell`;
  } else if (isAgent(actor) && others.includes('you')) {
    return `client.json holds your "you" token, so it can't hold ${actor}'s too: an agent could sign in as you. Remove "you" from it first (the browser is your way in)`;
  }
  return undefined;
}

/** Add a token for an actor, keeping the others. The first token becomes the default. Throws AppError if it would mix `you` with an agent. */
export function writeClientToken(dataDir: string, input: {url: string; actor: string; token: string; makeDefault: boolean}): string {
  const name = clientFileFor(input.actor);
  const file = readClientFile(dataDir, name);
  const problem = tokenMixProblem(Object.keys(file.tokens), input.actor);
  if (problem !== undefined) throw new AppError(problem, EXIT_USAGE);
  mkdirSync(dataDir, {recursive: true, mode: 0o700});
  delete file.tokens['?'];
  file.tokens[input.actor] = input.token;
  const next: ClientFile = {
    url: input.url.replace(/\/+$/, ''),
    tokens: file.tokens,
    ...(input.makeDefault || file.default === undefined || file.tokens[file.default] === undefined ? {default: input.actor} : {default: file.default}),
  };
  const path = join(dataDir, name);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, {mode: 0o600});
  return path;
}

/**
 * What is wrong with how the token files are kept (R5), for `lectio service status` and
 * `lectio login`: one file holding both a tutor's and the examiner's token, or `you` beside
 * an agent. Names actors only, never tokens.
 */
export function tokenFileWarnings(dataDir: string): string[] {
  const warnings: string[] = [];
  for (const name of [CLIENT_FILE, EXAMINER_CLIENT_FILE]) {
    const actors = Object.keys(readClientFile(dataDir, name).tokens).filter(a => a !== '?');
    const tutors = actors.filter(a => isAgent(a) && roleOf(a) === 'tutor');
    const path = join(dataDir, name);
    if (tutors.length > 0 && actors.includes(EXAMINER_ACTOR)) {
      warnings.push(`warning: ${path} holds both the tutor's (${tutors.join(', ')}) and the examiner's token, so the tutor can act as its examiner. Move ${EXAMINER_ACTOR} to ${join(dataDir, EXAMINER_CLIENT_FILE)} (lectio login with its token) or its run's LECTIO_TOKEN, and delete it from ${name}`);
    }
    const agents = actors.filter(isAgent);
    if (actors.includes('you') && agents.length > 0) {
      warnings.push(`warning: ${path} holds your "you" token beside agent tokens (${agents.join(', ')}), so an agent can sign in as you. Delete "you" from it; use the browser`);
    }
  }
  return warnings;
}

export class Unreachable extends Error {}

export interface ApiCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

/** Call the server. Throws `Unreachable` if it cannot be reached or does not answer in JSON. */
export async function callApi(config: ClientConfig, call: ApiCall, fetcher: Fetch = fetch): Promise<ApiResult> {
  const url = new URL(`${config.url}${call.path}`);
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {accept: 'application/json'};
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  if (config.token !== undefined) headers['authorization'] = `Bearer ${config.token}`;

  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method: call.method,
      headers,
      ...(call.body === undefined ? {} : {body: JSON.stringify(call.body)}),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : String(error));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Unreachable(`the server at ${config.url} answered ${response.status} without JSON — is that a lectio server?`);
  }
  if (typeof body !== 'object' || body === null || typeof (body as {ok?: unknown}).ok !== 'boolean') {
    throw new Unreachable(`unexpected ${response.status} from the server`);
  }
  return {status: response.status, body: body as Record<string, unknown>};
}
