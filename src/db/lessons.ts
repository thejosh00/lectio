/**
 * Lessons: written by the tutor for a subject and a local day, read by the learner.
 *
 * `ready` (written, not yet opened) → `open` → `finished`, or `skipped` from either of
 * the first two. Only the learner opens, finishes or skips. The tutor can revise a
 * lesson while it is `ready`, and fix one block at any time.
 *
 * Submission is attributed, capped and idempotent: one lesson per subject per day, none
 * while an earlier one is unfinished, and re-submitting a day returns what is there.
 */
import {blockType} from '../blocks/index.ts';
import {AppError, EXIT_ERROR, EXIT_USAGE, failed, notFound, usageError} from '../core/errors.ts';
import {LESSON_RATINGS, SKIP_REASONS} from '../core/feedbackKinds.ts';
import {lessonReadiness, type Readiness} from '../core/schedule.ts';
import {Invalid, readBlock, readLesson, type LessonInput, type SubjectFacts} from '../core/submission.ts';
import {Node} from '../core/validate.ts';
import {isDay} from '../core/time.ts';
import type {Block, ConceptRole, Feedback, Lesson, Question, Subject} from '../core/types.ts';
import {latestAttempt, outcomeOf, type Outcome} from './attemptRows.ts';
import {conceptIds, conceptStatuses} from './concepts.ts';
import {parseJson, type Ctx} from './context.ts';
import {addFeedback, resolveFeedbackRows} from './feedback.ts';
import {getQuestion, insertQuestion, learnerView, retireQuestion, rewriteQuestion, type LearnerQuestion} from './questions.ts';
import {resolveId} from './refs.ts';
import {runFor} from './runs.ts';
import {numberSetting} from './settings.ts';
import {getSubject} from './subjects.ts';

interface LessonRow extends Omit<Lesson, 'objectives' | 'sources'> {
  objectives: string;
  sources: string;
}

export const lessonFromRow = (row: LessonRow): Lesson => ({
  ...row,
  objectives: parseJson<string[]>(row.objectives, []),
  sources: parseJson<Array<{title: string; url: string}>>(row.sources, []),
});

interface BlockRow extends Omit<Block, 'concepts' | 'body' | 'completed'> {
  concepts: string;
  body: string;
  completed: number;
}

export const blockFromRow = (row: BlockRow): Block => ({
  ...row,
  concepts: parseJson<string[]>(row.concepts, []),
  body: parseJson<Record<string, unknown>>(row.body, {}),
  completed: row.completed === 1,
});

export function getLesson(ctx: Ctx, id: string): Lesson | undefined {
  const row = ctx.db.query('SELECT * FROM lessons WHERE id = ?').get(id) as LessonRow | null;
  return row === null ? undefined : lessonFromRow(row);
}

export function resolveLesson(ctx: Ctx, ref: string | undefined): Lesson {
  const lesson = getLesson(ctx, resolveId(ctx, 'lesson', ref));
  if (lesson === undefined) throw notFound(`no lesson "${ref}"`);
  return lesson;
}

export function lessonForDay(ctx: Ctx, subjectId: string, day: string): Lesson | undefined {
  const row = ctx.db.query('SELECT * FROM lessons WHERE subject_id = ? AND day = ?').get(subjectId, day) as LessonRow | null;
  return row === null ? undefined : lessonFromRow(row);
}

/** Lessons still waiting for the learner, oldest first. */
export function unfinishedLessons(ctx: Ctx, subjectId: string): Lesson[] {
  return (ctx.db.query("SELECT * FROM lessons WHERE subject_id = ? AND state IN ('ready', 'open') ORDER BY day").all(subjectId) as LessonRow[]).map(lessonFromRow);
}

export function listLessons(ctx: Ctx, filter: {subjectId?: string; state?: string; limit?: number}): Lesson[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter.subjectId !== undefined) {
    where.push('subject_id = ?');
    params.push(filter.subjectId);
  }
  if (filter.state !== undefined) {
    where.push('state = ?');
    params.push(filter.state);
  }
  params.push(filter.limit ?? 100);
  return (ctx.db.query(`SELECT * FROM lessons ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY day DESC, added DESC LIMIT ?`).all(...params) as LessonRow[]).map(lessonFromRow);
}

