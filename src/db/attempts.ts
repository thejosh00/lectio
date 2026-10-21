/**
 * Every answer the learner gives — the single most important table.
 *
 * Each attempt records enough for the tutor to see what works and change course: the
 * score, how sure they were (given with the answer, before the reveal), how long it
 * took, hints used, which wrong idea they picked, how long since they last met its
 * concepts, and whether it counted toward memory. Only the learner writes attempts.
 */
import {AppError, EXIT_USAGE, failed, usageError} from '../core/errors.ts';
import {hoursBetween} from '../core/time.ts';
import {CONFIDENCES, isConfidence, type Attempt, type AttemptContext, type ItemRole, type Question} from '../core/types.ts';
import {Node} from '../core/validate.ts';
import {questionType} from '../questions/index.ts';
import {SELF_GRADES} from '../questions/freeResponse.ts';
import {attemptFromRow, getAttempt, outcomeOf, type AttemptRow, type Outcome} from './attemptRows.ts';
import type {Ctx} from './context.ts';
import {addFeedback} from './feedback.ts';
import {blocksOf, getLesson, openLesson, resolveLesson} from './lessons.ts';
import {refreshMemory} from './memory.ts';
import {getQuestion, resolveQuestion} from './questions.ts';
import {maybeFinishQuiz, openQuiz, progressOf, quizItems, resolveQuiz, type QuizProgress} from './quizzes.ts';
import {resolveId} from './refs.ts';

export function resolveAttempt(ctx: Ctx, ref: string | undefined): Attempt {
  const attempt = getAttempt(ctx, resolveId(ctx, 'attempt', ref));
  if (attempt === undefined) throw new AppError(`no attempt "${ref}"`, 3);
  return attempt;
}

function conceptIdsOf(ctx: Ctx, questionId: string): string[] {
  return (ctx.db.query('SELECT concept_id FROM question_concepts WHERE question_id = ?').all(questionId) as Array<{concept_id: string}>).map(r => r.concept_id);
}

/** Hours since the learner last met any of these concepts, in a lesson or an attempt. */
function gapHours(ctx: Ctx, conceptIds: string[], now: string): number | null {
  if (conceptIds.length === 0) return null;
  const marks = conceptIds.map(() => '?').join(', ');
  const lesson = ctx.db
    .query(
      `SELECT MAX(COALESCE(l.finished, l.opened)) AS at FROM lesson_concepts lc JOIN lessons l ON l.id = lc.lesson_id
       WHERE lc.concept_id IN (${marks}) AND COALESCE(l.finished, l.opened) IS NOT NULL AND COALESCE(l.finished, l.opened) <= ?`,
    )
    .get(...conceptIds, now) as {at: string | null};
  const attempt = ctx.db
    .query(`SELECT MAX(a.at) AS at FROM attempts a JOIN question_concepts qc ON qc.question_id = a.question_id WHERE qc.concept_id IN (${marks}) AND a.at <= ?`)
    .get(...conceptIds, now) as {at: string | null};
  const last = [lesson.at, attempt.at].filter((x): x is string => x !== null).sort().at(-1);
  return last === undefined ? null : Math.round(hoursBetween(last, now) * 100) / 100;
}

export interface AnswerInput {
  question: string | undefined;
  lesson?: string | undefined;
  quiz?: string | undefined;
  answer: unknown;
  shown_order?: unknown;
  confidence: string | undefined;
  hints_used?: number | undefined;
  seconds?: number | undefined;
}

export interface AnswerResult {
  attempt: Attempt;
  outcome: Outcome;
  /** For quiz answers: where the quiz stands now. */
  quiz: {id: string; state: string; progress: QuizProgress} | null;
}

