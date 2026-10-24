/**
 * Quizzes: today's questions plus reviews brought back from earlier days.
 *
 * `ready` → `open` → `finished`. A daily quiz whose lesson has new items opens only once
 * that lesson is finished. When the tutor submits a new daily quiz for a subject, any
 * earlier one still `ready` becomes `superseded` (its reviews are stale); a started quiz
 * is never superseded. Practice is the one quiz the app assembles itself.
 */
import {AppError, EXIT_USAGE, failed, notFound, usageError} from '../core/errors.ts';
import {Invalid, readQuiz, type QuizItemInput} from '../core/submission.ts';
import {isDay} from '../core/time.ts';
import {isQuizKind, type ItemRole, type Lesson, type Question, type Quiz, type QuizKind, type Subject} from '../core/types.ts';
import {SECONDS_PER_QUESTION} from '../blocks/question.ts';
import {attemptFromRow, outcomeOf, type AttemptRow, type Outcome} from './attemptRows.ts';
import {conceptIds} from './concepts.ts';
import type {Ctx} from './context.ts';
import {getLesson, invalid, requireLessonOf, subjectFacts} from './lessons.ts';
import {dueConcepts} from './memory.ts';
import {checkVariant, getQuestion, insertQuestion, learnerView, type LearnerQuestion} from './questions.ts';
import {resolveId} from './refs.ts';
import {runFor} from './runs.ts';
import {numberSetting} from './settings.ts';
import {getSubject} from './subjects.ts';

export function getQuiz(ctx: Ctx, id: string): Quiz | undefined {
  return (ctx.db.query('SELECT * FROM quizzes WHERE id = ?').get(id) as Quiz | null) ?? undefined;
}

export function resolveQuiz(ctx: Ctx, ref: string | undefined): Quiz {
  const quiz = getQuiz(ctx, resolveId(ctx, 'quiz', ref));
  if (quiz === undefined) throw notFound(`no quiz "${ref}"`);
  return quiz;
}

export interface QuizItem {
  position: number;
  question_id: string;
  role: ItemRole;
  /** The tutor's prediction for the first try; agents only see it before an answer. */
  predicted: number | null;
}

export function quizItems(ctx: Ctx, quizId: string): QuizItem[] {
  return ctx.db.query('SELECT position, question_id, role, predicted FROM quiz_items WHERE quiz_id = ? ORDER BY position').all(quizId) as QuizItem[];
}

/** First attempts at each question in the quiz, by question id. */
function firstAttempts(ctx: Ctx, quizId: string): Map<string, AttemptRow> {
  const rows = ctx.db.query('SELECT * FROM attempts WHERE quiz_id = ? AND attempt_no = 1').all(quizId) as AttemptRow[];
  return new Map(rows.map(r => [r.question_id, r]));
}

/** Why a quiz can't be opened yet, or undefined if it can. */
export function openBlocker(ctx: Ctx, quiz: Quiz): string | undefined {
  if (quiz.state === 'superseded') return 'A newer quiz replaced this one.';
  if (quiz.state === 'skipped') return 'It was skipped with its lesson.';
  if (quiz.lesson_id === null || quiz.kind !== 'daily') return undefined;
  const hasNew = quizItems(ctx, quiz.id).some(i => i.role === 'new');
  const lesson = getLesson(ctx, quiz.lesson_id);
  if (hasNew && lesson !== undefined && lesson.state !== 'finished') return `Opens once you finish the lesson, “${lesson.title}”.`;
  return undefined;
}

export interface QuizProgress {
  total: number;
  answered: number;
  graded: number;
  /** Mean first-try score over graded items, 0–1; null before any. */
  score: number | null;
  by_role: Record<string, {total: number; answered: number; right: number}>;
}

export function progressOf(ctx: Ctx, quiz: Quiz): QuizProgress {
  const items = quizItems(ctx, quiz.id);
  const firsts = firstAttempts(ctx, quiz.id);
  const byRole: Record<string, {total: number; answered: number; right: number}> = {};
  let answered = 0;
  let graded = 0;
  let sum = 0;
  for (const item of items) {
    const role = (byRole[item.role] ??= {total: 0, answered: 0, right: 0});
    role.total++;
    const attempt = firsts.get(item.question_id);
    if (attempt === undefined) continue;
    answered++;
    role.answered++;
    if (attempt.score !== null) {
      graded++;
      sum += attempt.score;
      if (attempt.score >= 1) role.right++;
    }
  }
  return {total: items.length, answered, graded, score: graded === 0 ? null : sum / graded, by_role: byRole};
}