export function blocksOf(ctx: Ctx, lessonId: string): Block[] {
  return (ctx.db.query('SELECT * FROM blocks WHERE lesson_id = ? ORDER BY position').all(lessonId) as BlockRow[]).map(blockFromRow);
}

export function getBlock(ctx: Ctx, id: string): Block | undefined {
  const row = ctx.db.query('SELECT * FROM blocks WHERE id = ?').get(id) as BlockRow | null;
  return row === null ? undefined : blockFromRow(row);
}

export function resolveBlock(ctx: Ctx, ref: string | undefined): Block {
  const block = getBlock(ctx, resolveId(ctx, 'block', ref));
  if (block === undefined) throw notFound(`no block "${ref}"`);
  return block;
}

export function lessonConcepts(ctx: Ctx, lessonId: string): Array<{key: string; title: string; role: ConceptRole; status: string}> {
  return ctx.db
    .query('SELECT c.key, c.title, lc.role, c.status FROM lesson_concepts lc JOIN concepts c ON c.id = lc.concept_id WHERE lc.lesson_id = ? ORDER BY c.position, c.key')
    .all(lessonId) as Array<{key: string; title: string; role: ConceptRole; status: string}>;
}

/** Whether the subject is ready for a lesson now, and if not, the real reason. */
export function readinessOf(ctx: Ctx, subject: Subject): Readiness {
  const today = ctx.today();
  const unfinished = unfinishedLessons(ctx, subject.id);
  return lessonReadiness({
    status: subject.status,
    days: subject.days,
    today,
    hour: ctx.hour(),
    readyHour: numberSetting(ctx.db, 'lesson_ready_hour'),
    hasLessonToday: lessonForDay(ctx, subject.id, today) !== undefined,
    unfinishedEarlier: unfinished.some(l => l.day < today),
  });
}

export function subjectFacts(ctx: Ctx, subjectId: string): SubjectFacts {
  const n = (key: string) => numberSetting(ctx.db, key);
  return {
    concepts: conceptStatuses(ctx, subjectId),
    assets: new Set((ctx.db.query('SELECT id FROM assets').all() as Array<{id: string}>).map(r => r.id)),
    limits: {lesson_max_blocks: n('lesson_max_blocks'), lesson_max_bytes: n('lesson_max_bytes'), widget_max_bytes: n('widget_max_bytes'), quiz_max_questions: n('quiz_max_questions')},
  };
}

export const invalid = (error: Invalid) => new AppError(error.message, EXIT_USAGE, {errors: error.issues});

function readLessonOrThrow(value: unknown, facts: SubjectFacts, raw?: string): LessonInput {
  try {
    return readLesson(value, facts, raw);
  } catch (error) {
    if (error instanceof Invalid) throw invalid(error);
    throw error;
  }
}

/** Things worth saying about a valid lesson: it runs long, or its estimate is off. */
function budgetWarnings(input: LessonInput, subject: Subject): string[] {
  const warnings: string[] = [];
  const blocksMinutes = Math.round(input.estimate_seconds / 60);
  const budget = Math.round(subject.minutes_per_day * 0.6);
  if (blocksMinutes > Math.max(budget * 1.25, budget + 2)) {
    warnings.push(`the blocks add up to about ${blocksMinutes} min; the lesson's share of ${subject.minutes_per_day} min/day is about ${budget}. Shorter beats complete.`);
  }
  if (Math.abs(input.estimated_minutes - blocksMinutes) > Math.max(3, blocksMinutes * 0.5)) {
    warnings.push(`estimated_minutes is ${input.estimated_minutes}, but the blocks add up to about ${blocksMinutes}`);
  }
  return warnings;
}

