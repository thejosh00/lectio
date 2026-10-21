import {expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dailyBackup, labelledBackup, restoreBackup, toPrune} from '../../src/db/backup.ts';
import {openDatabase} from '../../src/db/database.ts';
import {serveCommand, serviceCommand, serviceLabel, servicePlist} from '../../src/local/service.ts';

test('each instance gets its own launchd label', () => {
  expect(serviceLabel('/Users/me/.lectio')).toBe('com.lectio.serve');
  expect(serviceLabel('/Users/me/.lectio-work')).toBe('com.lectio.serve.lectio-work');
});

test('the plist runs serve with the data directory', () => {
  const plist = servicePlist({label: 'com.lectio.serve', command: ['/bin/bun', '/x/cli.ts', 'serve', '--port', '7781'], dataDir: '/d & e', logPath: '/d/l', path: '/bin'});
  expect(plist).toContain('<string>--port</string>');
  expect(plist).toContain('<key>LECTIO_DIR</key>\n\t\t<string>/d &amp; e</string>');
});

test('the serve command prefers bun on PATH', () => {
  expect(serveCommand('/opt/homebrew/Cellar/bun/1.4/bin/bun', '/x/cli.ts', [], '/opt/homebrew/bin/bun')).toEqual(['/opt/homebrew/bin/bun', '/x/cli.ts', 'serve']);
});

test('install writes the agent and bootstraps it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-svc-'));
  const calls: string[][] = [];
  const code = serviceCommand(
    {dataDir: join(dir, '.lectio'), agentsDir: join(dir, 'agents'), platform: 'darwin', uid: 501, execPath: '/usr/local/bin/lectio', out: () => {}, err: () => {}, launchctl: args => (calls.push(args), {code: args[0] === 'print' ? 1 : 0, stdout: '', stderr: ''})},
    ['install'],
  );
  expect(code).toBe(0);
  expect(readdirSync(join(dir, 'agents'))).toEqual(['com.lectio.serve.plist']);
  expect(calls.at(-1)?.[0]).toBe('bootstrap');
});

test('daily backups: one a day, pruned; assets are copied once', () => {
  expect(toPrune(['lectio-2026-01-01.db', 'lectio-2026-01-03.db', 'lectio-2026-01-02.db', 'lectio-label-x-1.db'], 2)).toEqual(['lectio-2026-01-01.db']);
  const dir = mkdtempSync(join(tmpdir(), 'lectio-bk-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'abc.svg'), '<svg/>');
  const db = openDatabase(join(dir, 'lectio.db'));
  expect(dailyBackup(db, dir, new Date('2026-09-12T15:00:00Z'), 'America/Chicago')).toContain('lectio-2026-09-12.db');
  expect(dailyBackup(db, dir, new Date('2026-09-12T18:00:00Z'), 'America/Chicago')).toBeUndefined();
  expect(existsSync(join(dir, 'backups', 'assets', 'abc.svg'))).toBe(true);
  db.close();
});

test('a labelled backup restores, keeping the database it replaced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-bk-'));
  const db = openDatabase(join(dir, 'lectio.db'));
  db.query("INSERT INTO settings (key, value) VALUES ('practice_max', '3')").run();
  const path = labelledBackup(db, dir, 'pre-p1', '2026-09-12T15:00:00Z');
  expect(path).toContain('lectio-label-pre-p1-20260912T150000.db');
  db.query("UPDATE settings SET value = '9' WHERE key = 'practice_max'").run();
  db.close();
  const result = restoreBackup(dir, path);
  expect(result.previous).toBe(join(dir, 'lectio.db.before-restore'));
  const restored = openDatabase(join(dir, 'lectio.db'));
  expect(restored.query("SELECT value FROM settings WHERE key = 'practice_max'").get()).toEqual({value: '3'});
  restored.close();
});
