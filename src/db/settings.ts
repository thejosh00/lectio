/**
 * Reading and writing an instance's settings.
 */
import type {Database} from 'bun:sqlite';
import {AppError, EXIT_USAGE} from '../core/errors.ts';
import {SETTINGS, settingSpec} from '../core/settings.ts';
import {systemTimeZone} from '../core/time.ts';

/** The stored value, or the default. */
export function getSetting(db: Database, key: string): string | undefined {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as {value: string} | null;
  return row?.value ?? settingSpec(key)?.default;
}

export function numberSetting(db: Database, key: string): number {
  const value = Number(getSetting(db, key));
  if (!Number.isFinite(value)) throw new Error(`setting ${key} is not a number`);
  return value;
}

/** The time zone "today" is in: the setting, else the system's. */
export function timeZoneOf(db: Database): string {
  return getSetting(db, 'timezone') ?? systemTimeZone();
}

export function setSetting(db: Database, key: string, value: string | null): void {
  const spec = settingSpec(key);
  if (spec === undefined) throw new AppError(`no setting called "${key}"; run "lectio settings" for the list`, EXIT_USAGE);
  if (value === null || value.trim() === '') {
    db.query('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  const clean = value.trim();
  const problem = spec.validate?.(clean);
  if (problem !== undefined) throw new AppError(`${key} ${problem}`, EXIT_USAGE);
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, clean);
}

export interface SettingJson {
  key: string;
  value: string | null;
  default: string | null;
  is_set: boolean;
  summary: string;
}

export function settingJson(db: Database, key: string): SettingJson {
  const spec = settingSpec(key);
  if (spec === undefined) throw new AppError(`no setting called "${key}"`, EXIT_USAGE);
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as {value: string} | null;
  const fallback = key === 'timezone' ? systemTimeZone() : (spec.default ?? null);
  return {key, value: row?.value ?? fallback, default: fallback, is_set: row !== null, summary: spec.summary};
}

export function allSettingsJson(db: Database): SettingJson[] {
  return Object.keys(SETTINGS).map(key => settingJson(db, key));
}