function insertContent(ctx: Ctx, lesson: {id: string; subject_id: string}, input: LessonInput, runId: string | null, keep: Map<string, Question>): Record<string, string> {
  const ids = conceptIds(ctx, lesson.subject_id);
  ctx.db.query('DELETE FROM lesson_concepts WHERE lesson_id = ?').run(lesson.id);
  for (const c of input.concepts) {
    ctx.db.query('INSERT INTO lesson_concepts (lesson_id, concept_id, role) VALUES (?, ?, ?)').run(lesson.id, ids.get(c.key)!, c.role);
  }
  const questionIds: Record<string, string> = {};
  for (const q of input.questions) {
    const existing = keep.get(q.ref!);
    questionIds[q.ref!] = existing === undefined
      ? insertQuestion(ctx, q, {subjectId: lesson.subject_id, lessonId: lesson.id, runId, conceptIds: ids, variantOf: null}).id
      : rewriteQuestion(ctx, existing, q, ids).question.id;
  }
  for (const [ref, question] of keep) if (questionIds[ref] === undefined) retireQuestion(ctx, question);
  ctx.db.query('DELETE FROM blocks WHERE lesson_id = ?').run(lesson.id);
  input.blocks.forEach((block, position) => {
    const body = block.type === 'question' ? {...block.body, question_id: questionIds[String(block.body['ref'])]} : block.body;
    ctx.db
      .query('INSERT INTO blocks (id, lesson_id, position, type, approach, concepts, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.newId(), lesson.id, position, block.type, block.approach, JSON.stringify(block.concepts), JSON.stringify(body));
  });
  return questionIds;
}

export interface SubmitResult {
  lesson: Lesson;
  existing: boolean;
  question_ids: Record<string, string>;
  estimate_minutes: number;
  warnings: string[];
}

function questionIdsOf(ctx: Ctx, lessonId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of blocksOf(ctx, lessonId)) {
    if (block.type === 'question' && typeof block.body['question_id'] === 'string') out[String(block.body['ref'])] = block.body['question_id'];
  }
  return out;
}

