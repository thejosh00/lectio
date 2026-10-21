/**
 * The audit trail, and live updates.
 *
 * Every change is a row in `events`, recording who did what. The hub publishes each one
 * to open browsers as it happens; a browser that reconnects catches up from the table.
 */
import type {Database} from 'bun:sqlite';

export type EventEntity = 'subject' | 'concept' | 'lesson' | 'block' | 'quiz' | 'question' | 'attempt' | 'feedback' | 'note' | 'run' | 'proposal' | 'settings' | 'asset';

export interface StoredEvent {
  seq: number;
  at: string;
  actor: string;
  entity: EventEntity;
  entity_id: string;
  change: Record<string, unknown>;
}

type Listener = (event: StoredEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: StoredEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One broken connection must not stop the others hearing about it.
      }
    }
  }
}

export function recordEvent(
  db: Database,
  hub: EventHub | undefined,
  event: Omit<StoredEvent, 'seq'>,
): StoredEvent {
  const result = db
    .query('INSERT INTO events (at, actor, entity, entity_id, change) VALUES (?, ?, ?, ?, ?)')
    .run(event.at, event.actor, event.entity, event.entity_id, JSON.stringify(event.change));
  const stored = {...event, seq: Number(result.lastInsertRowid)};
  hub?.publish(stored);
  return stored;
}

interface EventRow {
  seq: number;
  at: string;
  actor: string;
  entity: EventEntity;
  entity_id: string;
  change: string;
}

const toEvent = (row: EventRow): StoredEvent => ({...row, change: JSON.parse(row.change) as Record<string, unknown>});

export function eventsSince(db: Database, seq: number, limit = 500): StoredEvent[] {
  return (db.query('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(seq, limit) as EventRow[]).map(toEvent);
}

export function latestEventSeq(db: Database): number {
  return (db.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as {seq: number}).seq;
}
