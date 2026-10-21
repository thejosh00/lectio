/**
 * Loading the rows the measures need, and putting them together for the tutor's context,
 * the Progress page and the question bank. The definitions themselves are pure, in
 * `src/core/measures.ts`.
 */
import {
  approachOutcomes,
  calibration,
  load,
  misconceptions,
  outcomesBy,
  questionStats,
  retention,
  retentionByWeek,
  sameDayAccuracy,
  sameDayAccuracyByWeek,
  type AttemptFact,
  type BlockFact,
  type Introduction,
} from '../core/measures.ts';
import {addDaysIso} from '../core/time.ts';
import type {Question} from '../core/types.ts';
import {questionType} from '../questions/index.ts';
import {parseJson, type Ctx} from './context.ts';
import {memoryOf} from './memory.ts';
import {getQuestion} from './questions.ts';
import {numberSetting} from './settings.ts';
import {getSubject} from './subjects.ts';

interface AttemptJoin {
  id: string;
  question_id: string;
  question_type: string;
  aim: string;
  context: 'lesson' | 'quiz' | 'practice';
  role: string | null;
  attempt_no: number;
  score: number | null;
  confidence: 'sure' | 'think' | 'guess';
  hints_used: number;
  seconds: number;
  misconception: string | null;
  gap_hours: number | null;
  counts_for_memory: number;
  void: number;
  at: string;
  answer: string;
}

export function attemptFacts(ctx: Ctx, filter: {subjectId?: string; since?: string; questionIds?: string[]} = {}): AttemptFact[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.subjectId !== undefined) {
    where.push('q.subject_id = ?');
    params.push(filter.subjectId);
  }
  if (filter.since !== undefined) {
    where.push('a.at >= ?');
    params.push(filter.since);
  }
  if (filter.questionIds !== undefined) {
    if (filter.questionIds.length === 0) return [];
    where.push(`a.question_id IN (${filter.questionIds.map(() => '?').join(', ')})`);
    params.push(...filter.questionIds);
  }
  const rows = ctx.db
    .query(
      `SELECT a.id, a.question_id, q.type AS question_type, q.aim, a.context, a.role, a.attempt_no, a.score, a.confidence, a.hints_used, a.seconds,
         a.misconception, a.gap_hours, a.counts_for_memory, a.void, a.at, a.answer
       FROM attempts a JOIN questions q ON q.id = a.question_id ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY a.at`,
    )
    .all(...params) as AttemptJoin[];
  const conceptsOf = new Map<string, string[]>();
  for (const row of ctx.db.query('SELECT question_id, concept_id FROM question_concepts').all() as Array<{question_id: string; concept_id: string}>) {
    (conceptsOf.get(row.question_id) ?? conceptsOf.set(row.question_id, []).get(row.question_id)!).push(row.concept_id);
  }
  return rows.map(row => ({
    ...row,
    concepts: conceptsOf.get(row.question_id) ?? [],
    counts_for_memory: row.counts_for_memory === 1,
    void: row.void === 1,
    day: ctx.dayOf(row.at),
    answer: parseJson<unknown>(row.answer, null),
  }));
}

/** Each introduced concept, and the approaches the introducing lesson used on it. */
function introductions(ctx: Ctx, subjectId?: string): Introduction[] {
  const rows = ctx.db
    .query(
      `SELECT c.id AS concept_id, c.key, lc.lesson_id FROM concepts c
       JOIN lesson_concepts lc ON lc.concept_id = c.id AND lc.role = 'new'
       JOIN lessons l ON l.id = lc.lesson_id AND l.state = 'finished'
       WHERE c.introduced IS NOT NULL ${subjectId === undefined ? '' : 'AND c.subject_id = ?'}`,
    )
    .all(...(subjectId === undefined ? [] : [subjectId])) as Array<{concept_id: string; key: string; lesson_id: string}>;
  return rows.map(row => {
    const blocks = ctx.db.query('SELECT approach, concepts FROM blocks WHERE lesson_id = ?').all(row.lesson_id) as Array<{approach: string; concepts: string}>;
    const approaches = [...new Set(blocks.filter(b => parseJson<string[]>(b.concepts, []).includes(row.key)).map(b => b.approach))];
    return {concept_id: row.concept_id, approaches};
  });
}

const COMPLETABLE = new Set(['steps', 'widget', 'video']);

