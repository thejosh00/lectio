/**
 * Every question ever asked. A question is written with a lesson (an inline check) or a
 * quiz, keeps its id when it is fixed (its version goes up), and is retired rather than
 * deleted, so every attempt keeps pointing at what was asked.
 */
import {AppError, EXIT_USAGE, notFound} from '../core/errors.ts';
import type {QuestionInput} from '../core/submission.ts';
import type {Figure} from '../blocks/picture.ts';
import type {Question} from '../core/types.ts';
import {questionType} from '../questions/index.ts';
import {parseJson, type Ctx} from './context.ts';
import {resolveId} from './refs.ts';

interface QuestionRow extends Omit<Question, 'body' | 'hints' | 'concepts' | 'figure' | 'answer_figure'> {
  body: string;
  hints: string;
  figure: string | null;
  answer_figure: string | null;
}

const figureJson = (figure: Figure | null) => (figure === null ? null : JSON.stringify(figure));

function conceptKeysOf(ctx: Ctx, questionId: string): string[] {
  return (
    ctx.db
      .query('SELECT c.key FROM question_concepts qc JOIN concepts c ON c.id = qc.concept_id WHERE qc.question_id = ? ORDER BY c.position, c.key')
      .all(questionId) as Array<{key: string}>
  ).map(r => r.key);
}

export function questionFromRow(ctx: Ctx, row: QuestionRow): Question {
  return {
    ...row,
    body: parseJson<Record<string, unknown>>(row.body, {}),
    hints: parseJson<string[]>(row.hints, []),
    concepts: conceptKeysOf(ctx, row.id),
    figure: row.figure === null ? null : parseJson<Figure | null>(row.figure, null),
    answer_figure: row.answer_figure === null ? null : parseJson<Figure | null>(row.answer_figure, null),
  };
}

