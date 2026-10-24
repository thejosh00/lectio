#!/usr/bin/env bun
/**
 * The `lectio` command.
 *
 * A few commands run here, against this machine's data directory: `serve` starts the
 * server, `token` issues a token, `login` records where the server is, `backup` copies
 * the database. Everything else is one HTTP call to the server — the CLI is a thin
 * client, which is what lets the tutor in a sandbox use exactly the same commands as you.
 *
 * With `--json`, success and failure both arrive as JSON on stdout and stderr stays
 * empty: `{"ok":false,"error":"…","code":3}`.
 */
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {networkInterfaces, tmpdir} from 'node:os';
import {join} from 'node:path';
import {flagValue, hasFlag, parseArgs, type ParsedArgs} from './core/args.ts';
import {AppError, EXIT_ERROR, EXIT_OK, EXIT_UNAVAILABLE, EXIT_USAGE, describe, failure} from './core/errors.ts';
import {nowIso} from './core/time.ts';
import {callApi, CLIENT_FILE, clientConfig, Unreachable, writeClientToken, type Fetch} from './client.ts';
import {dataDirFrom, DEFAULT_PORT} from './config.ts';
import {COMMANDS, matchCommand} from './commands/index.ts';
import {CommandUsage, type Audience, type CommandDef, type CommandIO} from './commands/types.ts';
import {createToken} from './db/auth.ts';
import {BACKUP_DIR, isLabel, labelledBackup, restoreBackup} from './db/backup.ts';
import {DB_FILE, openDatabase} from './db/database.ts';
import {dbFiles, secureDataDir} from './db/fileModes.ts';
import {getSetting} from './db/settings.ts';
import {VERSION} from './version.ts';

const LOCAL_COMMANDS: Array<[string, string]> = [
  ['serve', 'start the server and the web app  [--host H] [--port N] [--dev]'],
  ['service', 'keep the server running in the background (macOS): install|start|stop|restart|status|logs|uninstall'],
  ['token', 'issue a token for an actor: lectio token you | agent:tutor | agent:builder | agent:examiner'],
  ['login', 'remember the server and a token: lectio login --url … --token … [--default]'],
  ['backup', 'copy the database now: lectio backup [--label …] | lectio backup restore <file> (server stopped)'],
];

const GROUPS: Array<[Audience, string]> = [
  ['learner', 'for you:'],
  ['anyone', 'for anyone:'],
  ['tutor', 'for the tutor (agent:tutor):'],
  ['builder', 'for the builder (agent:builder):'],
  ['examiner', 'for the examiner (agent:examiner):'],
];

export function usage(): string {
  const all: Array<[string, string]> = [...LOCAL_COMMANDS, ...COMMANDS.map(c => [c.name, c.summary] as [string, string])];
  const width = Math.min(22, Math.max(...all.map(([name]) => name.length)));
  const line = ([name, summary]: [string, string]) => `  ${name.padEnd(width)}  ${summary}`;
  const groups = GROUPS.flatMap(([audience, title]) => {
    const commands = COMMANDS.filter(c => c.audience === audience);
    return commands.length === 0 ? [] : ['', title, ...commands.map(c => line([c.name, c.summary]))];
  });
  return [
    'lectio — a tutor that teaches you something every day',
    '',
    'usage: lectio <command> [options] [--json]',
    '',
    'on this machine:',
    ...LOCAL_COMMANDS.map(line),
    ...groups,
    '',
    'options:',
    '  --json         machine-readable output (for agents)',
    '  --as <actor>   which token in client.json to use (agent:tutor, agent:builder, agent:examiner, you)',
    '  --dir <path>   the data directory (or LECTIO_DIR; default ~/.lectio)',
    '  -h, --help     help; "lectio <command> --help" for one command',
    '  -v, --version  the version',
    '',
    'environment: LECTIO_URL, LECTIO_TOKEN (else $LECTIO_DIR/client.json)',
    'Run "lectio agents" for the contract an AI agent should follow.',
  ].join('\n');
}

export interface ServeRequest {
  dbPath: string;
  dataDir: string;
  hostname: string;
  port: number;
  development: boolean;
  out: (line?: string) => void;
}

export interface RunOptions {
  argv: readonly string[];
  out: (line?: string) => void;
  err: (line?: string) => void;
  env?: Record<string, string | undefined>;
  now?: () => string;
  fetch?: Fetch;
  readStdin?: () => Promise<string>;
  /** One line of input at a time, for the interactive quiz. */
  readLine?: (prompt: string) => Promise<string | undefined>;
  shuffle?: <T>(items: readonly T[]) => T[];
  clock?: () => number;
  /** Injected by tests so `serve` does not block. */
  serve?: (request: ServeRequest) => Promise<number>;
}