function blockFacts(ctx: Ctx, subjectId?: string): BlockFact[] {
  const rows = ctx.db
    .query(
      `SELECT b.id, b.approach, b.type, b.seen_seconds, b.completed,
         (SELECT COUNT(*) FROM feedback f WHERE f.target = 'block' AND f.target_id = b.id AND f.kind = 'helpful') AS helpful,
         (SELECT COUNT(*) FROM feedback f WHERE f.target = 'block' AND f.target_id = b.id AND f.kind = 'confusing') AS confusing
       FROM blocks b JOIN lessons l ON l.id = b.lesson_id WHERE l.state IN ('open', 'finished') ${subjectId === undefined ? '' : 'AND l.subject_id = ?'}`,
    )
    .all(...(subjectId === undefined ? [] : [subjectId])) as Array<{approach: string; type: string; seen_seconds: number; completed: number; helpful: number; confusing: number}>;
  return rows.map(r => ({approach: r.approach, type: r.type, seen_seconds: r.seen_seconds, completed: r.completed === 1, completable: COMPLETABLE.has(r.type), helpful: r.helpful, confusing: r.confusing}));
}

/** Lessons with a hypothesis and no verdict, with what has happened since to their concepts. */
export function openHypotheses(ctx: Ctx, subjectId?: string) {
  const gap = numberSetting(ctx.db, 'memory_gap_hours');
  const lessons = ctx.db
    .query(`SELECT id, subject_id, day, title, hypothesis, state FROM lessons WHERE hypothesis IS NOT NULL AND verdict IS NULL ${subjectId === undefined ? '' : 'AND subject_id = ?'} ORDER BY day`)
    .all(...(subjectId === undefined ? [] : [subjectId])) as Array<{id: string; subject_id: string; day: string; title: string; hypothesis: string; state: string}>;
  return lessons.map(lesson => {
    const concepts = ctx.db.query('SELECT c.id, c.key FROM lesson_concepts lc JOIN concepts c ON c.id = lc.concept_id WHERE lc.lesson_id = ?').all(lesson.id) as Array<{id: string; key: string}>;
    const facts = attemptFacts(ctx, {subjectId: lesson.subject_id}).filter(a => a.concepts.some(c => concepts.some(k => k.id === c)));
    const perConcept = concepts.map(c => {
      const mine = facts.filter(a => a.concepts.includes(c.id));
      return {key: c.key, delayed_reviews: mine.filter(a => a.counts_for_memory && a.gap_hours !== null && a.gap_hours >= gap).length, retention: retention(mine, gap)};
    });
    return {...lesson, concepts: perConcept, ready_for_verdict: perConcept.length > 0 && perConcept.every(c => c.delayed_reviews >= 2)};
  });
}

export interface ProgressReport {
  subject: {id: string; title: string} | null;
  retention: ReturnType<typeof retention>;
  retention_by_week: ReturnType<typeof retentionByWeek>;
  same_day_accuracy: ReturnType<typeof sameDayAccuracy>;
  same_day_accuracy_by_week: ReturnType<typeof sameDayAccuracyByWeek>;
  target_accuracy: number;
  calibration: ReturnType<typeof calibration> & {sure_but_wrong: Array<{concept_id: string; key: string; count: number}>};
  misconceptions: Array<ReturnType<typeof misconceptions>[number] & {concept_keys: string[]}>;
  approaches: ReturnType<typeof approachOutcomes>;
  question_types: ReturnType<typeof outcomesBy>;
  aims: ReturnType<typeof outcomesBy>;
  load: ReturnType<typeof load> | null;
  hypotheses: ReturnType<typeof openHypotheses>;
  concepts: {total: number; introduced: number; known: number; solid: number; due: number};
}

function conceptKey(ctx: Ctx, id: string): string {
  return (ctx.db.query('SELECT key FROM concepts WHERE id = ?').get(id) as {key: string} | null)?.key ?? id;
}

