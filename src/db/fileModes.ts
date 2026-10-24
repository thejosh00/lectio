/**
 * Keeping an instance's files to the user who owns them.
 *
 * The data directory holds the database (with every token in it), its write-ahead log,
 * the backups and `client.json` (a token). Directories are 0700 and files 0600. New ones
 * are created that way; `secureDataDir` tightens anything an older version left looser,
 * and is safe to run on every start: it never loosens, and touches nothing already tight.
 *
 * Self-contained so omnifactum can copy it as is.
 */
import {chmodSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

export const PRIVATE_DIR = 0o700;
export const PRIVATE_FILE = 0o600;

/** chmod `path` to `mode` if it has any permission bit beyond it. True if it changed. */
export function tighten(path: string, mode: number): boolean {
  if (!existsSync(path)) return false;
  const current = statSync(path).mode & 0o777;
  if ((current & ~mode) === 0) return false;
  chmodSync(path, mode);
  return true;
}

/** The database file and the two SQLite keeps beside it. */
export const dbFiles = (dbPath: string) => [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

export interface DataDirLayout {
  dataDir: string;
  /** Files directly in the data directory: the database and the token file. */
  files: string[];
  /** Directories whose every file and subdirectory is private: the backups. */
  dirs: string[];
}

/** Tighten the data directory, its private files and its backup directories. The paths changed. */
export function secureDataDir(layout: DataDirLayout): string[] {
  const changed: string[] = [];
  const fix = (path: string, mode: number) => {
    if (tighten(path, mode)) changed.push(path);
  };
  fix(layout.dataDir, PRIVATE_DIR);
  for (const name of layout.files) fix(join(layout.dataDir, name), PRIVATE_FILE);
  // Recursive: lectio's backups keep a copy of the uploaded assets in backups/assets.
  const walk = (path: string) => {
    fix(path, PRIVATE_DIR);
    for (const name of readdirSync(path)) {
      const entry = join(path, name);
      const stat = statSync(entry);
      if (stat.isDirectory()) walk(entry);
      else if (stat.isFile()) fix(entry, PRIVATE_FILE);
    }
  };
  for (const dir of layout.dirs) {
    const path = join(layout.dataDir, dir);
    if (existsSync(path)) walk(path);
  }
  return changed;
}
