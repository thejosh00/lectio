/**
 * A whole lectio instance for a test: a temporary data directory, a real server on a
 * free port, and the real CLI run in-process against it over HTTP.
 *
 * The clock is the test's: `clock.now` is what the server and CLI think the time is, and
 * `advance` moves it, so a test can live through several days in a second.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
import {run} from '../../src/cli.ts';
import {createToken} from '../../src/db/auth.ts';
import {Ctx} from '../../src/db/context.ts';
import {DB_FILE, openDatabase} from '../../src/db/database.ts';
import {setSetting} from '../../src/db/settings.ts';
import {startServer, type RunningServer} from '../../src/server/server.ts';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout parsed, when it is JSON. */
  json: any;
}

export interface CliOptions {
  as?: string;
  stdin?: string;
  env?: Record<string, string>;
  /** Lines typed at the interactive quiz, in order. */
  lines?: string[];
}

export interface Instance {
  dir: string;
  db: Database;
  server: RunningServer;
  url: string;
  tokens: Record<string, string>;
  clock: {now: string};
  /** Move the clock: `advance({days: 1})`, `advance({hours: 3})`. */
  advance(by: {days?: number; hours?: number; minutes?: number}): void;
  /** What the server logged, one entry per line. */
  log: string[];
  /** Run `lectio …`; `as` picks the actor's token (default `you`). */
  cli(args: string[], options?: CliOptions): Promise<CliResult>;
  /** `cli` with `--json` added. */
  j(args: string[], options?: CliOptions): Promise<CliResult>;
  /** Write a file into the instance's scratch space and return its path. */
  file(name: string, content: unknown): string;
  ctx(actor?: string): Ctx;
  token(actor: string): string;
  stop(): Promise<void>;
}

/** 10:00 in Chicago on a Saturday: past the ready hour. */
export const T0 = '2026-09-12T15:00:00Z';

export async function startInstance(options: {now?: string; settings?: Record<string, string>} = {}): Promise<Instance> {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-test-'));
  const db = openDatabase(join(dir, DB_FILE));
  for (const [key, value] of Object.entries(options.settings ?? {})) setSetting(db, key, value);
  const clock = {now: options.now ?? T0};
  const log: string[] = [];
  const server = startServer({db, dataDir: dir, port: 0, hostname: '127.0.0.1', now: () => clock.now, log: line => log.push(line)});
  const tokens: Record<string, string> = {};
  const token = (actor: string) => (tokens[actor] ??= createToken(db, actor, clock.now));
  token('you');
  token('agent:tutor');
  token('agent:builder');

  const cli: Instance['cli'] = async (args, opts = {}) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const lines = [...(opts.lines ?? [])];
    const code = await run({
      argv: args,
      out: line => stdout.push(line ?? ''),
      err: line => stderr.push(line ?? ''),
      env: {LECTIO_DIR: dir, LECTIO_URL: server.url, LECTIO_TOKEN: token(opts.as ?? 'you'), ...opts.env},
      now: () => clock.now,
      readStdin: async () => opts.stdin ?? '',
      readLine: async prompt => {
        const line = lines.shift();
        stdout.push(`${prompt}${line ?? ''}`);
        return line;
      },
      shuffle: items => [...items],
      clock: () => 5000,
    });
    const text = stdout.join('\n');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return {code, stdout: text, stderr: stderr.join('\n'), json: parsed};
  };

  let files = 0;
  return {
    dir,
    db,
    server,
    url: server.url,
    tokens,
    clock,
    advance(by) {
      const ms = ((by.days ?? 0) * 24 * 60 + (by.hours ?? 0) * 60 + (by.minutes ?? 0)) * 60_000;
      clock.now = new Date(new Date(clock.now).getTime() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    },
    log,
    cli,
    j: (args, opts) => cli([...args, '--json'], opts),
    file(name, content) {
      const path = join(dir, `${++files}-${name}`);
      writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
      return path;
    },
    ctx: (actor = 'you') => new Ctx(server.deps, actor),
    token,
    async stop() {
      await server.stop();
      db.close();
      rmSync(dir, {recursive: true, force: true});
    },
  };
}
