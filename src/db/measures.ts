/**
 * Loading the rows the measures need, and putting them together for the tutor's context,
 * the Progress page and the question bank. The definitions themselves are pure, in
 * `src/core/measures.ts`.
 */
import {
  approachOutcomes,
  calibration,
  examOutcomes,
  experimentOutcomes,
  load,
  mediaOutcomes,
  misconceptions,
  outcomesBy,
  playbookOutcomes,
  predictions,
  questionStats,
  retention,
  retentionByWeek,
  sameDayAccuracy,
  sameDayAccuracyByWeek,
  throughput,
  type AttemptFact,
  type BlockFact,
  type ArmGroup,
  type ExamFact,
  type ExperimentMedia,
  type Introduction,
  type MediaIntroduction,
  type PredictionFact,
} from '../core/measures.ts';
import {countedReviews, expectedRecall, reviewsOf} from '../core/memory.ts';
import {addDaysIso} from '../core/time.ts';
import type {Question} from '../core/types.ts';
import {questionType} from '../questions/index.ts';
import {parseJson, type Ctx} from './context.ts';
import {memoryOf, reviewCandidates, type ConceptFacts} from './memory.ts';
import {getQuestion} from './questions.ts';
import {numberSetting} from './settings.ts';
import {getSubject} from './subjects.ts';

interface AttemptJoin {
  id: string;
  question_id: string;
  question_type: string;
  aim: string;
  figure: number;
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

/**
 * Attempts as measure facts. Checkup answers (M12) are left out unless asked for (`exams:
 * 'only'`), so every measure that existed before checkups reads exactly the rows it did.
 */
export function attemptFacts(ctx: Ctx, filter: {subjectId?: string; since?: string; questionIds?: string[]; exams?: 'exclude' | 'only'} = {}): AttemptFact[] {
  const where: string[] = [filter.exams === 'only' ? "a.context = 'exam'" : "a.context != 'exam'"];
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
      `SELECT a.id, a.question_id, q.type AS question_type, q.aim, q.figure IS NOT NULL AS figure, a.context, a.role, a.attempt_no, a.score, a.confidence, a.hints_used, a.seconds,
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
    figure: row.figure === 1,
    counts_for_memory: row.counts_for_memory === 1,
    void: row.void === 1,
    day: ctx.dayOf(row.at),
    answer: parseJson<unknown>(row.answer, null),
  }));
}

interface PredictionJoin {
  id: string;
  question_id: string;
  subject_id: string;
  at: string;
  score: number;
  answer: string;
  role: string;
  predicted: number;
  quiz_added: string;
}

/** The share of first tries on `new` items scoring 1 in a subject over the 14 days before `before`, or the target under n = 5. */
function recentAccuracy(ctx: Ctx, subjectId: string, before: string, target: number): number {
  const row = ctx.db
    .query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN a.score = 1 THEN 1 ELSE 0 END), 0) AS hits FROM attempts a JOIN questions q ON q.id = a.question_id
       WHERE q.subject_id = ? AND a.role = 'new' AND a.attempt_no = 1 AND a.void = 0 AND a.score IS NOT NULL AND a.at >= ? AND a.at < ?`,
    )
    .get(subjectId, addDaysIso(before, -14), before) as {n: number; hits: number};
  return row.n < 5 ? target : row.hits / row.n;
}

/**
 * What the memory model alone expects for some concepts on a day, knowing only the reviews
 * counted before `before`: the lowest FSRS recall over them, or null if none has a memory.
 */
function memoryModel(ctx: Ctx, conceptIds: readonly string[]): (ids: readonly string[], before: string, day: string) => number | null {
  const candidates = reviewCandidates(ctx, conceptIds);
  const concepts = new Map(
    conceptIds.length === 0
      ? []
      : (ctx.db.query(`SELECT id, status, introduced FROM concepts WHERE id IN (${conceptIds.map(() => '?').join(', ')})`).all(...conceptIds) as Array<ConceptFacts & {id: string}>).map(c => [c.id, c]),
  );
  const desired = numberSetting(ctx.db, 'desired_retention');
  return (ids, before, day) =>
    expectedRecall(
      ids.map(id => reviewsOf(countedReviews((candidates.get(id) ?? []).filter(a => a.at < before), concepts.get(id) ?? {status: 'planned', introduced: null}))),
      day,
      desired,
    );
}