interface Globals {
  dir: string | undefined;
  as: string | undefined;
  help: boolean;
  version: boolean;
  json: boolean;
  rest: string[];
}

function liftGlobals(argv: readonly string[]): Globals {
  const globals: Globals = {dir: undefined, as: undefined, help: false, version: false, json: false, rest: []};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      globals.rest.push(...argv.slice(i));
      break;
    }
    if (token === '--dir') globals.dir = argv[++i];
    else if (token.startsWith('--dir=')) globals.dir = token.slice(6);
    else if (token === '--as') globals.as = argv[++i];
    else if (token.startsWith('--as=')) globals.as = token.slice(5);
    else if (token === '--help' || token === '-h') globals.help = true;
    else if (token === '--version' || token === '-v') globals.version = true;
    else if (token === '--json') globals.json = true;
    else globals.rest.push(token);
  }
  return globals;
}

const randomShuffle = <T,>(items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/** Lines from the real stdin, a prompt at a time; works for a terminal and a pipe. */
function stdinLines(): (prompt: string) => Promise<string | undefined> {
  // Taken on first use: holding stdin open would lock it for commands that read it whole.
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  return async prompt => {
    reader ??= Bun.stdin.stream().getReader();
    process.stdout.write(prompt);
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        return line;
      }
      if (done) {
        if (buffer === '') return undefined;
        const line = buffer;
        buffer = '';
        return line;
      }
      const chunk = await reader.read();
      if (chunk.done) done = true;
      else buffer += decoder.decode(chunk.value, {stream: true});
    }
  };
}

