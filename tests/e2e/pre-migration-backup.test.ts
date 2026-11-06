/** Migrations only go forward, so the way back is taken before they run on an existing database. */
import {Database} from 'bun:sqlite';
import {expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BACKUP_DIR} from '../../src/db/backup.ts';
import {DB_FILE, SCHEMA_VERSION, migrationsUpTo, openDatabase} from '../../src/db/database.ts';

function olderDatabase(dir: string, version: number) {
  const db = new Database(join(dir, DB_FILE), {create: true});
  for (const migration of migrationsUpTo(version)) db.exec(migration);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

test('an older database is backed up, at its old version, before it is migrated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-premigration-'));
  try {
    const old = SCHEMA_VERSION - 1;
    olderDatabase(dir, old);
    openDatabase(join(dir, DB_FILE)).close();

    const names = readdirSync(join(dir, BACKUP_DIR));
    expect(names).toHaveLength(1);
    expect(names[0]).toStartWith(`lectio-label-pre-migration-v${old}-`);
    const copy = new Database(join(dir, BACKUP_DIR, names[0]!), {readonly: true});
    expect((copy.query('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(old);
    copy.close();
    const now = new Database(join(dir, DB_FILE), {readonly: true});
    expect((now.query('PRAGMA user_version').get() as {user_version: number}).user_version).toBe(SCHEMA_VERSION);
    now.close();
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('nothing is backed up for a new database, or one already current', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-premigration-'));
  try {
    openDatabase(join(dir, DB_FILE)).close();
    openDatabase(join(dir, DB_FILE)).close();
    expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
