/**
 * Attempts as rows and as JSON, and what the reveal shows for one. Shared by the lesson
 * and quiz views (which show earlier answers again) and by answering itself.
 */
import type {Figure} from '../blocks/picture.ts';
import type {Attempt, Question} from '../core/types.ts';
import {questionType} from '../questions/index.ts';
import {parseJson, type Ctx} from './context.ts';
import {revealOf} from './questions.ts';

export interface AttemptRow extends Omit<Attempt, 'answer' | 'shown_order' | 'counts_for_memory' | 'void'> {
  answer: string;
  shown_order: string | null;
  counts_for_memory: number;
  void: number;
}

export const attemptFromRow = (row: AttemptRow): Attempt => ({
  ...row,
  answer: parseJson<unknown>(row.answer, null),
  shown_order: parseJson<string[] | null>(row.shown_order, null),
  counts_for_memory: row.counts_for_memory === 1,
  void: row.void === 1,
});

export function getAttempt(ctx: Ctx, id: string): Attempt | undefined {
  const row = ctx.db.query('SELECT * FROM attempts WHERE id = ?').get(id) as AttemptRow | null;
  return row === null ? undefined : attemptFromRow(row);
}

/** The result of an answer, as the reader shows it after the learner commits. */
export interface Outcome {
  attempt_id: string;
  question_id: string;
  score: number | null;
  graded_by: string | null;
  confidence: string;
  answer: unknown;
  hints_used: number;
  at: string;
  /** Free responses wait for "got it / partly / missed it". */
  needs_self_grade: boolean;
  /** A typed answer marked wrong can be disputed ("I was right"). */
  disputable: boolean;
  misconception: string | null;
  why: string | null;
  detail: Record<string, boolean> | null;
  key: Record<string, unknown>;
  answer_text: string;
  explanation: string;
  /** The picture shown with the answer (M19). */
  answer_figure: Figure | null;
  agent_score: number | null;
  agent_note: string | null;
  /**
   * The tutor's prediction for this quiz item, shown only once the answer is graded (for a
   * free response, after the self-grade) so it can't sway the answer or the grade.
   */
  predicted: number | null;
}

/** The tutor's prediction for a quiz attempt's item, once the attempt is graded; null before, and outside quizzes. */
export function predictionFor(ctx: Ctx, attempt: Pick<Attempt, 'quiz_id' | 'question_id' | 'score'>): number | null {
  if (attempt.quiz_id === null || attempt.score === null) return null;
  const row = ctx.db.query('SELECT predicted FROM quiz_items WHERE quiz_id = ? AND question_id = ?').get(attempt.quiz_id, attempt.question_id) as {predicted: number | null} | null;
  return row?.predicted ?? null;
}

export function outcomeOf(ctx: Ctx, attempt: Attempt, question: Question): Outcome {
  const type = questionType(question.type);
  let why: string | null = null;
  let detail: Record<string, boolean> | null = null;
  if (type !== undefined) {
    const read = type.readAnswer(attempt.answer, question.body, 'answer');
    if (read.ok) {
      const graded = type.grade(question.body, read.value);
      // Counted as right, there is no "why not that one".
      why = attempt.graded_by === 'disputed' ? null : graded.why;
      detail = graded.detail;
    }
  }
  const reveal = revealOf(question);
  return {
    attempt_id: attempt.id,
    question_id: question.id,
    score: attempt.score,
    graded_by: attempt.graded_by,
    confidence: attempt.confidence,
    answer: attempt.answer,
    hints_used: attempt.hints_used,
    at: attempt.at,
    needs_self_grade: attempt.score === null && type?.gradedBy === 'self',
    disputable: (type?.disputable ?? false) && attempt.score !== null && attempt.score < 1 && attempt.graded_by === 'app',
    misconception: attempt.misconception,
    why,
    detail,
    key: reveal.key,
    answer_text: reveal.answer_text,
    explanation: reveal.explanation,
    answer_figure: question.answer_figure,
    agent_score: attempt.agent_score,
    agent_note: attempt.agent_note,
    predicted: predictionFor(ctx, attempt),
  };
}

/** The latest attempt at a question within a lesson or a quiz. */
export function latestAttempt(ctx: Ctx, questionId: string, where: {lessonId?: string; quizId?: string}): Attempt | undefined {
  const row =
    where.quizId !== undefined
      ? (ctx.db.query('SELECT * FROM attempts WHERE question_id = ? AND quiz_id = ? ORDER BY at DESC, attempt_no DESC LIMIT 1').get(questionId, where.quizId) as AttemptRow | null)
      : (ctx.db.query("SELECT * FROM attempts WHERE question_id = ? AND lesson_id = ? AND context = 'lesson' ORDER BY at DESC, attempt_no DESC LIMIT 1").get(questionId, where.lessonId ?? '') as AttemptRow | null);
  return row === null ? undefined : attemptFromRow(row);
}