export function submitLesson(ctx: Ctx, subject: Subject, input: {day: string | undefined; run: string | undefined; lesson: unknown; raw?: string}): SubmitResult {
  const runId = runFor(ctx, input.run);
  const day = input.day ?? ctx.today();
  if (!isDay(day)) throw usageError(`--day must be a date like 2026-09-12, not "${day}"`);
  const existing = lessonForDay(ctx, subject.id, day);
  if (existing !== undefined) {
    return {lesson: existing, existing: true, question_ids: questionIdsOf(ctx, existing.id), estimate_minutes: existing.estimated_minutes, warnings: []};
  }
  const today = ctx.today();
  if (day !== today) throw failed(`lessons are written for today (${today}), not ${day}`, {today});
  const readiness = readinessOf(ctx, subject);
  if (!readiness.ready) throw failed(`${subject.title} isn't ready for a lesson: ${readiness.message}`, {why: readiness.why});

  const lessonInput = readLessonOrThrow(input.lesson, subjectFacts(ctx, subject.id), input.raw);
  const id = ctx.newId();
  ctx.db
    .query(
      `INSERT INTO lessons (id, subject_id, day, title, objectives, estimated_minutes, rationale, hypothesis, sources, run_id, added_by, state, added)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    )
    .run(id, subject.id, day, lessonInput.title, JSON.stringify(lessonInput.objectives), lessonInput.estimated_minutes, lessonInput.rationale, lessonInput.hypothesis, JSON.stringify(lessonInput.sources), runId, ctx.actor, ctx.now());
  const questionIds = insertContent(ctx, {id, subject_id: subject.id}, lessonInput, runId, new Map());
  ctx.event('lesson', id, {kind: 'added', subject_id: subject.id, day, title: lessonInput.title});
  return {lesson: getLesson(ctx, id)!, existing: false, question_ids: questionIds, estimate_minutes: Math.round(lessonInput.estimate_seconds / 60), warnings: budgetWarnings(lessonInput, subject)};
}

export function reviseLesson(ctx: Ctx, lesson: Lesson, input: {lesson: unknown; raw?: string}): SubmitResult {
  if (lesson.state !== 'ready') throw failed(`only a lesson that hasn't been opened can be revised; this one is ${lesson.state}. Fix single blocks with "lectio block fix".`);
  const subject = getSubject(ctx, lesson.subject_id)!;
  const lessonInput = readLessonOrThrow(input.lesson, subjectFacts(ctx, subject.id), input.raw);
  const before = {title: lesson.title, blocks: blocksOf(ctx, lesson.id).map(b => ({type: b.type, approach: b.approach, concepts: b.concepts, body: b.body}))};
  const keep = new Map<string, Question>();
  for (const [ref, questionId] of Object.entries(questionIdsOf(ctx, lesson.id))) {
    const question = getQuestion(ctx, questionId);
    if (question !== undefined) keep.set(ref, question);
  }
  ctx.db
    .query('UPDATE lessons SET title = ?, objectives = ?, estimated_minutes = ?, rationale = ?, hypothesis = ?, sources = ?, version = version + 1 WHERE id = ?')
    .run(lessonInput.title, JSON.stringify(lessonInput.objectives), lessonInput.estimated_minutes, lessonInput.rationale, lessonInput.hypothesis, JSON.stringify(lessonInput.sources), lesson.id);
  const questionIds = insertContent(ctx, lesson, lessonInput, lesson.run_id, keep);
  ctx.event('lesson', lesson.id, {kind: 'revised', version: lesson.version + 1, before});
  return {lesson: getLesson(ctx, lesson.id)!, existing: false, question_ids: questionIds, estimate_minutes: Math.round(lessonInput.estimate_seconds / 60), warnings: budgetWarnings(lessonInput, subject)};
}

// --- the learner's actions ---------------------------------------------------------

export function openLesson(ctx: Ctx, lesson: Lesson): Lesson {
  if (lesson.state !== 'ready') return lesson;
  ctx.db.query("UPDATE lessons SET state = 'open', opened = ? WHERE id = ?").run(ctx.now(), lesson.id);
  ctx.event('lesson', lesson.id, {kind: 'opened'});
  return getLesson(ctx, lesson.id)!;
}

export function finishLesson(ctx: Ctx, lesson: Lesson, input: {rate?: string | undefined; note?: string | undefined}): {lesson: Lesson; introduced: string[]; already: boolean} {
  if (lesson.state === 'skipped') throw failed('this lesson was skipped; it can no longer be finished');
  if (input.rate !== undefined && !(LESSON_RATINGS as readonly string[]).includes(input.rate)) throw usageError(`--rate must be one of ${LESSON_RATINGS.join(', ')}`);
  if (lesson.state === 'finished') return {lesson, introduced: [], already: true};
  const now = ctx.now();
  ctx.db.query("UPDATE lessons SET state = 'finished', finished = ?, opened = COALESCE(opened, ?) WHERE id = ?").run(now, now, lesson.id);
  const fresh = ctx.db
    .query("SELECT c.id, c.key FROM lesson_concepts lc JOIN concepts c ON c.id = lc.concept_id WHERE lc.lesson_id = ? AND lc.role = 'new' AND c.status IN ('planned', 'known')")
    .all(lesson.id) as Array<{id: string; key: string}>;
  for (const c of fresh) ctx.db.query("UPDATE concepts SET status = 'introduced', introduced = ?, changed = ? WHERE id = ?").run(now, now, c.id);
  if (input.rate !== undefined || (input.note ?? '').trim() !== '') addFeedback(ctx, {target: 'lesson', target_id: lesson.id, kind: input.rate ?? 'clear', note: input.note ?? ''});
  ctx.event('lesson', lesson.id, {kind: 'finished', introduced: fresh.map(c => c.key)});
  return {lesson: getLesson(ctx, lesson.id)!, introduced: fresh.map(c => c.key), already: false};
}

export function skipLesson(ctx: Ctx, lesson: Lesson, input: {reason: string | undefined; note?: string | undefined}): {lesson: Lesson; quizzes_skipped: string[]} {
  if (input.reason === undefined || !(SKIP_REASONS as readonly string[]).includes(input.reason)) throw usageError(`why skip it? --reason ${SKIP_REASONS.join('|')}`);
  if (lesson.state === 'finished') throw failed('this lesson is already finished');
  if (lesson.state === 'skipped') return {lesson, quizzes_skipped: []};
  ctx.db.query("UPDATE lessons SET state = 'skipped' WHERE id = ?").run(lesson.id);
  addFeedback(ctx, {target: 'lesson', target_id: lesson.id, kind: `skip_${input.reason}`, note: input.note ?? ''});
  const quizzes = (ctx.db.query("SELECT id FROM quizzes WHERE lesson_id = ? AND kind = 'daily' AND state IN ('ready', 'open')").all(lesson.id) as Array<{id: string}>).map(r => r.id);
  for (const id of quizzes) {
    ctx.db.query("UPDATE quizzes SET state = 'skipped' WHERE id = ?").run(id);
    ctx.event('quiz', id, {kind: 'skipped', with_lesson: lesson.id});
  }
  ctx.event('lesson', lesson.id, {kind: 'skipped', reason: input.reason});
  return {lesson: getLesson(ctx, lesson.id)!, quizzes_skipped: quizzes};
}

/** What the reader saw, sent in batches by the page. Every number is a delta. */
export function recordActivity(ctx: Ctx, lesson: Lesson, body: Record<string, unknown>): {active_seconds: number} {
  const node = Node.root(body);
  const seconds = node.get('active_seconds').optionalNumber({min: 0, max: 3600, integer: true}) ?? 0;
  const blocks = node.get('blocks').optionalArray({max: 200});
  if (node.issues.length > 0) throw usageError(node.issues.map(i => `${i.path}: ${i.message}`).join('; '));
  if (seconds > 0) ctx.db.query('UPDATE lessons SET active_seconds = active_seconds + ? WHERE id = ?').run(seconds, lesson.id);
  for (const b of blocks) {
    const id = b.get('id').string({max: 40});
    const block = id === undefined ? undefined : getBlock(ctx, id);
    if (block === undefined || block.lesson_id !== lesson.id) continue;
    const seen = Math.min(3600, Math.max(0, Math.floor(Number(b.get('seen_seconds').value ?? 0)) || 0));
    const interactions = Math.min(10_000, Math.max(0, Math.floor(Number(b.get('interactions').value ?? 0)) || 0));
    const errors = Math.min(1000, Math.max(0, Math.floor(Number(b.get('errors').value ?? 0)) || 0));
    const completed = b.get('completed').value === true ? 1 : 0;
    const lastError = typeof b.get('last_error').value === 'string' ? String(b.get('last_error').value).slice(0, 2000) : null;
    ctx.db
      .query('UPDATE blocks SET seen_seconds = seen_seconds + ?, interactions = interactions + ?, errors = errors + ?, completed = MAX(completed, ?), last_error = COALESCE(?, last_error) WHERE id = ?')
      .run(seen, interactions, errors, completed, lastError, block.id);
  }
  if (lesson.state === 'ready' && seconds > 0) openLesson(ctx, lesson);
  return {active_seconds: getLesson(ctx, lesson.id)!.active_seconds};
}

// --- the tutor's actions -----------------------------------------------------------

export function setVerdict(ctx: Ctx, lesson: Lesson, note: string | undefined): Lesson {
  const verdict = note?.trim() ?? '';
  if (verdict === '') throw usageError('what did the hypothesis turn out to be? --note "…"');
  if (lesson.hypothesis === null) throw failed('this lesson stated no hypothesis');
  ctx.db.query('UPDATE lessons SET verdict = ? WHERE id = ?').run(verdict, lesson.id);
  ctx.event('lesson', lesson.id, {kind: 'verdict', verdict});
  return getLesson(ctx, lesson.id)!;
}

export function fixBlock(ctx: Ctx, block: Block, input: {block: unknown; resolve: string[]; reply: string | undefined}): {block: Block; resolved: string[]} {
  if (block.type === 'question') throw usageError(`this block is an inline check; fix its question instead: lectio question fix ${String(block.body['question_id'] ?? '')}`);
  const lesson = getLesson(ctx, block.lesson_id)!;
  const node = Node.root(input.block);
  const read = readBlock(node, subjectFacts(ctx, lesson.subject_id), new Set());
  if (read === undefined || node.issues.length > 0) throw invalid(new Invalid('block', node.issues));
  if (read.type === 'question') throw usageError("a block can't become an inline check in a fix; revise the lesson while it's ready instead");
  const reply = input.reply?.trim() ?? '';
  if (input.resolve.length > 0 && reply === '') throw usageError('say what changed: --reply "…"');
  const before = {type: block.type, approach: block.approach, concepts: block.concepts, body: block.body};
  ctx.db
    .query('UPDATE blocks SET type = ?, approach = ?, concepts = ?, body = ?, version = version + 1, errors = 0, last_error = NULL WHERE id = ?')
    .run(read.type, read.approach, JSON.stringify(read.concepts), JSON.stringify(read.body), block.id);
  ctx.event('block', block.id, {kind: 'fixed', lesson_id: lesson.id, version: block.version + 1, before});
  const resolved = resolveFeedbackRows(ctx, input.resolve, {target: 'block', targetId: block.id, reply, resolution: 'fixed'});
  return {block: getBlock(ctx, block.id)!, resolved};
}

// --- views -------------------------------------------------------------------------

export interface BlockView extends Block {
  /** For inline checks: the question (as the learner sees it, or whole for agents). */
  question?: LearnerQuestion | Question;
  /** The latest answer to it in this lesson, if any. */
  answered?: Outcome | null;
  /** The terminal rendering. */
  text: string;
}

export interface LessonDetail extends Lesson {
  subject: {id: string; title: string};
  concepts: Array<{key: string; title: string; role: ConceptRole; status: string}>;
  blocks: BlockView[];
  quiz: {id: string; state: string; kind: string} | null;
  /** The blocks' own estimates, added up. */
  estimate_minutes: number;
  /** Reactions to the lesson and its blocks, with the tutor's replies. */
  feedback: Feedback[];
}

export function lessonDetail(ctx: Ctx, lesson: Lesson): LessonDetail {
  const subject = getSubject(ctx, lesson.subject_id)!;
  const full = ctx.isAgent;
  let seconds = 0;
  const blocks: BlockView[] = blocksOf(ctx, lesson.id).map(block => {
    const type = blockType(block.type);
    seconds += type?.estimateSeconds(block.body) ?? 0;
    const view: BlockView = {...block, text: type?.plainText(block.body) ?? `[${block.type}]`};
    if (block.type === 'question' && typeof block.body['question_id'] === 'string') {
      const question = getQuestion(ctx, block.body['question_id']);
      if (question !== undefined) {
        view.question = full ? question : learnerView(question);
        const attempt = latestAttempt(ctx, question.id, {lessonId: lesson.id});
        view.answered = attempt === undefined ? null : outcomeOf(attempt, question);
      }
    }
    return view;
  });
  const quiz = ctx.db.query("SELECT id, state, kind FROM quizzes WHERE lesson_id = ? AND kind IN ('daily', 'placement') ORDER BY added DESC LIMIT 1").get(lesson.id) as {id: string; state: string; kind: string} | null;
  const ids = [lesson.id, ...blocks.map(b => b.id)];
  const feedback = ctx.db.query(`SELECT * FROM feedback WHERE target IN ('lesson', 'block') AND target_id IN (${ids.map(() => '?').join(', ')}) ORDER BY at`).all(...ids) as Feedback[];
  return {...lesson, subject: {id: subject.id, title: subject.title}, concepts: lessonConcepts(ctx, lesson.id), blocks, quiz, estimate_minutes: Math.max(1, Math.round(seconds / 60)), feedback};
}

export function requireLessonOf(ctx: Ctx, subjectId: string, ref: string): Lesson {
  const lesson = resolveLesson(ctx, ref);
  if (lesson.subject_id !== subjectId) throw new AppError(`lesson ${lesson.id} belongs to another subject`, EXIT_ERROR);
  return lesson;
}
