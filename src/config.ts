/**
 * Where an instance's data lives.
 *
 * The only module that calls `os.homedir()`. Everything else asks for the data
 * directory, which is what lets tests point the whole app at a temporary directory by
 * setting one environment variable — and lets two instances on one machine differ by
 * nothing more than `LECTIO_DIR` and a port.
 */
import {homedir} from 'node:os';
import {isAbsolute, resolve} from 'node:path';

export const DATA_DIR_ENV = 'LECTIO_DIR';
export const DEFAULT_DIR_NAME = '.lectio';
export const DEFAULT_PORT = 7780;

export interface ResolveOptions {
  flag?: string | undefined;
  env: Record<string, string | undefined>;
  home: string;
  cwd: string;
}

/** `--dir`, then `LECTIO_DIR`, then `~/.lectio`. */
export function resolveDataDir(options: ResolveOptions): string {
  const {flag, env, home, cwd} = options;
  const chosen = [flag, env[DATA_DIR_ENV]].find(v => v !== undefined && v.trim() !== '')?.trim();
  if (chosen === undefined) return resolve(home, DEFAULT_DIR_NAME);
  const expanded = chosen === '~' ? home : chosen.startsWith('~/') ? resolve(home, chosen.slice(2)) : chosen;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export function dataDirFrom(env: Record<string, string | undefined>, flag?: string): string {
  return resolveDataDir({flag, env, home: homedir(), cwd: process.cwd()});
}