export function answer(ctx: Ctx, input: AnswerInput): AnswerResult {
  const question = resolveQuestion(ctx, input.question);
  const type = questionType(question.type);
  if (type === undefined) throw failed(`"${question.type}" questions can't be answered here`);
  if (!isConfidence(input.confidence)) throw usageError(`how sure are you? confidence must be one of ${CONFIDENCES.join(', ')}`);
  if ((input.lesson === undefined) === (input.quiz === undefined)) throw usageError('answer in a lesson (an inline check) or in a quiz: give one of them');

  let context: AttemptContext;
  let lessonId: string | null = null;
  let quizId: string | null = null;
  let role: ItemRole | null = null;
  if (input.lesson !== undefined) {
    const lesson = resolveLesson(ctx, input.lesson);
    const inLesson = blocksOf(ctx, lesson.id).some(b => b.type === 'question' && b.body['question_id'] === question.id);
    if (!inLesson) throw usageError(`question ${question.id} isn't an inline check in lesson ${lesson.id}`);
    if (lesson.state === 'skipped') throw failed('this lesson was skipped');
    openLesson(ctx, lesson);
    context = 'lesson';
    lessonId = lesson.id;
  } else {
    const quiz = resolveQuiz(ctx, input.quiz);
    const item = quizItems(ctx, quiz.id).find(i => i.question_id === question.id);
    if (item === undefined) throw usageError(`question ${question.id} isn't in quiz ${quiz.id}`);
    if (quiz.state === 'finished') throw failed('this quiz is finished');
    openQuiz(ctx, quiz);
    context = quiz.kind === 'practice' ? 'practice' : 'quiz';
    quizId = quiz.id;
    lessonId = quiz.lesson_id;
    role = item.role;
  }

  const read = type.readAnswer(input.answer, question.body, 'answer');
  if (!read.ok) throw new AppError(read.issues.map(i => `${i.path}: ${i.message}`).join('; '), EXIT_USAGE, {errors: read.issues});

  let shownOrder: string[] | null = null;
  const ids = type.orderIds(question.body);
  if (ids !== null && input.shown_order !== undefined && input.shown_order !== null) {
    const node = Node.root(input.shown_order, 'shown_order');
    const order = node.stringArray({max: ids.length});
    if (order === undefined || order.length !== ids.length || new Set(order).size !== ids.length || !order.every(id => ids.includes(id))) {
      throw usageError(`shown_order must list ${ids.join(', ')} in the order they were shown`);
    }
    shownOrder = order;
  }
  const hints = input.hints_used ?? 0;
  if (!Number.isInteger(hints) || hints < 0 || hints > question.hints.length) throw usageError(`hints_used must be 0–${question.hints.length}`);
  const seconds = Math.min(3600, Math.max(0, Math.round(input.seconds ?? 0)));

  const graded = type.grade(question.body, read.value);
  const now = ctx.now();
  const previous = (
    context === 'lesson'
      ? ctx.db.query("SELECT COUNT(*) AS n FROM attempts WHERE question_id = ? AND lesson_id = ? AND context = 'lesson'").get(question.id, lessonId)
      : ctx.db.query('SELECT COUNT(*) AS n FROM attempts WHERE question_id = ? AND quiz_id = ?').get(question.id, quizId)
  ) as {n: number};
  const concepts = conceptIdsOf(ctx, question.id);
  const id = ctx.newId();
  ctx.db
    .query(
      `INSERT INTO attempts (id, question_id, question_version, context, lesson_id, quiz_id, role, attempt_no, answer, shown_order, score, graded_by,
         confidence, hints_used, seconds, misconception, gap_hours, counts_for_memory, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      question.id,
      question.version,
      context,
      lessonId,
      quizId,
      role,
      previous.n + 1,
      JSON.stringify(read.value),
      shownOrder === null ? null : JSON.stringify(shownOrder),
      graded.score,
      graded.score === null ? null : type.gradedBy,
      input.confidence,
      hints,
      seconds,
      graded.misconception,
      gapHours(ctx, concepts, now),
      now,
    );
  refreshMemory(ctx, concepts);
  ctx.event('attempt', id, {kind: 'answered', question_id: question.id, context, score: graded.score});
  if (quizId !== null) maybeFinishQuiz(ctx, quizId);
  const attempt = getAttempt(ctx, id)!;
  return {attempt, outcome: outcomeOf(attempt, question), quiz: quizStatus(ctx, quizId)};
}

function quizStatus(ctx: Ctx, quizId: string | null): AnswerResult['quiz'] {
  if (quizId === null) return null;
  const quiz = resolveQuiz(ctx, quizId);
  return {id: quiz.id, state: quiz.state, progress: progressOf(ctx, quiz)};
}

/** Got it · partly · missed it, for a free response. */
export function selfGrade(ctx: Ctx, attempt: Attempt, grade: string | undefined): AnswerResult {
  const question = getQuestion(ctx, attempt.question_id)!;
  if (questionType(question.type)?.gradedBy !== 'self') throw usageError('only free responses are graded by you');
  if (grade === undefined || !Object.hasOwn(SELF_GRADES, grade)) throw usageError(`grade must be one of ${Object.keys(SELF_GRADES).join(', ')}`);
  const score = SELF_GRADES[grade as keyof typeof SELF_GRADES];
  ctx.db.query("UPDATE attempts SET score = ?, graded_by = 'self' WHERE id = ?").run(score, attempt.id);
  refreshMemory(ctx, conceptIdsOf(ctx, question.id));
  ctx.event('attempt', attempt.id, {kind: 'self_graded', score});
  if (attempt.quiz_id !== null) maybeFinishQuiz(ctx, attempt.quiz_id);
  const updated = getAttempt(ctx, attempt.id)!;
  return {attempt: updated, outcome: outcomeOf(updated, question), quiz: quizStatus(ctx, attempt.quiz_id)};
}

/**
 * "I was right": the score becomes 1 and the question is flagged for the tutor. An answer
 * counted as right shows no misconception, so a tag it matched no longer counts.
 */
export function dispute(ctx: Ctx, attempt: Attempt, note: string | undefined): AnswerResult {
  const question = getQuestion(ctx, attempt.question_id)!;
  if (!(questionType(question.type)?.disputable ?? false)) throw usageError(`${question.type.replace('_', ' ')} answers can't be disputed; flag the question instead (lectio rate question ${question.id} wrong_key)`);
  if (attempt.graded_by === 'disputed') return {attempt, outcome: outcomeOf(attempt, question), quiz: quizStatus(ctx, attempt.quiz_id)};
  if (attempt.score === null || attempt.score >= 1) throw failed('only a miss can be disputed');
  ctx.db.query("UPDATE attempts SET score = 1, graded_by = 'disputed', misconception = NULL WHERE id = ?").run(attempt.id);
  addFeedback(ctx, {target: 'attempt', target_id: attempt.id, kind: 'dispute', note: note ?? ''});
  refreshMemory(ctx, conceptIdsOf(ctx, question.id));
  ctx.event('attempt', attempt.id, {kind: 'disputed', question_id: question.id});
  const updated = getAttempt(ctx, attempt.id)!;
  return {attempt: updated, outcome: outcomeOf(updated, question), quiz: quizStatus(ctx, attempt.quiz_id)};
}

/** The tutor's re-grade of a free response. Both grades are kept; the learner's counts. */
export function agentGrade(ctx: Ctx, attempt: Attempt, input: {score: number | undefined; note: string | undefined}): Attempt {
  const question = getQuestion(ctx, attempt.question_id)!;
  if (questionType(question.type)?.gradedBy !== 'self') throw usageError('only free responses are re-graded; the app grades the rest');
  if (input.score === undefined || !Number.isFinite(input.score) || input.score < 0 || input.score > 1) throw usageError('--score must be a number from 0 to 1');
  const note = input.note?.trim() ?? '';
  if (note === '') throw usageError('say what they got or missed: --note "…"');
  ctx.db.query('UPDATE attempts SET agent_score = ?, agent_note = ? WHERE id = ?').run(input.score, note, attempt.id);
  ctx.event('attempt', attempt.id, {kind: 'agent_graded', score: input.score});
  return getAttempt(ctx, attempt.id)!;
}

/** Free responses the tutor hasn't re-graded yet. */
export function awaitingRegrade(ctx: Ctx): Attempt[] {
  return (
    ctx.db
      .query("SELECT a.* FROM attempts a JOIN questions q ON q.id = a.question_id WHERE q.type = 'free_response' AND a.agent_score IS NULL AND a.void = 0 ORDER BY a.at")
      .all() as AttemptRow[]
  ).map(attemptFromRow);
}

/** The question was wrong: its attempts so far leave stats and memory. */
export function voidAttempts(ctx: Ctx, question: Question): number {
  const changed = ctx.db.query('UPDATE attempts SET void = 1 WHERE question_id = ? AND void = 0').run(question.id).changes;
  if (changed > 0) {
    refreshMemory(ctx, conceptIdsOf(ctx, question.id));
    ctx.event('question', question.id, {kind: 'attempts_voided', count: changed});
  }
  return changed;
}

export function lessonOf(ctx: Ctx, attempt: Attempt) {
  return attempt.lesson_id === null ? undefined : getLesson(ctx, attempt.lesson_id);
}