/** Every §7 measure, for one subject or across all of them. */
export function progressReport(ctx: Ctx, subjectId?: string): ProgressReport {
  const gap = numberSetting(ctx.db, 'memory_gap_hours');
  const facts = attemptFacts(ctx, {subjectId});
  const recent = facts.filter(a => a.at >= addDaysIso(ctx.now(), -30));
  const subject = subjectId === undefined ? undefined : getSubject(ctx, subjectId);
  const cal = calibration(facts);
  const conceptRows = ctx.db.query(`SELECT id, status FROM concepts ${subjectId === undefined ? '' : 'WHERE subject_id = ?'}`).all(...(subjectId === undefined ? [] : [subjectId])) as Array<{id: string; status: string}>;
  const today = ctx.today();
  let solid = 0;
  let due = 0;
  for (const c of conceptRows) {
    if (c.status !== 'introduced') continue;
    const memory = memoryOf(ctx, c.id, today);
    if (memory === null) continue;
    if (memory.recall_now >= 0.8) solid++;
    if (memory.is_due) due++;
  }
  let loadReport: ProgressReport['load'] = null;
  if (subject !== undefined) {
    const since = addDaysIso(ctx.now(), -numberSetting(ctx.db, 'context_days'));
    const lessons = ctx.db.query('SELECT id, day, state, active_seconds FROM lessons WHERE subject_id = ? AND added >= ?').all(subject.id, since) as Array<{id: string; day: string; state: string; active_seconds: number}>;
    const skips = ctx.db
      .query("SELECT f.kind FROM feedback f JOIN lessons l ON l.id = f.target_id WHERE f.target = 'lesson' AND f.kind LIKE 'skip_%' AND l.subject_id = ? AND f.at >= ?")
      .all(subject.id, since) as Array<{kind: string}>;
    const reasons: Record<string, number> = {};
    for (const s of skips) reasons[s.kind.replace(/^skip_/, '')] = (reasons[s.kind.replace(/^skip_/, '')] ?? 0) + 1;
    loadReport = load({
      budget: subject.minutes_per_day,
      lessonSeconds: lessons.map(l => ({day: l.day, seconds: l.active_seconds})),
      attempts: facts.filter(a => a.at >= since),
      finished: lessons.filter(l => l.state === 'finished').length,
      skipped: lessons.filter(l => l.state === 'skipped').length,
      skipReasons: reasons,
    });
  }
  return {
    subject: subject === undefined ? null : {id: subject.id, title: subject.title},
    retention: retention(facts, gap),
    retention_by_week: retentionByWeek(facts, gap),
    same_day_accuracy: sameDayAccuracy(facts),
    same_day_accuracy_by_week: sameDayAccuracyByWeek(facts),
    target_accuracy: numberSetting(ctx.db, 'target_accuracy'),
    calibration: {...cal, sure_but_wrong: cal.sure_but_wrong.map(s => ({...s, key: conceptKey(ctx, s.concept_id)}))},
    misconceptions: misconceptions(recent).map(m => ({...m, concept_keys: m.concepts.map(c => conceptKey(ctx, c))})),
    approaches: approachOutcomes(introductions(ctx, subjectId), blockFacts(ctx, subjectId), facts, gap),
    question_types: outcomesBy(facts, a => a.question_type, gap),
    aims: outcomesBy(facts, a => a.aim, gap),
    load: loadReport,
    hypotheses: openHypotheses(ctx, subjectId),
    concepts: {
      total: conceptRows.filter(c => c.status !== 'retired').length,
      introduced: conceptRows.filter(c => c.status === 'introduced').length,
      known: conceptRows.filter(c => c.status === 'known').length,
      solid,
      due,
    },
  };
}

export interface BankEntry extends Question {
  stats: ReturnType<typeof questionStats>;
  flags: Record<string, number>;
}

/** The question bank, with each question's record. */
export function questionBank(ctx: Ctx, filter: {subjectId?: string; concept?: string; status?: string; ids?: string[]}): BankEntry[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.ids !== undefined) {
    where.push(`q.id IN (${filter.ids.map(() => '?').join(', ')})`);
    params.push(...filter.ids);
  }
  if (filter.subjectId !== undefined) {
    where.push('q.subject_id = ?');
    params.push(filter.subjectId);
  }
  if (filter.status !== 'all') {
    where.push('q.status = ?');
    params.push(filter.status ?? 'active');
  }
  if (filter.concept !== undefined) {
    where.push('EXISTS (SELECT 1 FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id WHERE qc.question_id = q.id AND (c.key = ? OR c.id = ?))');
    params.push(filter.concept, filter.concept);
  }
  const ids = (ctx.db.query(`SELECT q.id FROM questions q ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY q.added`).all(...params) as Array<{id: string}>).map(r => r.id);
  const facts = attemptFacts(ctx, {questionIds: ids});
  const byQuestion = new Map<string, AttemptFact[]>();
  for (const f of facts) (byQuestion.get(f.question_id) ?? byQuestion.set(f.question_id, []).get(f.question_id)!).push(f);
  return ids.map(id => {
    const question = getQuestion(ctx, id)!;
    const type = questionType(question.type);
    const choices = type !== undefined && Array.isArray(question.body['choices']) ? (question.body['choices'] as Array<{id: string}>).map(c => c.id) : null;
    const flags: Record<string, number> = {};
    const rows = ctx.db
      .query("SELECT kind, COUNT(*) AS n FROM feedback WHERE (target = 'question' AND target_id = ?) OR (target = 'attempt' AND target_id IN (SELECT id FROM attempts WHERE question_id = ?)) GROUP BY kind")
      .all(id, id) as Array<{kind: string; n: number}>;
    for (const r of rows) flags[r.kind] = r.n;
    return {...question, stats: questionStats(byQuestion.get(id) ?? [], question.difficulty, choices), flags};
  });
}