/**
 * First tries at the quiz items the tutor predicted, each with what the formula expected
 * knowing only what the tutor knew when it wrote the quiz: FSRS recall that day, replayed
 * from the reviews counted before the quiz was added (the lowest over the question's
 * concepts), or, for an idea with no memory yet, the subject's recent same-day accuracy.
 * Widget questions score themselves with code the tutor wrote, so they are left out (R5):
 * a tutor could otherwise match its own predictions. They still count for memory.
 */
export function predictionFacts(ctx: Ctx, subjectId?: string): Array<PredictionFact & {answer: unknown}> {
  const rows = ctx.db
    .query(
      `SELECT a.id, a.question_id, q.subject_id, a.at, a.score, a.answer, qi.role, qi.predicted, z.added AS quiz_added
       FROM attempts a JOIN quiz_items qi ON qi.quiz_id = a.quiz_id AND qi.question_id = a.question_id
       JOIN quizzes z ON z.id = a.quiz_id JOIN questions q ON q.id = a.question_id
       WHERE a.attempt_no = 1 AND a.void = 0 AND a.score IS NOT NULL AND qi.predicted IS NOT NULL AND q.type != 'widget' ${subjectId === undefined ? '' : 'AND q.subject_id = ?'}
       ORDER BY a.at, a.id`,
    )
    .all(...(subjectId === undefined ? [] : [subjectId])) as PredictionJoin[];
  if (rows.length === 0) return [];
  const conceptsOf = new Map<string, string[]>();
  const questionIds = [...new Set(rows.map(r => r.question_id))];
  for (const row of ctx.db.query(`SELECT question_id, concept_id FROM question_concepts WHERE question_id IN (${questionIds.map(() => '?').join(', ')})`).all(...questionIds) as Array<{
    question_id: string;
    concept_id: string;
  }>) {
    (conceptsOf.get(row.question_id) ?? conceptsOf.set(row.question_id, []).get(row.question_id)!).push(row.concept_id);
  }
  const model = memoryModel(ctx, [...new Set([...conceptsOf.values()].flat())]);
  const target = numberSetting(ctx.db, 'target_accuracy');
  return rows.map(row => {
    const ids = conceptsOf.get(row.question_id) ?? [];
    const day = ctx.dayOf(row.at);
    const formula = model(ids, row.quiz_added, day) ?? recentAccuracy(ctx, row.subject_id, row.quiz_added, target);
    return {attempt_id: row.id, question_id: row.question_id, role: row.role, concepts: ids, day, predicted: row.predicted, formula, score: row.score, answer: parseJson<unknown>(row.answer, null)};
  });
}

/** Checkup answers, each with what the memory model expected for its concepts when the checkup was written (M12). */
export function examFacts(ctx: Ctx, subjectId?: string): ExamFact[] {
  const facts = attemptFacts(ctx, {subjectId, exams: 'only'});
  if (facts.length === 0) return [];
  const added = new Map(
    (ctx.db.query("SELECT a.id, z.added FROM attempts a JOIN quizzes z ON z.id = a.quiz_id WHERE a.context = 'exam'").all() as Array<{id: string; added: string}>).map(r => [r.id, r.added]),
  );
  const model = memoryModel(ctx, [...new Set(facts.flatMap(f => f.concepts))]);
  return facts.map(f => ({...f, expected: model(f.concepts, added.get(f.id) ?? f.at, f.day)}));
}