export interface QuizItemView {
  position: number;
  role: ItemRole;
  question: LearnerQuestion | Question;
  answered: Outcome | null;
  /** Agents only: the prediction the item was written with. The learner sees it in `answered`, once graded. */
  predicted?: number | null;
}

export interface QuizDetail extends Quiz {
  subject: {id: string; title: string};
  lesson: {id: string; title: string; state: string} | null;
  items: QuizItemView[];
  progress: QuizProgress;
  /** Why it can't be opened yet; null when it can. */
  blocked: string | null;
  estimate_minutes: number;
  /** The concepts its questions touch. */
  concepts: Array<{key: string; title: string}>;
}

export function quizDetail(ctx: Ctx, quiz: Quiz): QuizDetail {
  const subject = getSubject(ctx, quiz.subject_id)!;
  const lesson = quiz.lesson_id === null ? undefined : getLesson(ctx, quiz.lesson_id);
  const firsts = firstAttempts(ctx, quiz.id);
  const items: QuizItemView[] = [];
  for (const item of quizItems(ctx, quiz.id)) {
    const question = getQuestion(ctx, item.question_id);
    if (question === undefined) continue;
    const attempt = firsts.get(question.id);
    items.push({
      position: item.position,
      role: item.role,
      question: ctx.isAgent ? question : learnerView(question),
      answered: attempt === undefined ? null : outcomeOf(ctx, attemptFromRow(attempt), question),
      ...(ctx.isAgent ? {predicted: item.predicted} : {}),
    });
  }
  const concepts = ctx.db
    .query(
      `SELECT DISTINCT c.key, c.title, c.position FROM quiz_items qi JOIN question_concepts qc ON qc.question_id = qi.question_id
       JOIN concepts c ON c.id = qc.concept_id WHERE qi.quiz_id = ? ORDER BY c.position`,
    )
    .all(quiz.id) as Array<{key: string; title: string}>;
  return {
    ...quiz,
    subject: {id: subject.id, title: subject.title},
    lesson: lesson === undefined ? null : {id: lesson.id, title: lesson.title, state: lesson.state},
    items,
    progress: progressOf(ctx, quiz),
    blocked: openBlocker(ctx, quiz) ?? null,
    estimate_minutes: Math.max(1, Math.round((items.length * SECONDS_PER_QUESTION) / 60)),
    concepts: concepts.map(c => ({key: c.key, title: c.title})),
  };
}

export function openQuiz(ctx: Ctx, quiz: Quiz): Quiz {
  if (quiz.state === 'open' || quiz.state === 'finished') return quiz;
  const blocker = openBlocker(ctx, quiz);
  if (blocker !== undefined) throw failed(`this quiz can't be opened yet. ${blocker}`);
  ctx.db.query("UPDATE quizzes SET state = 'open', opened = ? WHERE id = ?").run(ctx.now(), quiz.id);
  ctx.event('quiz', quiz.id, {kind: 'opened'});
  return getQuiz(ctx, quiz.id)!;
}

/** Finish a quiz once every item has a graded first try. */
export function maybeFinishQuiz(ctx: Ctx, quizId: string): boolean {
  const quiz = getQuiz(ctx, quizId);
  if (quiz === undefined || quiz.state !== 'open') return false;
  const progress = progressOf(ctx, quiz);
  if (progress.graded < progress.total) return false;
  ctx.db.query("UPDATE quizzes SET state = 'finished', finished = ? WHERE id = ?").run(ctx.now(), quiz.id);
  ctx.event('quiz', quiz.id, {kind: 'finished', score: progress.score});
  return true;
}

export interface QuizSubmitResult {
  quiz: Quiz;
  existing: boolean;
  question_ids: string[];
  superseded: string[];
  warnings: string[];
}

/** Things worth saying about a valid quiz's predictions: missing ones, and new items aimed off target. */
function predictionWarnings(items: readonly QuizItemInput[], kind: QuizKind, target: number): string[] {
  if (kind === 'placement') return [];
  const warnings: string[] = [];
  const missing = items.filter(i => i.predicted === null).length;
  if (missing > 0) warnings.push(`${missing} of ${items.length} items have no predict: give each your honest probability that the first try scores 1`);
  const fresh = items.filter(i => i.role === 'new' && i.predicted !== null);
  if (fresh.length > 0) {
    const mean = fresh.reduce((sum, i) => sum + i.predicted!, 0) / fresh.length;
    if (Math.abs(mean - target) > 0.1) {
      warnings.push(`you predict ${Math.round(mean * 100)}% on today's new items against a target of ${Math.round(target * 100)}%: change the questions (${mean > target ? 'harder' : 'easier'}), not the predictions`);
    }
  }
  return warnings;
}

