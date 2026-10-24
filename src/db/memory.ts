/**
 * Keeping `concept_memory` in step with the attempts. Written by the app only.
 *
 * An attempt counts for memory when it is the first try, not void, in a daily quiz or
 * practice (not an inline check, and not a placement probe), graded, on a concept that
 * has been introduced, and the first such attempt on that concept that local day. A
 * question with several concepts updates each of them.
 */
import {countedReviews, recallOn, replay, reviewsOf, type ReviewCandidate} from '../core/memory.ts';
import type {Memory} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {numberSetting} from './settings.ts';

/** A concept as the counting rule needs it. */
export interface ConceptFacts {
  status: string;
  introduced: string | null;
}

/** Every attempt on these concepts, as counting candidates, by concept id. */
export function reviewCandidates(ctx: Ctx, conceptIds: readonly string[]): Map<string, ReviewCandidate[]> {
  const out = new Map<string, ReviewCandidate[]>(conceptIds.map(id => [id, []]));
  if (conceptIds.length === 0) return out;
  const rows = ctx.db
    .query(
      `SELECT qc.concept_id, a.id, a.at, a.context, a.role, a.attempt_no, a.void, a.score, a.confidence, a.hints_used FROM attempts a
       JOIN question_concepts qc ON qc.question_id = a.question_id WHERE qc.concept_id IN (${conceptIds.map(() => '?').join(', ')})`,
    )
    .all(...conceptIds) as Array<Omit<ReviewCandidate, 'day' | 'void'> & {concept_id: string; void: number}>;
  for (const {concept_id, ...row} of rows) out.get(concept_id)!.push({...row, void: row.void === 1, day: ctx.dayOf(row.at)});
  return out;
}

/** The attempts that count for a concept, oldest first: one per local day. */
function countedFor(ctx: Ctx, conceptId: string): ReviewCandidate[] {
  const concept = ctx.db.query('SELECT status, introduced FROM concepts WHERE id = ?').get(conceptId) as ConceptFacts | null;
  if (concept === null) return [];
  return countedReviews(reviewCandidates(ctx, [conceptId]).get(conceptId)!, concept);
}

/**
 * Recompute the memory of these concepts from their history, and the `counts_for_memory`
 * flag of every attempt that touches them.
 */
export function refreshMemory(ctx: Ctx, conceptIds: Iterable<string>): void {
  const retention = numberSetting(ctx.db, 'desired_retention');
  const cache = new Map<string, Set<string>>();
  const counted = (conceptId: string) => {
    let set = cache.get(conceptId);
    if (set === undefined) {
      set = new Set(countedFor(ctx, conceptId).map(c => c.id));
      cache.set(conceptId, set);
    }
    return set;
  };
  const ids = [...new Set(conceptIds)];
  for (const conceptId of ids) {
    const reviews = reviewsOf(countedFor(ctx, conceptId));
    const state = replay(reviews, retention);
    if (state === null) {
      ctx.db.query('DELETE FROM concept_memory WHERE concept_id = ?').run(conceptId);
      continue;
    }
    ctx.db
      .query(
        `INSERT INTO concept_memory (concept_id, stability, difficulty, reps, lapses, last_review, due) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(concept_id) DO UPDATE SET stability = excluded.stability, difficulty = excluded.difficulty, reps = excluded.reps,
           lapses = excluded.lapses, last_review = excluded.last_review, due = excluded.due`,
      )
      .run(conceptId, state.stability, state.difficulty, state.reps, state.lapses, state.last_review, state.due);
  }
  if (ids.length === 0) return;
  const touched = ctx.db
    .query(`SELECT DISTINCT a.id FROM attempts a JOIN question_concepts qc ON qc.question_id = a.question_id WHERE qc.concept_id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids) as Array<{id: string}>;
  for (const {id} of touched) {
    const concepts = (ctx.db.query('SELECT qc.concept_id FROM attempts a JOIN question_concepts qc ON qc.question_id = a.question_id WHERE a.id = ?').all(id) as Array<{concept_id: string}>).map(r => r.concept_id);
    const flag = concepts.some(c => counted(c).has(id)) ? 1 : 0;
    ctx.db.query('UPDATE attempts SET counts_for_memory = ? WHERE id = ? AND counts_for_memory != ?').run(flag, id, flag);
  }
}

export interface MemoryView extends Memory {
  /** Retrievability today, 0–1. */
  recall_now: number;
  is_due: boolean;
}

export function memoryOf(ctx: Ctx, conceptId: string, today = ctx.today()): MemoryView | null {
  const row = ctx.db.query('SELECT stability, difficulty, reps, lapses, last_review, due FROM concept_memory WHERE concept_id = ?').get(conceptId) as Memory | null;
  if (row === null) return null;
  return {...row, recall_now: recallOn({stability: row.stability, last_review_day: ctx.dayOf(row.last_review)}, today), is_due: row.due <= today};
}

/** Concepts due for review in a subject (or all), earliest due first. */
export function dueConcepts(ctx: Ctx, subjectId?: string): Array<{concept_id: string; subject_id: string; key: string; title: string; due: string}> {
  const today = ctx.today();
  const sql = `SELECT m.concept_id, c.subject_id, c.key, c.title, m.due FROM concept_memory m JOIN concepts c ON c.id = m.concept_id
     JOIN subjects s ON s.id = c.subject_id
     WHERE m.due <= ? AND c.status = 'introduced' AND s.status = 'active' ${subjectId === undefined ? '' : 'AND c.subject_id = ?'}
     ORDER BY m.due, c.position`;
  return (subjectId === undefined ? ctx.db.query(sql).all(today) : ctx.db.query(sql).all(today, subjectId)) as Array<{concept_id: string; subject_id: string; key: string; title: string; due: string}>;
}