/** Lessons grouped by the playbook version that wrote them, with what they introduced and how their new items went (M13). */
function playbookReport(ctx: Ctx, facts: readonly AttemptFact[], subjectId?: string) {
  const lessons = ctx.db
    .query(`SELECT id, playbook_version FROM lessons WHERE state IN ('open', 'finished') ${subjectId === undefined ? '' : 'AND subject_id = ?'}`)
    .all(...(subjectId === undefined ? [] : [subjectId])) as Array<{id: string; playbook_version: number | null}>;
  if (lessons.every(l => l.playbook_version === null)) return [];
  const versionOf = new Map(lessons.map(l => [l.id, l.playbook_version]));
  const groups = new Map<number | null, {version: number | null; lessons: number; introduced: string[]; same_day: AttemptFact[]}>();
  const group = (version: number | null) => groups.get(version) ?? groups.set(version, {version, lessons: 0, introduced: [], same_day: []}).get(version)!;
  for (const l of lessons) group(l.playbook_version).lessons++;
  for (const row of ctx.db.query("SELECT lc.lesson_id, lc.concept_id FROM lesson_concepts lc JOIN lessons l ON l.id = lc.lesson_id WHERE lc.role = 'new' AND l.state = 'finished'").all() as Array<{
    lesson_id: string;
    concept_id: string;
  }>) {
    if (versionOf.has(row.lesson_id)) group(versionOf.get(row.lesson_id)!).introduced.push(row.concept_id);
  }
  for (const [lesson, attempts] of newItemsByLesson(ctx, facts)) if (versionOf.has(lesson)) group(versionOf.get(lesson)!).same_day.push(...attempts);
  return playbookOutcomes([...groups.values()], facts, numberSetting(ctx.db, 'memory_gap_hours'));
}

/** First tries on the `new` items of each lesson's quizzes, by lesson id. */
function newItemsByLesson(ctx: Ctx, facts: readonly AttemptFact[]): Map<string, AttemptFact[]> {
  const lessonOf = new Map(
    (ctx.db.query("SELECT a.id, z.lesson_id FROM attempts a JOIN quizzes z ON z.id = a.quiz_id WHERE a.role = 'new' AND z.lesson_id IS NOT NULL").all() as Array<{id: string; lesson_id: string}>).map(r => [r.id, r.lesson_id]),
  );
  const out = new Map<string, AttemptFact[]>();
  for (const a of facts) {
    const lesson = lessonOf.get(a.id);
    if (lesson !== undefined) (out.get(lesson) ?? out.set(lesson, []).get(lesson)!).push(a);
  }
  return out;
}

/**
 * For an experiment counting every concept taught (M20): each concept each finished lesson
 * taught, in any role, with the window its reviews count in — from that lesson's finish to the
 * experiment's next finished lesson on the same concept, so no review counts for two lessons.
 */
function taughtWindows(ctx: Ctx, experiment: string): Array<{arm: 'a' | 'b'; concept: string; after: string; before: string | null}> {
  const rows = ctx.db
    .query(
      `SELECT lc.concept_id, la.arm, l.finished FROM lessons l JOIN lesson_arms la ON la.lesson_id = l.id JOIN lesson_concepts lc ON lc.lesson_id = l.id
       WHERE l.experiment = ? AND l.state = 'finished' AND l.finished IS NOT NULL ORDER BY l.finished`,
    )
    .all(experiment) as Array<{concept_id: string; arm: 'a' | 'b'; finished: string}>;
  return rows.map((row, i) => ({
    arm: row.arm,
    concept: row.concept_id,
    after: row.finished,
    before: rows.slice(i + 1).find(next => next.concept_id === row.concept_id)?.finished ?? null,
  }));
}

