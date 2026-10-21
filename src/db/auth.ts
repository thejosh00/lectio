/**
 * Who is calling.
 *
 * Not a security boundary — this runs on a home network or a single-user laptop. A
 * token names an actor (`you`, `agent:tutor`) so that what each agent may do is
 * enforced by the server, and every write records who made it. The browser is `you`,
 * by a session cookie it gets in exchange for a `you` token.
 */
import type {Database} from 'bun:sqlite';
import {AppError, EXIT_USAGE} from '../core/errors.ts';
import {isActor, type Actor} from '../core/types.ts';
import {newSecret} from './ids.ts';

export interface Caller {
  actor: Actor;
}

export function createToken(db: Database, actor: string, now: string): string {
  if (!isActor(actor)) {
    throw new AppError(`an actor is "you" or "agent:<name>" (lowercase letters, digits, - and _), not "${actor}"`, EXIT_USAGE);
  }
  const token = `lc_${newSecret()}`;
  db.query('INSERT INTO tokens (token, actor, created) VALUES (?, ?, ?)').run(token, actor, now);
  return token;
}

export function callerForToken(db: Database, token: string): Caller | undefined {
  const row = db.query('SELECT actor FROM tokens WHERE token = ?').get(token) as {actor: string} | null;
  return row === null ? undefined : {actor: row.actor};
}

export function listTokens(db: Database): Array<{actor: string; created: string; prefix: string}> {
  const rows = db.query('SELECT token, actor, created FROM tokens ORDER BY created').all() as Array<{token: string; actor: string; created: string}>;
  return rows.map(row => ({actor: row.actor, created: row.created, prefix: `${row.token.slice(0, 8)}…`}));
}

export function revokeTokens(db: Database, actor: string): number {
  return db.query('DELETE FROM tokens WHERE actor = ?').run(actor).changes;
}

export function createSession(db: Database, now: string): string {
  const id = newSecret();
  db.query('INSERT INTO sessions (id, created) VALUES (?, ?)').run(id, now);
  return id;
}

export function callerForSession(db: Database, session: string): Caller | undefined {
  const row = db.query('SELECT id FROM sessions WHERE id = ?').get(session);
  return row === null ? undefined : {actor: 'you'};
}

export function endSession(db: Database, session: string): void {
  db.query('DELETE FROM sessions WHERE id = ?').run(session);
}
