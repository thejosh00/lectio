/**
 * What the server does on its own: take the daily backup, and skip checkups that waited
 * too long. Returns a function that stops it.
 */
import {dailyBackup} from '../db/backup.ts';
import {Ctx, type AppDeps} from '../db/context.ts';
import {expireExams} from '../db/exams.ts';
import {timeZoneOf} from '../db/settings.ts';

export interface BackgroundOptions {
  dataDir: string;
  log: (line: string) => void;
}

const BACKUP_CHECK_MS = 60 * 60_000;

export function startBackground(deps: AppDeps, options: BackgroundOptions): () => void {
  const backup = () => {
    try {
      const path = dailyBackup(deps.db, options.dataDir, new Date(deps.now()), timeZoneOf(deps.db));
      if (path !== undefined) options.log(`${deps.now()} backed up to ${path}`);
    } catch (error) {
      // Reported, never fatal: a full disk must not take the classroom down with it.
      options.log(`${deps.now()} backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const expire = () => {
    try {
      const skipped = expireExams(new Ctx(deps, 'lectio'));
      if (skipped.length > 0) options.log(`${deps.now()} skipped ${skipped.length} checkup(s) that waited too long`);
    } catch (error) {
      options.log(`${deps.now()} expiring checkups failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const tick = () => {
    backup();
    expire();
  };
  tick();
  const timer = setInterval(tick, BACKUP_CHECK_MS);
  return () => clearInterval(timer);
}
