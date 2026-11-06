#!/usr/bin/env bun
/**
 * `bun run check:migrations`: run this checkout's migrations on a copy of your newest backup, and
 * see that nothing was lost and the app still answers. Your data directory is only ever read, and
 * this prints counts and table names, never content. Exits non-zero on any problem.
 */
import {Database} from 'bun:sqlite';
import {homedir} from 'node:os';
import {basename, join} from 'node:path';
import {DB_FILE, SCHEMA_VERSION} from '../src/db/database.ts';
import {copyNewestBackup, rowCounts, serve} from '../tests/browser/real-copy.ts';

const dataDir = process.env['LECTIO_DIR'] ?? join(homedir(), '.lectio');
const {dir, source} = copyNewestBackup(dataDir);
const problems: string[] = [];

const before = new Database(join(dir, DB_FILE), {readonly: true});
const fromVersion = (before.query('PRAGMA user_version').get() as {user_version: number}).user_version;
const counted = rowCounts(before);
before.close();

const app = serve(dir);
const version = (app.db.query('PRAGMA user_version').get() as {user_version: number}).user_version;
if (version !== SCHEMA_VERSION) problems.push(`at version ${version}, wanted ${SCHEMA_VERSION}`);
const integrity = (app.db.query('PRAGMA integrity_check').get() as {integrity_check: string}).integrity_check;
if (integrity !== 'ok') problems.push(`integrity check: ${integrity}`);
const orphans = app.db.query('PRAGMA foreign_key_check').all();
if (orphans.length > 0) problems.push(`${orphans.length} rows break a foreign key`);
const after = rowCounts(app.db);
for (const [table, n] of Object.entries(counted)) {
  if (after[table] === undefined) problems.push(`table ${table} (${n} rows) is gone`);
  else if (after[table]! < n) problems.push(`table ${table} went from ${n} rows to ${after[table]}`);
}
for (const path of ['/api/today', '/api/subjects', '/api/progress', '/api/questions?status=all', '/api/proposals']) {
  const response = await fetch(`${app.url}${path}`, {headers: {authorization: `Bearer ${app.token}`}});
  if (!response.ok) problems.push(`${path} answered ${response.status}`);
}
await app.stop();

const rows = Object.values(counted).reduce((sum, n) => sum + n, 0);
console.log(`${basename(source)}: version ${fromVersion} → ${version}, ${Object.keys(counted).length} tables, ${rows} rows`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`problem: ${problem}`);
  process.exit(1);
}
console.log('nothing lost, integrity ok, the app answers');
process.exit(0);
