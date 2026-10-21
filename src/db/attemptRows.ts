/**
 * Attempts as rows and as JSON, and what the reveal shows for one. Shared by the lesson
 * and quiz views (which show earlier answers again) and by answering itself.
 */
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
  agent_score: number | null;
  agent_note: string | null;
}

export function outcomeOf(attempt: Attempt, question: Question): Outcome {
  const type = questionType(question.type);
  let why: string | null = null;
  let detail: Record<string, boolean> | null = null;
  if (type !== undefined) {
    const read = type.readAnswer(attempt.answer, question.body, 'answer');
    if (read.ok) {
      const graded = type.grade(question.body, read.value);
      why = graded.why;
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
    agent_score: attempt.agent_score,
    agent_note: attempt.agent_note,
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
