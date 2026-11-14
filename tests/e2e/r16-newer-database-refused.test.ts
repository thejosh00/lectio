/**
 * R16: a database written by a newer lectio (an older build started on it after a bad
 * landing) is refused, unchanged, with exit 4; one exactly at this build's version opens.
 */
import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from '../../src/cli.ts';
import {EXIT_UNAVAILABLE} from '../../src/core/errors.ts';
import {BACKUP_DIR} from '../../src/db/backup.ts';
import {DB_FILE, SCHEMA_VERSION, openDatabase} from '../../src/db/database.ts';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lectio-r16-'));
  path = join(dir, DB_FILE);
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

const versionOf = (file: string) => {
  const db = new Database(file, {readonly: true});
  try {
    return (db.query('PRAGMA user_version').get() as {user_version: number}).user_version;
  } finally {
    db.close();
  }
};

/** A database file as a build `ahead` versions newer left it, closed (no -wal beside it). */
function newerDatabase(ahead = 1): Buffer {
  const db = openDatabase(path);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + ahead}`);
  db.close();
  return readFileSync(path);
}

test('a database one version newer than this build is refused, byte-for-byte unchanged, naming both versions and the backup folder', () => {
  const before = newerDatabase();

  let message = '';
  try {
    openDatabase(path).close();
  } catch (error) {
    message = (error as Error).message;
  }

  expect(message).toContain(`schema version ${SCHEMA_VERSION + 1}`);
  expect(message).toContain(`up to version ${SCHEMA_VERSION}`);
  expect(message).toContain(join(dir, BACKUP_DIR));
  expect(readFileSync(path).equals(before)).toBe(true);
  expect(versionOf(path)).toBe(SCHEMA_VERSION + 1);
  expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
});

test('a newer database with un-checkpointed -wal frames is refused, the main file and the -wal both byte-for-byte unchanged', () => {
  // As a newer lectio left it when it was killed: its last writes, the version among them,
  // are still in the -wal. Copied while that connection is open, so nothing is checkpointed.
  const copy = join(dir, 'crashed', DB_FILE);
  mkdirSync(join(dir, 'crashed'));
  const newer = openDatabase(path);
  newer.exec('PRAGMA wal_autocheckpoint = 0');
  newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  newer.query("INSERT INTO settings (key, value) VALUES ('r16-in-the-wal', 'yes')").run();
  copyFileSync(path, copy);
  copyFileSync(`${path}-wal`, `${copy}-wal`);
  newer.close();
  const before = {db: readFileSync(copy), wal: readFileSync(`${copy}-wal`)};
  expect(before.wal.length).toBeGreaterThan(0);

  expect(() => openDatabase(copy)).toThrow(`schema version ${SCHEMA_VERSION + 1}`);

  expect(readFileSync(copy).equals(before.db)).toBe(true);
  expect(existsSync(`${copy}-wal`)).toBe(true);
  expect(readFileSync(`${copy}-wal`).equals(before.wal)).toBe(true);
});

test('the CLI and lectio serve refuse a newer database with exit 4, and the envelope with --json', async () => {
  const before = newerDatabase();
  const cli = async (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run({argv, out: l => out.push(l ?? ''), err: l => err.push(l ?? ''), env: {LECTIO_DIR: dir}});
    return {code, out: out.join('\n'), err: err.join('\n')};
  };

  const token = await cli(['token', 'you']);
  expect(token.code).toBe(EXIT_UNAVAILABLE);
  expect(token.code).toBe(4);
  expect(token.out).toBe('');
  expect(token.err).toContain(`schema version ${SCHEMA_VERSION + 1}`);

  // With no --host, serve opens the database first, to read the saved listen host.
  const serve = await cli(['serve', '--port', '0']);
  expect(serve.code).toBe(EXIT_UNAVAILABLE);
  expect(serve.err).toContain(join(dir, BACKUP_DIR));

  // With one, it opens it only when it starts the server.
  const served = await cli(['serve', '--port', '0', '--host', '127.0.0.1']);
  expect(served.code).toBe(EXIT_UNAVAILABLE);
  expect(served.err).toContain(`schema version ${SCHEMA_VERSION + 1}`);

  const json = await cli(['token', 'you', '--json']);
  expect(json.code).toBe(EXIT_UNAVAILABLE);
  expect(json.err).toBe('');
  expect(JSON.parse(json.out)).toMatchObject({ok: false, code: EXIT_UNAVAILABLE});

  expect(readFileSync(path).equals(before)).toBe(true);
  expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
});

test('a database exactly at this build\'s version opens as before', () => {
  openDatabase(path).close();
  expect(versionOf(path)).toBe(SCHEMA_VERSION);

  const db = openDatabase(path);
  db.query("INSERT INTO settings (key, value) VALUES ('r16-still-writable', 'yes')").run();
  db.close();

  expect(versionOf(path)).toBe(SCHEMA_VERSION);
  expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
});
