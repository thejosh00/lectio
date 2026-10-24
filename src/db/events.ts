/**
 * The audit trail, and live updates.
 *
 * Every change is a row in `events`, recording who did what. The hub publishes each one
 * to open browsers as it happens; a browser that reconnects catches up from the table.
 */
import type {Database} from 'bun:sqlite';

export type EventEntity = 'subject' | 'concept' | 'lesson' | 'block' | 'quiz' | 'question' | 'attempt' | 'feedback' | 'note' | 'run' | 'proposal' | 'settings' | 'asset' | 'exam';

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

/**
 * Whether an event would give away a checkup (M12): anything about a checkup's quiz,
 * questions, answers or the feedback on them, and anything the examiner did. Those who
 * can't see checkups never receive these.
 */
export function isExamEvent(db: Database, event: StoredEvent): boolean {
  if (event.entity === 'exam' || event.actor === 'agent:examiner') return true;
  const isExamRow = (target: string, id: string): boolean => {
    const sql: Record<string, string> = {
      quiz: "SELECT 1 AS x FROM quizzes WHERE id = ? AND kind = 'exam'",
      question: "SELECT 1 AS x FROM questions WHERE id = ? AND status = 'exam'",
      attempt: "SELECT 1 AS x FROM attempts WHERE id = ? AND context = 'exam'",
    };
    return sql[target] !== undefined && db.query(sql[target]!).get(id) !== null;
  };
  if (event.entity === 'feedback') {
    const row = db.query('SELECT target, target_id FROM feedback WHERE id = ?').get(event.entity_id) as {target: string; target_id: string} | null;
    return row !== null && isExamRow(row.target, row.target_id);
  }
  return isExamRow(event.entity, event.entity_id);
}

export function latestEventSeq(db: Database): number {
  return (db.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as {seq: number}).seq;
}