export async function run(options: RunOptions): Promise<number> {
  const {out, err} = options;
  const env = options.env ?? process.env;
  const now = options.now ?? nowIso;
  const globals = liftGlobals(options.argv);
  const {json} = globals;

  const emitJson = (body: unknown) => out(JSON.stringify(body, null, 2));
  const fail = (message: string, code: number, extra: Record<string, unknown> = {}, hint?: string): number => {
    if (json) emitJson(failure(message, code, hint === undefined ? extra : {...extra, hint}));
    else {
      err(`lectio: ${message}`);
      if (hint !== undefined) err(hint);
      const candidates = extra['candidates'];
      if (Array.isArray(candidates)) for (const c of candidates) err(`  ${String(c)}`);
      const errors = extra['errors'];
      if (Array.isArray(errors) && errors.length > 1) for (const e of errors as Array<{path: string; message: string}>) err(`  ${e.path === '' ? '' : `${e.path}: `}${e.message}`);
    }
    return code;
  };

  if (globals.version) {
    if (json) emitJson({ok: true, version: VERSION});
    else out(VERSION);
    return EXIT_OK;
  }

  const [name, ...rest] = globals.rest;
  if (name === undefined || name === 'help') {
    out(usage());
    return EXIT_OK;
  }

  const dataDir = dataDirFrom(env, globals.dir);

  // --- on this machine ---------------------------------------------------------------

  if (name === 'serve') {
    const args = parseArgs(rest, {boolean: ['dev'], alias: {p: 'port', H: 'host'}});
    const dbPath = join(dataDir, DB_FILE);
    let host = flagValue(args, 'host') ?? env['LECTIO_HOST'];
    if (host === undefined) {
      const db = openDatabase(dbPath);
      host = getSetting(db, 'listen_host') ?? '127.0.0.1';
      db.close();
    }
    const port = Number(flagValue(args, 'port') ?? env['LECTIO_PORT'] ?? DEFAULT_PORT);
    if (!Number.isInteger(port)) return fail('--port must be a number', EXIT_USAGE);
    // Tighten what an older version created world-readable (fileModes.ts).
    secureDataDir({dataDir, files: [...dbFiles(DB_FILE), CLIENT_FILE], dirs: [BACKUP_DIR]});
    return (options.serve ?? serve)({dbPath, dataDir, hostname: host, port, development: args.booleans.has('dev'), out});
  }

  if (name === 'service') {
    const {serviceCommand} = await import('./local/service.ts');
    return serviceCommand({dataDir, out, err}, rest);
  }

  if (name === 'token') {
    const actor = rest[0];
    if (actor === undefined || globals.help) {
      out('usage: lectio token <actor>    e.g. lectio token you, lectio token agent:tutor, lectio token agent:builder');
      return actor === undefined && !globals.help ? EXIT_USAGE : EXIT_OK;
    }
    const db = openDatabase(join(dataDir, DB_FILE));
    try {
      const token = createToken(db, actor, now());
      if (json) emitJson({ok: true, actor, token});
      else out(token);
      return EXIT_OK;
    } catch (error) {
      return error instanceof AppError ? fail(error.message, error.code) : fail(describe(error), EXIT_ERROR);
    } finally {
      db.close();
    }
  }

  if (name === 'login') {
    const args = parseArgs(rest, {boolean: ['default']});
    const url = flagValue(args, 'url') ?? env['LECTIO_URL'];
    const token = flagValue(args, 'token') ?? env['LECTIO_TOKEN'];
    if (url === undefined || token === undefined || globals.help) {
      out(`usage: lectio login --url http://127.0.0.1:${DEFAULT_PORT} --token <token> [--default]`);
      return globals.help ? EXIT_OK : EXIT_USAGE;
    }
    let actor: string;
    try {
      const result = await callApi({url: url.replace(/\/+$/, ''), token}, {method: 'GET', path: '/api/whoami'}, options.fetch);
      if (result.body['ok'] !== true) return fail(`the server did not accept that token: ${String(result.body['error'])}`, EXIT_USAGE);
      actor = String(result.body['actor']);
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      return fail(`cannot reach a lectio server at ${url}: ${error.message}`, EXIT_UNAVAILABLE, {}, 'start it with "lectio serve", then log in again');
    }
    const path = writeClientToken(dataDir, {url, actor, token, makeDefault: hasFlag(args, 'default')});
    if (json) emitJson({ok: true, url, actor, path});
    else out(`logged in to ${url} as ${actor} (saved to ${path})`);
    return EXIT_OK;
  }

  if (name === 'backup') return backupCommand(rest, {dataDir, json, out, emitJson, fail, now, env, fetch: options.fetch});

  // --- against the server ------------------------------------------------------------

  const matched = matchCommand(globals.rest);
  if (matched === undefined) return fail(`unknown command "${name}"; run "lectio --help"`, EXIT_USAGE);
  const {command} = matched;
  if (globals.help) {
    out(command.usage);
    return EXIT_OK;
  }

  const args = parseArgs(matched.rest, {boolean: command.booleans ?? [], alias: command.alias ?? {}});
  const problem = argsProblem(command, args);
  if (problem !== undefined) return fail(`${problem}\nusage: ${command.usage}`, EXIT_USAGE);

  const config = clientConfig(env, dataDir, globals.as);
  if (config.token === undefined && config.missing !== undefined) return fail(config.missing, EXIT_USAGE, {}, 'lectio login --url … --token … adds a token for an actor');
  const io: CommandIO = {
    env,
    readStdin: options.readStdin ?? (() => Bun.stdin.text()),
    readFile: path => Bun.file(path).text(),
    readBytes: path => Bun.file(path).bytes(),
    call: request => callApi(config, request, options.fetch),
    edit: text => editInEditor(text, env),
    readLine: options.readLine ?? stdinLines(),
    out,
    shuffle: options.shuffle ?? randomShuffle,
    clock: options.clock ?? (() => Date.now()),
  };

  if (command.interactive !== undefined) {
    try {
      return await command.interactive(args, io, json);
    } catch (error) {
      if (error instanceof CommandUsage) return fail(error.message, EXIT_USAGE);
      if (error instanceof Unreachable) return fail(`cannot reach the lectio server at ${config.url}`, EXIT_UNAVAILABLE, {}, 'start it with "lectio serve" (or check LECTIO_URL / lectio login)');
      throw error;
    }
  }

  let result;
  try {
    const call = await command.build(args, io);
    result = await callApi(config, call, options.fetch);
  } catch (error) {
    if (error instanceof CommandUsage) return fail(error.message, EXIT_USAGE);
    if (!(error instanceof Unreachable)) throw error;
    return fail(`cannot reach the lectio server at ${config.url}`, EXIT_UNAVAILABLE, {}, 'start it with "lectio serve" (or check LECTIO_URL / lectio login)');
  }

  const {body} = result;
  if (result.status === 401) {
    return fail(
      config.token === undefined ? 'no token: this machine has not been given one' : 'the server did not accept this token',
      EXIT_USAGE,
      {},
      'on the server machine run "lectio token you" (or agent:<name>), then "lectio login --url … --token …"',
    );
  }
  if (body['ok'] !== true) {
    const code = typeof body['code'] === 'number' ? body['code'] : EXIT_ERROR;
    if (json) {
      emitJson(body);
      return code;
    }
    const {ok: _ok, error, code: _code, ...extra} = body;
    return fail(String(error), code, extra);
  }
  if (json) emitJson(body);
  else {
    const text = command.human(body, args);
    for (const line of Array.isArray(text) ? text : [text]) out(line);
  }
  return EXIT_OK;
}

