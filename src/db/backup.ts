/**
 * Backups: daily, and labelled ones taken before something risky (a ship).
 *
 * The database is one file, so a copy of it is the way back from a bad day. Whenever the
 * server runs it checks whether today's backup exists (a laptop asleep at 3am would skip
 * a fixed-time job), and keeps the last fortnight. Uploaded assets are immutable and
 * content-addressed, so each backup only copies the ones not copied before.
 *
 * `VACUUM INTO` writes a consistent snapshot even while others write; the copy is only
 * renamed into place after it passes an integrity check.
 */
import {chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync} from 'node:fs';
import {basename, join} from 'node:path';
import {Database} from 'bun:sqlite';
import {localDate} from '../core/time.ts';
import {DB_FILE} from './database.ts';
import {PRIVATE_DIR, PRIVATE_FILE, dbFiles, tighten} from './fileModes.ts';

export const BACKUP_DIR = 'backups';
export const ASSETS_DIR = 'assets';
export const KEEP_DAILY = 14;
const DAILY = /^lectio-(\d{4}-\d{2}-\d{2})\.db$/;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,47}$/;

export const dailyName = (at: Date, timeZone: string) => `lectio-${localDate(at, timeZone)}.db`;
export const backupDir = (dataDir: string) => join(dataDir, BACKUP_DIR);

export const isLabel = (label: string) => LABEL.test(label);

/** `lectio-label-pre-p12-20260912T150000.db`: labelled, and never pruned. */
export function labelledName(label: string, at: string): string {
  return `lectio-label-${label}-${at.replace(/[-:]/g, '').replace(/Z$/, '')}.db`;
}

/** Daily backups beyond the newest `keep`, oldest first. */
export function toPrune(names: readonly string[], keep: number): string[] {
  const daily = names.filter(name => DAILY.test(name)).sort();
  return daily.slice(0, Math.max(0, daily.length - keep));
}

function checkCopy(path: string): void {
  const copy = new Database(path, {readonly: true});
  try {
    const result = copy.query('PRAGMA quick_check').get() as {quick_check: string} | null;
    if (result?.quick_check !== 'ok') throw new Error(`the copy failed its check: ${result?.quick_check ?? 'no answer'}`);
  } finally {
    copy.close();
  }
}

/** Copy assets the backup doesn't have yet. They never change, so a name match is enough. */
export function copyNewAssets(dataDir: string): number {
  const from = join(dataDir, ASSETS_DIR);
  if (!existsSync(from)) return 0;
  const to = join(backupDir(dataDir), ASSETS_DIR);
  mkdirSync(to, {recursive: true, mode: PRIVATE_DIR});
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (name.startsWith('.') || existsSync(join(to, name))) continue;
    copyFileSync(join(from, name), join(to, name));
    chmodSync(join(to, name), PRIVATE_FILE);
    copied++;
  }
  return copied;
}

export function takeBackup(db: Database, dir: string, name: string): string {
  mkdirSync(dir, {recursive: true, mode: PRIVATE_DIR});
  const target = join(dir, name);
  const temp = join(dir, `.${name}.partial`);
  if (existsSync(temp)) unlinkSync(temp);
  try {
    db.query('VACUUM INTO ?').run(temp);
    chmodSync(temp, PRIVATE_FILE);
    checkCopy(temp);
    renameSync(temp, target);
    return target;
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

/** Take today's backup if there is none yet, and prune. The new path, or undefined. */
export function dailyBackup(db: Database, dataDir: string, now: Date, timeZone: string, keep = KEEP_DAILY): string | undefined {
  const dir = backupDir(dataDir);
  const name = dailyName(now, timeZone);
  if (existsSync(join(dir, name))) return undefined;
  const path = takeBackup(db, dir, name);
  copyNewAssets(dataDir);
  for (const old of toPrune(readdirSync(dir), keep)) unlinkSync(join(dir, old));
  return path;
}

/** A backup on demand, named by its label and the moment. */
export function labelledBackup(db: Database, dataDir: string, label: string, at: string): string {
  const path = takeBackup(db, backupDir(dataDir), labelledName(label, at));
  copyNewAssets(dataDir);
  return path;
}

export function latestBackup(dataDir: string): {name: string; modified: Date} | undefined {
  const dir = backupDir(dataDir);
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir).filter(n => DAILY.test(n) || n.startsWith('lectio-label-'));
  const sorted = names.map(name => ({name, modified: statSync(join(dir, name)).mtime})).sort((a, b) => a.modified.getTime() - b.modified.getTime());
  return sorted.at(-1);
}

/**
 * Put a backup back as the instance's database. The server must be stopped: the caller
 * checks. The current file is kept beside it as `lectio.db.before-restore`, and any
 * asset the backup knows that the instance has lost is copied back.
 */
export function restoreBackup(dataDir: string, file: string): {restored: string; previous: string | undefined} {
  const source = existsSync(file) ? file : join(backupDir(dataDir), basename(file));
  if (!existsSync(source)) throw new Error(`no backup at ${file}`);
  checkCopy(source);
  const target = join(dataDir, DB_FILE);
  const previous = existsSync(target) ? `${target}.before-restore` : undefined;
  if (previous !== undefined) copyFileSync(target, previous);
  for (const suffix of ['-wal', '-shm']) if (existsSync(target + suffix)) unlinkSync(target + suffix);
  const temp = `${target}.restoring`;
  copyFileSync(source, temp);
  chmodSync(temp, PRIVATE_FILE);
  renameSync(temp, target);
  if (previous !== undefined) tighten(previous, PRIVATE_FILE);
  for (const file of dbFiles(target)) tighten(file, PRIVATE_FILE);
  const savedAssets = join(backupDir(dataDir), ASSETS_DIR);
  if (existsSync(savedAssets)) {
    const assets = join(dataDir, ASSETS_DIR);
    mkdirSync(assets, {recursive: true});
    for (const name of readdirSync(savedAssets)) if (!existsSync(join(assets, name))) copyFileSync(join(savedAssets, name), join(assets, name));
  }
  return {restored: source, previous};
}
