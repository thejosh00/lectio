/**
 * The small toolkit every API handler uses: routes, request bodies, and responses in
 * the same envelope the CLI prints with `--json`.
 */
import {AppError, EXIT_USAGE, failure, httpStatusFor, usageError} from '../core/errors.ts';
import type {Role} from '../core/permissions.ts';
export {whose} from '../core/permissions.ts';
import type {Ctx} from '../db/context.ts';

export interface ApiRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  request: Request;
}

export type Handler = (ctx: Ctx, req: ApiRequest) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: Handler;
  /**
   * Who may call it. Every write names its roles; reads leave it out, because everyone —
   * the builder included — may read everything.
   */
  allow?: readonly Role[];
  /** What it does, for the refusal message: "finishing lessons". */
  what?: string;
}

export interface CompiledRoute extends Route {
  regex: RegExp;
  names: string[];
}

export function compile(route: Route): CompiledRoute {
  const names: string[] = [];
  const pattern = route.path.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  return {...route, regex: new RegExp(`^${pattern}$`), names};
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', ...headers}});
}

export function errorResponse(error: AppError): Response {
  return json(failure(error.message, error.code, error.extra), httpStatusFor(error));
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'DELETE') return {};
  const text = await request.text();
  if (text.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new AppError('the request body must be a JSON object', EXIT_USAGE);
}

// --- fields ------------------------------------------------------------------------

export function str(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw usageError(`"${key}" must be a string`);
  return value;
}

export function requireStr(body: Record<string, unknown>, key: string, what = key): string {
  const value = str(body, key)?.trim();
  if (value === undefined || value === '') throw usageError(`${what} is required`);
  return value;
}

export function strList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value as string[];
  throw usageError(`"${key}" must be a list of strings`);
}

export function int(body: Record<string, unknown>, key: string, min = 0): number | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min) throw usageError(`"${key}" must be a whole number ≥ ${min}`);
  return n;
}

export function bool(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw usageError(`"${key}" must be true or false`);
}

export function object(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Reported below.
    }
  }
  throw usageError(`"${key}" must be a JSON object`);
}

export function num(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n)) throw usageError(`"${key}" must be a number`);
  return n;
}

/** A query parameter, trimmed; undefined when absent or blank. */
export function q(req: ApiRequest, key: string): string | undefined {
  const value = req.query.get(key)?.trim();
  return value === undefined || value === '' ? undefined : value;
}
