/**
 * Talking to `lectio serve` from the command line.
 *
 * Where the server is and who you are come from `LECTIO_URL` / `LECTIO_TOKEN`, then from
 * `$LECTIO_DIR/client.json` (written by `lectio login`), then defaults. The file matters:
 * the tutor runs unattended under otto, where no shell profile sets the environment.
 *
 * Two agents work on one machine, so the file holds one token per actor. `--as <actor>`
 * picks one; without it the CLI uses the only token, else the one marked default.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DEFAULT_PORT} from './config.ts';

export const CLIENT_FILE = 'client.json';
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

export function readClientFile(dataDir: string): ClientFile {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, CLIENT_FILE), 'utf8')) as Record<string, unknown>;
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
  if (as !== undefined) {
    const token = file.tokens[as];
    return token === undefined ? {url, token: undefined, missing: `no token for ${as} in ${join(dataDir, CLIENT_FILE)}`} : {url, token};
  }
  const fromEnv = env['LECTIO_TOKEN']?.trim();
  if (fromEnv) return {url, token: fromEnv};
  const actors = Object.keys(file.tokens);
  if (actors.length === 1) return {url, token: file.tokens[actors[0]!]};
  if (file.default !== undefined && file.tokens[file.default] !== undefined) return {url, token: file.tokens[file.default]};
  if (actors.length > 1) return {url, token: undefined, missing: `client.json holds tokens for ${actors.join(', ')} and none is the default: pass --as <actor>`};
  return {url, token: undefined};
}

/** Add a token for an actor, keeping the others. The first token becomes the default. */
export function writeClientToken(dataDir: string, input: {url: string; actor: string; token: string; makeDefault: boolean}): string {
  mkdirSync(dataDir, {recursive: true});
  const file = readClientFile(dataDir);
  delete file.tokens['?'];
  file.tokens[input.actor] = input.token;
  const next: ClientFile = {
    url: input.url.replace(/\/+$/, ''),
    tokens: file.tokens,
    ...(input.makeDefault || file.default === undefined || file.tokens[file.default] === undefined ? {default: input.actor} : {default: file.default}),
  };
  const path = join(dataDir, CLIENT_FILE);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, {mode: 0o600});
  return path;
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
