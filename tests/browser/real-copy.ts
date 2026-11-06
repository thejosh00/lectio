/**
 * A throwaway copy of your own lectio, from its newest backup: for migrating real data and looking
 * at real lessons before either reaches the real thing. Your data directory is only ever read.
 * What the tutor actually wrote is where a layout really gets tested, and nothing here prints it.
 */
import {Database} from 'bun:sqlite';
import {copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ASSETS_DIR, BACKUP_DIR} from '../../src/db/backup.ts';
import {createToken} from '../../src/db/auth.ts';
import {DB_FILE, openDatabase} from '../../src/db/database.ts';
import {startServer} from '../../src/server/server.ts';

export function newestBackup(dataDir: string): string {
  const dir = join(dataDir, BACKUP_DIR);
  const names = existsSync(dir) ? readdirSync(dir).filter(n => /^lectio-.*\.db$/.test(n)) : [];
  const newest = names.map(n => join(dir, n)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1);
  if (newest === undefined) throw new Error(`no backups in ${dir}: start lectio once, and it takes one`);
  return newest;
}

/** Every table's row count. */
export function rowCounts(db: Database): Record<string, number> {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name: string}>;
  return Object.fromEntries(tables.map(t => [t.name, (db.query(`SELECT count(*) AS n FROM "${t.name}"`).get() as {n: number}).n]));
}

/** Copy the newest backup and its assets somewhere disposable. Not yet opened, so not yet migrated. */
export function copyNewestBackup(dataDir: string): {dir: string; source: string} {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-real-copy-'));
  const source = newestBackup(dataDir);
  copyFileSync(source, join(dir, DB_FILE));
  const assets = join(dataDir, BACKUP_DIR, ASSETS_DIR);
  if (existsSync(assets)) cpSync(assets, join(dir, ASSETS_DIR), {recursive: true});
  return {dir, source};
}

export function serve(dir: string) {
  const db = openDatabase(join(dir, DB_FILE));
  const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const server = startServer({db, dataDir: dir, port: 0, hostname: '127.0.0.1', now, log: () => undefined});
  const token = createToken(db, 'you', now());
  return {
    db,
    url: server.url,
    token,
    async stop() {
      await server.stop();
      db.close();
      rmSync(dir, {recursive: true, force: true});
    },
  };
}

export async function startRealCopy(dataDir: string) {
  const running = serve(copyNewestBackup(dataDir).dir);
  const lessons = (running.db.query("SELECT id FROM lessons WHERE state != 'skipped' ORDER BY day DESC").all() as Array<{id: string}>).map(l => l.id);
  return {...running, lessons};
}
