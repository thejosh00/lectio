/**
 * Resolving what a person or agent typed — an id, or a unique prefix of one — into a row
 * id, the way git resolves a short hash.
 */
import {AppError, EXIT_USAGE, notFound} from '../core/errors.ts';
import {foldAmbiguous, resolveIdPrefix} from '../core/id.ts';
import type {Ctx} from './context.ts';

const TABLES = {subject: 'subjects', lesson: 'lessons', block: 'blocks', question: 'questions', quiz: 'quizzes', attempt: 'attempts', feedback: 'feedback', run: 'agent_runs'} as const;
export type RefKind = keyof typeof TABLES;

export function resolveId(ctx: Ctx, kind: RefKind, ref: string | undefined): string {
  if (ref === undefined || ref.trim() === '') throw new AppError(`which ${kind}? give its id`, EXIT_USAGE);
  const needle = foldAmbiguous(ref);
  const table = TABLES[kind];
  const exact = ctx.db.query(`SELECT id FROM ${table} WHERE id = ?`).get(needle) as {id: string} | null;
  if (exact !== null) return exact.id;
  if (needle.length < 4) throw notFound(`no ${kind} "${ref}"`);
  const ids = (ctx.db.query(`SELECT id FROM ${table} WHERE id LIKE ? LIMIT 20`).all(`${needle}%`) as Array<{id: string}>).map(r => r.id);
  const resolved = resolveIdPrefix(ids, needle);
  if (resolved.kind === 'ok') return resolved.id;
  if (resolved.kind === 'ambiguous') throw new AppError(`"${ref}" matches more than one ${kind}`, EXIT_USAGE, {candidates: resolved.candidates});
  throw notFound(`no ${kind} "${ref}"`);
}
