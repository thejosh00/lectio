/**
 * What every server-side operation is handed: the database, who is asking, the clock,
 * and the live-update hub.
 *
 * The clock is injected (`now`), never read directly, so tests can move it a day. "Today"
 * is the local date in the instance's time zone.
 */
import type {Database} from 'bun:sqlite';
import {localDate, localHour} from '../core/time.ts';
import {roleOf, type Role} from '../core/permissions.ts';
import {isAgent, type Actor} from '../core/types.ts';
import {recordEvent, type EventEntity, type EventHub} from './events.ts';
import {newId} from './ids.ts';
import {timeZoneOf} from './settings.ts';

export interface AppDeps {
  db: Database;
  hub?: EventHub;
  now: () => string;
  /** The instance's data directory, where assets and backups live. */
  dataDir?: string;
}

export class Ctx {
  readonly db: Database;
  readonly hub: EventHub | undefined;
  readonly now: () => string;
  readonly dataDir: string | undefined;

  constructor(
    deps: AppDeps,
    readonly actor: Actor,
  ) {
    this.db = deps.db;
    this.hub = deps.hub;
    this.now = deps.now;
    this.dataDir = deps.dataDir;
  }

  get isAgent(): boolean {
    return isAgent(this.actor);
  }

  get role(): Role {
    return roleOf(this.actor);
  }

  get timeZone(): string {
    return timeZoneOf(this.db);
  }

  /** The local date now, as `YYYY-MM-DD`. */
  today(): string {
    return localDate(this.now(), this.timeZone);
  }

  /** The local date of a moment. */
  dayOf(at: string): string {
    return localDate(at, this.timeZone);
  }

  hour(): number {
    return localHour(this.now(), this.timeZone);
  }

  newId(): string {
    return newId(this.now());
  }

  event(entity: EventEntity, entityId: string, change: Record<string, unknown>): void {
    recordEvent(this.db, this.hub, {at: this.now(), actor: this.actor, entity, entity_id: entityId, change});
  }

  /** Run `fn` in one write transaction. */
  write<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}

/** Parse a JSON column, falling back when it is somehow not JSON. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
