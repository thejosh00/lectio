/**
 * Resolving what a person or agent typed — an id, or a unique prefix of one — into a row
 * id, the way git resolves a short hash.
 */
import {AppError, EXIT_USAGE, notFound} from '../core/errors.ts';
import {foldAmbiguous, resolveIdPrefix} from '../core/id.ts';
import type {Ctx} from './context.ts';

const TABLES = {subject: 'subjects', lesson: 'lessons', block: 'blocks', question: 'questions', quiz: 'quizzes', attempt: 'attempts', feedback: 'feedback', run: 'agent_runs'} as const;
export type RefKind = keyof typeof TABLES;

/**
 * Rows a caller who can't see checkups never resolves, not even by prefix: to them an
 * exam's quiz, questions, answers and the examiner's runs don't exist (M12).
 */
const HIDDEN_EXAM_ROWS: Partial<Record<RefKind, string>> = {
  question: "status != 'exam'",
  quiz: "kind != 'exam'",
  attempt: "context != 'exam'",
  run: "actor != 'agent:examiner'",
};

export function resolveId(ctx: Ctx, kind: RefKind, ref: string | undefined): string {
  if (ref === undefined || ref.trim() === '') throw new AppError(`which ${kind}? give its id`, EXIT_USAGE);
  const needle = foldAmbiguous(ref);
  const table = TABLES[kind];
  const hidden = ctx.seesExams ? undefined : HIDDEN_EXAM_ROWS[kind];
  const visible = hidden === undefined ? '' : ` AND ${hidden}`;
  const exact = ctx.db.query(`SELECT id FROM ${table} WHERE id = ?${visible}`).get(needle) as {id: string} | null;
  if (exact !== null) return exact.id;
  if (needle.length < 4) throw notFound(`no ${kind} "${ref}"`);
  const ids = (ctx.db.query(`SELECT id FROM ${table} WHERE id LIKE ?${visible} LIMIT 20`).all(`${needle}%`) as Array<{id: string}>).map(r => r.id);
  const resolved = resolveIdPrefix(ids, needle);
  if (resolved.kind === 'ok') return resolved.id;
  if (resolved.kind === 'ambiguous') throw new AppError(`"${ref}" matches more than one ${kind}`, EXIT_USAGE, {candidates: resolved.candidates});
  throw notFound(`no ${kind} "${ref}"`);
}