export function submitQuiz(ctx: Ctx, subject: Subject, input: {day: string | undefined; run: string | undefined; kind: string | undefined; quiz: unknown}): QuizSubmitResult {
  const runId = runFor(ctx, input.run);
  const kind = (input.kind ?? 'daily') as QuizKind;
  if (!isQuizKind(kind) || kind === 'practice') throw usageError('--kind must be daily or placement (practice quizzes are assembled by the app)');
  const day = input.day ?? ctx.today();
  if (!isDay(day)) throw usageError(`--day must be a date like 2026-09-12, not "${day}"`);
  const existing = ctx.db.query("SELECT * FROM quizzes WHERE subject_id = ? AND day = ? AND kind IN ('daily', 'placement')").get(subject.id, day) as Quiz | null;
  if (existing !== null) return {quiz: existing, existing: true, question_ids: quizItems(ctx, existing.id).map(i => i.question_id), superseded: [], warnings: []};
  const today = ctx.today();
  if (day !== today) throw failed(`quizzes are written for today (${today}), not ${day}`, {today});
  if (subject.status !== 'active') throw failed(`${subject.title} is ${subject.status}`);

  let quizInput;
  try {
    quizInput = readQuiz(input.quiz, subjectFacts(ctx, subject.id), kind);
  } catch (error) {
    if (error instanceof Invalid) throw invalid(error);
    throw error;
  }
  let lesson: Lesson | undefined;
  if (quizInput.lesson !== null) {
    lesson = requireLessonOf(ctx, subject.id, quizInput.lesson);
    if (lesson.day !== day) throw failed(`the quiz is for ${day}, but lesson ${lesson.id} is for ${lesson.day}`);
    if (lesson.state === 'skipped') throw failed('that lesson was skipped');
  }
  // Existing questions must be this subject's, active, and asked once.
  const errors: Array<{path: string; message: string}> = [];
  const resolvedExisting = new Map<number, string>();
  const seen = new Set<string>();
  quizInput.items.forEach((item: QuizItemInput, i) => {
    if (item.existing === undefined) return;
    let question: Question | undefined;
    try {
      question = getQuestion(ctx, resolveId(ctx, 'question', item.existing));
    } catch {
      question = undefined;
    }
    if (question === undefined || question.subject_id !== subject.id) errors.push({path: `items[${i}].existing`, message: `no question "${item.existing}" in this subject`});
    else if (question.status !== 'active') errors.push({path: `items[${i}].existing`, message: `question ${question.id} is retired`});
    else if (seen.has(question.id)) errors.push({path: `items[${i}].existing`, message: `question ${question.id} is already in this quiz`});
    else {
      seen.add(question.id);
      resolvedExisting.set(i, question.id);
    }
  });
  const variants = new Map<number, string | null>();
  quizInput.items.forEach((item, i) => {
    if (item.question === undefined) return;
    try {
      variants.set(i, checkVariant(ctx, subject.id, item.question.variant_of, `items[${i}].question`));
    } catch (error) {
      if (error instanceof AppError) errors.push(...((error.extra['errors'] as typeof errors | undefined) ?? [{path: `items[${i}].question.variant_of`, message: error.message}]));
      else throw error;
    }
  });
  if (errors.length > 0) {
    throw new AppError(`the quiz has ${errors.length === 1 ? 'a problem' : `${errors.length} problems`}: ${errors.map(e => `${e.path}: ${e.message}`).join('; ')}`, EXIT_USAGE, {errors});
  }

  const id = ctx.newId();
  ctx.db
    .query('INSERT INTO quizzes (id, subject_id, day, kind, lesson_id, rationale, run_id, added_by, state, added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, subject.id, day, kind, lesson?.id ?? null, quizInput.rationale.trim(), runId, ctx.actor, 'ready', ctx.now());
  const ids = conceptIds(ctx, subject.id);
  const questionIds: string[] = [];
  quizInput.items.forEach((item, position) => {
    const questionId =
      item.existing !== undefined
        ? resolvedExisting.get(position)!
        : insertQuestion(ctx, item.question, {subjectId: subject.id, lessonId: lesson?.id ?? null, runId, conceptIds: ids, variantOf: variants.get(position) ?? null}).id;
    ctx.db.query('INSERT INTO quiz_items (quiz_id, position, question_id, role, predicted) VALUES (?, ?, ?, ?, ?)').run(id, position, questionId, item.role, item.predicted);
    questionIds.push(questionId);
  });
  const superseded = (
    ctx.db.query("SELECT id FROM quizzes WHERE subject_id = ? AND kind = 'daily' AND state = 'ready' AND day < ?").all(subject.id, day) as Array<{id: string}>
  ).map(r => r.id);
  if (kind === 'daily') {
    for (const old of superseded) {
      ctx.db.query("UPDATE quizzes SET state = 'superseded' WHERE id = ?").run(old);
      ctx.event('quiz', old, {kind: 'superseded', by: id});
    }
  }
  ctx.event('quiz', id, {kind: 'added', subject_id: subject.id, day, quiz_kind: kind, items: questionIds.length});
  return {
    quiz: getQuiz(ctx, id)!,
    existing: false,
    question_ids: questionIds,
    superseded: kind === 'daily' ? superseded : [],
    warnings: predictionWarnings(quizInput.items, kind, numberSetting(ctx.db, 'target_accuracy')),
  };
}

/**
 * Practice: the one quiz the app assembles. For each due concept, earliest due first, one
 * active question tagged with it, preferring the one answered least recently. No
 * judgement is involved, so it needs no tutor.
 */
export function assemblePractice(ctx: Ctx, subject: Subject, max?: number): {quiz: Quiz | null; existing: boolean; due: number} {
  const cap = Math.min(max ?? numberSetting(ctx.db, 'practice_max'), numberSetting(ctx.db, 'practice_max'));
  const open = ctx.db.query("SELECT * FROM quizzes WHERE subject_id = ? AND kind = 'practice' AND state IN ('ready', 'open') ORDER BY added DESC LIMIT 1").get(subject.id) as Quiz | null;
  const due = dueConcepts(ctx, subject.id);
  if (open !== null) return {quiz: open, existing: true, due: due.length};
  const picked: string[] = [];
  for (const concept of due) {
    if (picked.length >= cap) break;
    const candidates = ctx.db
      .query(
        `SELECT q.id, (SELECT MAX(a.at) FROM attempts a WHERE a.question_id = q.id) AS last
         FROM questions q JOIN question_concepts qc ON qc.question_id = q.id
         WHERE qc.concept_id = ? AND q.status = 'active'
         ORDER BY last IS NOT NULL, last, q.added`,
      )
      .all(concept.concept_id) as Array<{id: string; last: string | null}>;
    const choice = candidates.find(c => !picked.includes(c.id));
    if (choice !== undefined) picked.push(choice.id);
  }
  if (picked.length === 0) return {quiz: null, existing: false, due: due.length};
  const id = ctx.newId();
  ctx.db
    .query("INSERT INTO quizzes (id, subject_id, day, kind, lesson_id, rationale, run_id, added_by, state, added) VALUES (?, ?, ?, 'practice', NULL, ?, NULL, ?, 'ready', ?)")
    .run(id, subject.id, ctx.today(), `${due.length} concept${due.length === 1 ? '' : 's'} due for review`, ctx.actor, ctx.now());
  picked.forEach((questionId, position) => ctx.db.query("INSERT INTO quiz_items (quiz_id, position, question_id, role) VALUES (?, ?, ?, 'review')").run(id, position, questionId));
  ctx.event('quiz', id, {kind: 'added', subject_id: subject.id, quiz_kind: 'practice', items: picked.length});
  return {quiz: getQuiz(ctx, id)!, existing: false, due: due.length};
}

/** Quizzes the learner should see for a subject: unfinished ones, and today's. */
export function visibleQuizzes(ctx: Ctx, subjectId: string): Quiz[] {
  return ctx.db
    .query("SELECT * FROM quizzes WHERE subject_id = ? AND (state IN ('ready', 'open') OR day = ?) AND state != 'superseded' ORDER BY day, added")
    .all(subjectId, ctx.today()) as Quiz[];
}

export function listQuizzes(ctx: Ctx, filter: {subjectId?: string; limit?: number}): Quiz[] {
  return (
    filter.subjectId === undefined
      ? ctx.db.query('SELECT * FROM quizzes ORDER BY day DESC, added DESC LIMIT ?').all(filter.limit ?? 100)
      : ctx.db.query('SELECT * FROM quizzes WHERE subject_id = ? ORDER BY day DESC, added DESC LIMIT ?').all(filter.subjectId, filter.limit ?? 100)
  ) as Quiz[];
}