/** Each experiment's finished lessons, split by the arm the learner saw (M14). Widget-scored attempts are left out (R5). */
function experimentsReport(ctx: Ctx, allFacts: readonly AttemptFact[], subjectId?: string) {
  const facts = withoutSelfScored(allFacts);
  const experiments = (
    subjectId === undefined ? ctx.db.query('SELECT * FROM experiments ORDER BY opened').all() : ctx.db.query('SELECT * FROM experiments WHERE subject_id = ? ORDER BY opened').all(subjectId)
  ) as Array<{name: string; arms: string; counts: string; status: string; verdict: string | null}>;
  if (experiments.length === 0) return [];
  const newItems = newItemsByLesson(ctx, facts);
  return experimentOutcomes(
    experiments.map(e => {
      const lessons = ctx.db
        .query(
          `SELECT l.id, la.arm, l.active_seconds,
                  (SELECT COALESCE(SUM(b.seen_seconds), 0) FROM blocks b WHERE b.lesson_id = l.id AND b.arm = la.arm) AS seen_seconds
           FROM lessons l JOIN lesson_arms la ON la.lesson_id = l.id WHERE l.experiment = ? AND l.state = 'finished'`,
        )
        .all(e.name) as Array<{id: string; arm: 'a' | 'b'; active_seconds: number; seen_seconds: number}>;
      const taught = e.counts === 'taught' ? taughtWindows(ctx, e.name) : undefined;
      const arm = (which: 'a' | 'b'): ArmGroup => {
        const mine = lessons.filter(l => l.arm === which);
        const ids = mine.map(l => l.id);
        const introduced = ids.flatMap(id => (ctx.db.query("SELECT concept_id FROM lesson_concepts WHERE lesson_id = ? AND role = 'new'").all(id) as Array<{concept_id: string}>).map(r => r.concept_id));
        return {
          lessons: ids.length,
          introduced,
          ...(taught === undefined ? {} : {taught: taught.filter(t => t.arm === which).map(({arm: _arm, ...t}) => t)}),
          same_day: ids.flatMap(id => newItems.get(id) ?? []),
          timing: mine.map(l => ({seen_seconds: l.seen_seconds, active_seconds: l.active_seconds})),
        };
      };
      return {name: e.name, arms: parseJson<{a: string; b: string}>(e.arms, {a: '', b: ''}), status: e.status, verdict: e.verdict, a: arm('a'), b: arm('b')};
    }),
    facts,
    numberSetting(ctx.db, 'memory_gap_hours'),
  );
}

/** Attempts scored by something other than a widget the tutor wrote (R5): what the tutor-graded measures use. */
export const withoutSelfScored = (facts: readonly AttemptFact[]): AttemptFact[] => facts.filter(f => f.question_type !== 'widget');

/** How many attempts a subject has that the predictions and experiment measures leave out, and why (R5). */
function selfScoredReport(ctx: Ctx, subjectId?: string) {
  const row = ctx.db
    .query(`SELECT COUNT(*) AS n FROM attempts a JOIN questions q ON q.id = a.question_id WHERE q.type = 'widget' AND a.void = 0 AND a.score IS NOT NULL ${subjectId === undefined ? '' : 'AND q.subject_id = ?'}`)
    .get(...(subjectId === undefined ? [] : [subjectId])) as {n: number};
  return {
    widget_attempts: row.n,
    excluded_from: ['predictions', 'experiments'],
    note: 'Widget questions score themselves, so their attempts are left out of the predictions and experiment measures (they still count for memory). Figures from before this change may shift.',
  };
}

/** Each experiment's outcome with the block types its arms used, for the media measure (M16). */
function experimentMedia(ctx: Ctx, outcomes: ReturnType<typeof experimentsReport>): ExperimentMedia[] {
  return outcomes.map(outcome => {
    const rows = ctx.db
      .query('SELECT DISTINCT b.arm, b.type FROM blocks b JOIN lessons l ON l.id = b.lesson_id WHERE l.experiment = ? AND b.arm IS NOT NULL')
      .all(outcome.name) as Array<{arm: 'a' | 'b'; type: string}>;
    return {outcome, a_types: rows.filter(r => r.arm === 'a').map(r => r.type), b_types: rows.filter(r => r.arm === 'b').map(r => r.type)};
  });
}