function argsProblem(command: CommandDef, args: ParsedArgs): string | undefined {
  if (args.errors.length > 0) return args.errors[0];
  const allowed = new Set([...(command.values ?? [])]);
  for (const flag of args.flags.keys()) {
    if (!allowed.has(flag)) return `unknown option --${flag} for "${command.name}"`;
  }
  return undefined;
}

interface LocalIO {
  dataDir: string;
  json: boolean;
  out: (line?: string) => void;
  emitJson: (body: unknown) => void;
  fail: (message: string, code: number, extra?: Record<string, unknown>, hint?: string) => number;
  now: () => string;
  env: Record<string, string | undefined>;
  fetch: Fetch | undefined;
}

/** `lectio backup [--label …]` and `lectio backup restore <file>`, on this machine. */
async function backupCommand(argv: readonly string[], io: LocalIO): Promise<number> {
  const args = parseArgs(argv);
  const dbPath = join(io.dataDir, DB_FILE);
  if (args.positional[0] === 'restore') {
    const file = args.positional[1];
    if (file === undefined) return io.fail('usage: lectio backup restore <file>', EXIT_USAGE);
    // The server must be stopped: restoring under a running server would be undone by its next write.
    const config = clientConfig(io.env, io.dataDir);
    try {
      await callApi(config, {method: 'GET', path: '/api/health'}, io.fetch);
      return io.fail(`a lectio server is running at ${config.url}; stop it first (lectio service stop)`, EXIT_ERROR);
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
    }
    try {
      const result = restoreBackup(io.dataDir, file);
      if (io.json) io.emitJson({ok: true, ...result});
      else io.out(`restored ${result.restored}${result.previous === undefined ? '' : `; the database it replaced is at ${result.previous}`}`);
      return EXIT_OK;
    } catch (error) {
      return io.fail(describe(error), EXIT_ERROR);
    }
  }
  const label = flagValue(args, 'label') ?? 'manual';
  if (!isLabel(label)) return io.fail('--label must be lowercase letters, digits, ., - and _', EXIT_USAGE);
  if (!existsSync(dbPath)) return io.fail(`no database at ${dbPath}`, EXIT_ERROR);
  const db = openDatabase(dbPath);
  try {
    const path = labelledBackup(db, io.dataDir, label, io.now());
    if (io.json) io.emitJson({ok: true, path});
    else io.out(`backed up to ${path}`);
    return EXIT_OK;
  } catch (error) {
    return io.fail(describe(error), EXIT_ERROR);
  } finally {
    db.close();
  }
}

async function serve(request: ServeRequest): Promise<number> {
  const {startServer} = await import('./server/server.ts');
  const {startBackground} = await import('./server/background.ts');
  const {noteRunningCommit, sourceRepo} = await import('./local/git.ts');
  const db = openDatabase(request.dbPath);
  const started = nowIso();
  const {commit, shipped} = noteRunningCommit(db, sourceRepo());
  const running = startServer({
    db,
    dataDir: request.dataDir,
    health: () => ({commit: commit ?? null, started}),
    hostname: request.hostname,
    port: request.port,
    development: request.development,
    background: deps => startBackground(deps, {dataDir: request.dataDir, log: line => request.out(line)}),
    log: line => request.out(line),
  });

  request.out(`lectio is serving ${request.dbPath}${commit === undefined ? '' : ` (commit ${commit.slice(0, 12)})`}`);
  for (const p of shipped) request.out(`  shipped #${p.number}: ${p.title}`);
  request.out(`  on this machine:  http://localhost:${running.server.port}`);
  if (request.hostname === '0.0.0.0') {
    for (const address of lanAddresses()) request.out(`  on your network:  http://${address}:${running.server.port}`);
    request.out('  (other devices are refused until the name they use is in allowed_hosts: lectio settings set allowed_hosts <name>)');
  }
  await new Promise<void>(resolve => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
  await running.stop();
  db.close();
  return EXIT_OK;
}

async function editInEditor(text: string, env: Record<string, string | undefined>): Promise<string> {
  const editor = env['VISUAL'] || env['EDITOR'] || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'lectio-edit-'));
  const path = join(dir, 'notes.md');
  writeFileSync(path, text);
  try {
    const proc = Bun.spawn(['sh', '-c', `${editor} "$1"`, 'sh', path], {stdin: 'inherit', stdout: 'inherit', stderr: 'inherit'});
    if ((await proc.exited) !== 0) throw new CommandUsage(`${editor} exited without saving; nothing changed`);
    return readFileSync(path, 'utf8');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
  }
  return found;
}

if (import.meta.main) {
  const code = await run({
    argv: process.argv.slice(2),
    out: line => process.stdout.write(`${line ?? ''}\n`),
    err: line => process.stderr.write(`${line ?? ''}\n`),
  });
  process.exit(code);
}