export function getQuestion(ctx: Ctx, id: string): Question | undefined {
  const row = ctx.db.query('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | null;
  return row === null ? undefined : questionFromRow(ctx, row);
}

export function resolveQuestion(ctx: Ctx, ref: string | undefined): Question {
  const question = getQuestion(ctx, resolveId(ctx, 'question', ref));
  if (question === undefined) throw notFound(`no question "${ref}"`);
  return question;
}

export function questionsOfLesson(ctx: Ctx, lessonId: string): Question[] {
  return (ctx.db.query('SELECT * FROM questions WHERE lesson_id = ? ORDER BY added, id').all(lessonId) as QuestionRow[]).map(row => questionFromRow(ctx, row));
}

/** Concept ids for submitted keys; the keys were validated against the subject already. */
function linkConcepts(ctx: Ctx, questionId: string, keys: readonly string[], ids: ReadonlyMap<string, string>): void {
  ctx.db.query('DELETE FROM question_concepts WHERE question_id = ?').run(questionId);
  for (const key of keys) {
    const conceptId = ids.get(key);
    if (conceptId !== undefined) ctx.db.query('INSERT OR IGNORE INTO question_concepts (question_id, concept_id) VALUES (?, ?)').run(questionId, conceptId);
  }
}

export function checkVariant(ctx: Ctx, subjectId: string, variantOf: string | null, path: string): string | null {
  if (variantOf === null) return null;
  const id = (() => {
    try {
      return resolveId(ctx, 'question', variantOf);
    } catch {
      return undefined;
    }
  })();
  const original = id === undefined ? undefined : getQuestion(ctx, id);
  if (original === undefined || original.subject_id !== subjectId) {
    throw new AppError(`${path}.variant_of: no question "${variantOf}" in this subject`, EXIT_USAGE, {errors: [{path: `${path}.variant_of`, message: `no question "${variantOf}" in this subject`}]});
  }
  return original.id;
}

export function insertQuestion(
  ctx: Ctx,
  input: QuestionInput,
  where: {subjectId: string; lessonId: string | null; runId: string | null; conceptIds: ReadonlyMap<string, string>; variantOf: string | null},
): Question {
  const id = ctx.newId();
  const now = ctx.now();
  ctx.db
    .query(
      `INSERT INTO questions (id, subject_id, lesson_id, type, aim, prompt, body, explanation, hints, difficulty, variant_of, run_id, added_by, status, added, changed, figure, answer_figure)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      id,
      where.subjectId,
      where.lessonId,
      input.type,
      input.aim,
      input.prompt,
      JSON.stringify(input.body),
      input.explanation,
      JSON.stringify(input.hints),
      input.difficulty,
      where.variantOf,
      where.runId,
      ctx.actor,
      now,
      now,
      figureJson(input.figure),
      figureJson(input.answer_figure),
    );
  linkConcepts(ctx, id, input.concepts, where.conceptIds);
  return getQuestion(ctx, id)!;
}

/** Replace a question's content. Its version goes up only if something changed. */
export function rewriteQuestion(ctx: Ctx, question: Question, input: QuestionInput, conceptIds: ReadonlyMap<string, string>): {question: Question; changed: boolean} {
  const before = {type: question.type, aim: question.aim, prompt: question.prompt, body: question.body, explanation: question.explanation, hints: question.hints, difficulty: question.difficulty, concepts: question.concepts, figure: question.figure, answer_figure: question.answer_figure};
  const after = {type: input.type, aim: input.aim, prompt: input.prompt, body: input.body, explanation: input.explanation, hints: input.hints, difficulty: input.difficulty, concepts: input.concepts, figure: input.figure, answer_figure: input.answer_figure};
  if (JSON.stringify(before) === JSON.stringify(after)) return {question, changed: false};
  ctx.db
    .query('UPDATE questions SET type = ?, aim = ?, prompt = ?, body = ?, explanation = ?, hints = ?, difficulty = ?, figure = ?, answer_figure = ?, version = version + 1, changed = ?, status = ? WHERE id = ?')
    .run(
      input.type,
      input.aim,
      input.prompt,
      JSON.stringify(input.body),
      input.explanation,
      JSON.stringify(input.hints),
      input.difficulty,
      figureJson(input.figure),
      figureJson(input.answer_figure),
      ctx.now(),
      question.status === 'exam' ? 'exam' : 'active',
      question.id,
    );
  linkConcepts(ctx, question.id, input.concepts, conceptIds);
  ctx.event('question', question.id, {kind: 'rewritten', version: question.version + 1, before});
  return {question: getQuestion(ctx, question.id)!, changed: true};
}

export function retireQuestion(ctx: Ctx, question: Question): Question {
  if (question.status === 'retired') return question;
  ctx.db.query("UPDATE questions SET status = 'retired', changed = ? WHERE id = ?").run(ctx.now(), question.id);
  ctx.event('question', question.id, {kind: 'retired'});
  return getQuestion(ctx, question.id)!;
}

/** A question as the learner sees it before answering: no key, no tags, no explanation. */
export interface LearnerQuestion {
  id: string;
  type: string;
  prompt: string;
  body: Record<string, unknown>;
  hints: string[];
  graded_by: 'app' | 'self' | 'widget';
  disputable: boolean;
  version: number;
  concepts: string[];
  /** The picture it asks about; its answer's picture comes only with the answer. */
  figure: Figure | null;
}

export function learnerView(question: Question): LearnerQuestion {
  const type = questionType(question.type);
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    body: type === undefined ? {} : type.learnerBody(question.body),
    hints: question.hints,
    graded_by: type?.gradedBy ?? 'app',
    disputable: type?.disputable ?? false,
    version: question.version,
    concepts: question.concepts,
    figure: question.figure,
  };
}

/** What the reveal shows after an answer: the key, the explanation, and the answer as text. */
export function revealOf(question: Question): {key: Record<string, unknown>; answer_text: string; explanation: string} {
  const type = questionType(question.type);
  return {
    key: type === undefined ? {} : type.reveal(question.body),
    answer_text: type === undefined ? '' : type.answerText(question.body),
    explanation: question.explanation,
  };
}