/** What each block type does for the learner, across every subject or one (M16). */
export function mediaReport(ctx: Ctx, subjectId?: string) {
  const facts = attemptFacts(ctx, {subjectId});
  const gap = numberSetting(ctx.db, 'memory_gap_hours');
  return mediaOutcomes(introductions(ctx, subjectId), blockFacts(ctx, subjectId), facts, gap, experimentMedia(ctx, experimentsReport(ctx, facts, subjectId)));
}

/** Week by week: concepts introduced, minutes spent, and how much of it was kept (M15). */
function throughputReport(ctx: Ctx, facts: readonly AttemptFact[], subjectId?: string) {
  const where = subjectId === undefined ? '' : 'AND subject_id = ?';
  const params = subjectId === undefined ? [] : [subjectId];
  const introductions = (ctx.db.query(`SELECT id, introduced FROM concepts WHERE introduced IS NOT NULL AND status != 'known' ${where}`).all(...params) as Array<{id: string; introduced: string}>).map(c => ({
    concept_id: c.id,
    day: ctx.dayOf(c.introduced),
  }));
  const minutes = [
    ...(ctx.db.query(`SELECT day, active_seconds FROM lessons WHERE active_seconds > 0 ${where}`).all(...params) as Array<{day: string; active_seconds: number}>).map(l => ({day: l.day, minutes: l.active_seconds / 60})),
    ...facts.filter(a => a.context !== 'lesson').map(a => ({day: a.day, minutes: a.seconds / 60})),
  ];
  return throughput({introductions, minutes, attempts: facts, gapHours: numberSetting(ctx.db, 'memory_gap_hours')});
}

function examsReport(ctx: Ctx, subjectId?: string) {
  const finished = (
    subjectId === undefined
      ? ctx.db.query("SELECT COUNT(*) AS n FROM quizzes WHERE kind = 'exam' AND state = 'finished'").get()
      : ctx.db.query("SELECT COUNT(*) AS n FROM quizzes WHERE kind = 'exam' AND state = 'finished' AND subject_id = ?").get(subjectId)
  ) as {n: number};
  return {checkups: finished.n, ...examOutcomes(examFacts(ctx, subjectId), numberSetting(ctx.db, 'memory_gap_hours'))};
}

/** The predictions measure, with each surprise's question and answer for the tutor to read. */
function predictionsReport(ctx: Ctx, subjectId?: string) {
  const facts = predictionFacts(ctx, subjectId);
  const answers = new Map(facts.map(f => [f.attempt_id, f.answer]));
  const report = predictions(facts.map(({answer: _answer, ...fact}) => fact));
  return {
    ...report,
    surprises: report.surprises.map(s => {
      const prompt = getQuestion(ctx, s.question_id)?.prompt ?? '';
      return {...s, prompt: prompt.length > 240 ? `${prompt.slice(0, 239)}…` : prompt, answer: answers.get(s.attempt_id) ?? null, concept_keys: s.concepts.map(c => conceptKey(ctx, c))};
    }),
  };
}

/** Each introduced concept, and the approaches and block types the introducing lesson used on it. */
function introductions(ctx: Ctx, subjectId?: string): Array<Introduction & MediaIntroduction> {
  const rows = ctx.db
    .query(
      `SELECT c.id AS concept_id, c.key, lc.lesson_id FROM concepts c
       JOIN lesson_concepts lc ON lc.concept_id = c.id AND lc.role = 'new'
       JOIN lessons l ON l.id = lc.lesson_id AND l.state = 'finished'
       WHERE c.introduced IS NOT NULL ${subjectId === undefined ? '' : 'AND c.subject_id = ?'}`,
    )
    .all(...(subjectId === undefined ? [] : [subjectId])) as Array<{concept_id: string; key: string; lesson_id: string}>;
  return rows.map(row => {
    // In a two-arm lesson, only the arm the learner saw taught anything (M14).
    const blocks = ctx.db
      .query('SELECT approach, type, concepts FROM blocks WHERE lesson_id = ? AND (arm IS NULL OR arm = (SELECT arm FROM lesson_arms WHERE lesson_id = ?))')
      .all(row.lesson_id, row.lesson_id) as Array<{approach: string; type: string; concepts: string}>;
    const on = blocks.filter(b => parseJson<string[]>(b.concepts, []).includes(row.key));
    return {concept_id: row.concept_id, approaches: [...new Set(on.map(b => b.approach))], types: [...new Set(on.map(b => b.type))]};
  });
}

