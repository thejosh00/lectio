/**
 * The syllabus: the ideas to learn in a subject, in order. Written by the tutor.
 *
 * An upsert is idempotent by key. It can add, retitle, reorder, retire, and mark
 * concepts known after placement; it never deletes, and only finishing a lesson makes a
 * concept `introduced`.
 */
import {AppError, EXIT_USAGE} from '../core/errors.ts';
import {Invalid, readConcepts, type ConceptInput} from '../core/submission.ts';
import type {Concept, ConceptStatus, Subject} from '../core/types.ts';
import {parseJson, type Ctx} from './context.ts';

interface ConceptRow extends Omit<Concept, 'prereqs'> {
  prereqs: string;
}

export const conceptFromRow = (row: ConceptRow): Concept => ({...row, prereqs: parseJson<string[]>(row.prereqs, [])});

export function listConcepts(ctx: Ctx, subjectId: string): Concept[] {
  return (ctx.db.query('SELECT * FROM concepts WHERE subject_id = ? ORDER BY position, key').all(subjectId) as ConceptRow[]).map(conceptFromRow);
}

export function conceptByKey(ctx: Ctx, subjectId: string, key: string): Concept | undefined {
  const row = ctx.db.query('SELECT * FROM concepts WHERE subject_id = ? AND key = ?').get(subjectId, key) as ConceptRow | null;
  return row === null ? undefined : conceptFromRow(row);
}

export function conceptStatuses(ctx: Ctx, subjectId: string): Map<string, ConceptStatus> {
  return new Map((ctx.db.query('SELECT key, status FROM concepts WHERE subject_id = ?').all(subjectId) as Array<{key: string; status: ConceptStatus}>).map(r => [r.key, r.status]));
}

/** key → concept id, for turning submitted keys into rows. */
export function conceptIds(ctx: Ctx, subjectId: string): Map<string, string> {
  return new Map((ctx.db.query('SELECT key, id FROM concepts WHERE subject_id = ?').all(subjectId) as Array<{key: string; id: string}>).map(r => [r.key, r.id]));
}

export interface UpsertResult {
  concepts: Concept[];
  created: string[];
  updated: string[];
  unchanged: string[];
}

export function upsertConcepts(ctx: Ctx, subject: Subject, value: unknown): UpsertResult {
  const current = listConcepts(ctx, subject.id);
  const byKey = new Map(current.map(c => [c.key, c]));
  let inputs: ConceptInput[];
  try {
    inputs = readConcepts(value, new Map(current.map(c => [c.key, c.prereqs])));
  } catch (error) {
    if (error instanceof Invalid) throw new AppError(error.message, EXIT_USAGE, {errors: error.issues});
    throw error;
  }
  const problems: Array<{path: string; message: string}> = [];
  inputs.forEach((input, i) => {
    const existing = byKey.get(input.key);
    if (existing?.status === 'introduced' && (input.status === 'planned' || input.status === 'known')) {
      problems.push({path: `[${i}].status`, message: `"${input.key}" was introduced on ${existing.introduced ?? '?'}; it can be retired, not made ${input.status}`});
    }
  });
  if (problems.length > 0) throw new AppError(`the concepts list has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}: ${problems.map(p => `${p.path}: ${p.message}`).join('; ')}`, EXIT_USAGE, {errors: problems});

  const now = ctx.now();
  let nextPosition = current.reduce((max, c) => Math.max(max, c.position), 0) + 1;
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  for (const input of inputs) {
    const existing = byKey.get(input.key);
    if (existing === undefined) {
      const position = input.position ?? nextPosition;
      nextPosition = Math.max(nextPosition, position) + 1;
      ctx.db
        .query('INSERT INTO concepts (id, subject_id, key, title, summary, prereqs, position, status, added, changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.newId(), subject.id, input.key, input.title.trim(), input.summary?.trim() ?? '', JSON.stringify(input.prereqs ?? []), position, input.status ?? 'planned', now, now);
      created.push(input.key);
      continue;
    }
    const next = {
      title: input.title.trim(),
      summary: input.summary === undefined ? existing.summary : input.summary.trim(),
      prereqs: input.prereqs ?? existing.prereqs,
      position: input.position ?? existing.position,
      status: input.status ?? existing.status,
    };
    const same =
      next.title === existing.title &&
      next.summary === existing.summary &&
      JSON.stringify(next.prereqs) === JSON.stringify(existing.prereqs) &&
      next.position === existing.position &&
      next.status === existing.status;
    if (same) {
      unchanged.push(input.key);
      continue;
    }
    ctx.db
      .query('UPDATE concepts SET title = ?, summary = ?, prereqs = ?, position = ?, status = ?, changed = ? WHERE id = ?')
      .run(next.title, next.summary, JSON.stringify(next.prereqs), next.position, next.status, now, existing.id);
    updated.push(input.key);
  }
  if (created.length + updated.length > 0) ctx.event('concept', subject.id, {kind: 'upserted', created, updated});
  return {concepts: listConcepts(ctx, subject.id), created, updated, unchanged};
}