const COMPLETABLE = new Set(['steps', 'widget', 'video']);

function blockFacts(ctx: Ctx, subjectId?: string): BlockFact[] {
  const rows = ctx.db
    .query(
      `SELECT b.id, b.approach, b.type, b.seen_seconds, b.completed,
         (SELECT COUNT(*) FROM feedback f WHERE f.target = 'block' AND f.target_id = b.id AND f.kind = 'helpful') AS helpful,
         (SELECT COUNT(*) FROM feedback f WHERE f.target = 'block' AND f.target_id = b.id AND f.kind = 'confusing') AS confusing
       FROM blocks b JOIN lessons l ON l.id = b.lesson_id WHERE l.state IN ('open', 'finished') ${subjectId === undefined ? '' : 'AND l.subject_id = ?'}
         AND (b.arm IS NULL OR (l.state = 'finished' AND b.arm = (SELECT arm FROM lesson_arms WHERE lesson_id = l.id)))`,
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
  /** Questions that carried a picture against those that didn't (M19): `with_figure`, `without_figure`. */
  question_figures: ReturnType<typeof outcomesBy>;
  aims: ReturnType<typeof outcomesBy>;
  load: ReturnType<typeof load> | null;
  hypotheses: ReturnType<typeof openHypotheses>;
  concepts: {total: number; introduced: number; known: number; solid: number; due: number};
  /** How well the tutor's predictions matched what happened, beside the formula's (M11). */
  predictions: ReturnType<typeof predictionsReport>;
  /** Checkups from the examiner: the score on questions the tutor never saw, beside what memory expected (M12). */
  exams: ReturnType<typeof examsReport>;
  /** Outcomes by the playbook version lessons were written under: before and after, not cause (M13). */
  playbook_versions: ReturnType<typeof playbookReport>;
  /** Two-arm experiments: per arm, retention and same-day accuracy, and the difference with an interval (M14). */
  experiments: ReturnType<typeof experimentsReport>;
  /** Widget-scored attempts the predictions and experiment measures leave out, and why (R5). */
  self_scored: ReturnType<typeof selfScoredReport>;
  /** Week by week: concepts introduced, minutes, their later retention, and retained concepts per hour (M15). */
  throughput: ReturnType<typeof throughputReport>;
  /** What each block type does for the learner: retention with and without it, engagement, and the experiments that tested it (M16). */
  media: ReturnType<typeof mediaOutcomes>;
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
  const intros = introductions(ctx, subjectId);
  const blocks = blockFacts(ctx, subjectId);
  const experiments = experimentsReport(ctx, facts, subjectId);
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
    approaches: approachOutcomes(intros, blocks, facts, gap),
    question_types: outcomesBy(facts, a => a.question_type, gap),
    question_figures: outcomesBy(facts, a => (a.figure === true ? 'with_figure' : 'without_figure'), gap),
    aims: outcomesBy(facts, a => a.aim, gap),
    load: loadReport,
    hypotheses: openHypotheses(ctx, subjectId),
    predictions: predictionsReport(ctx, subjectId),
    exams: examsReport(ctx, subjectId),
    playbook_versions: playbookReport(ctx, facts, subjectId),
    experiments,
    self_scored: selfScoredReport(ctx, subjectId),
    throughput: throughputReport(ctx, facts, subjectId),
    media: mediaOutcomes(intros, blocks, facts, gap, experimentMedia(ctx, experiments)),
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
  // Checkup questions exist only for those who may see checkups (M12).
  if (!ctx.seesExams) where.push("q.status != 'exam'");
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
