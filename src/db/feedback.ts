/**
 * The learner's reactions, one tap each, and the tutor's replies to them.
 *
 * Agents can't create feedback: that would be the tutor grading itself. The tutor may
 * write `reply` and `resolved` on existing rows — answering an ask, or saying it fixed a
 * flag.
 */
import {AppError, EXIT_USAGE, failed, notFound, usageError} from '../core/errors.ts';
import {FEEDBACK_TARGETS, FIX_FLAGS, feedbackProblem, isFeedbackTarget, type FeedbackTarget} from '../core/feedbackKinds.ts';
import {isResolution, RESOLUTIONS, type Feedback, type Resolution} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {resolveId, type RefKind} from './refs.ts';
import {resolveSubject} from './subjects.ts';

export function getFeedback(ctx: Ctx, id: string): Feedback | undefined {
  return (ctx.db.query('SELECT * FROM feedback WHERE id = ?').get(id) as Feedback | null) ?? undefined;
}

export function resolveFeedback(ctx: Ctx, ref: string | undefined): Feedback {
  const row = getFeedback(ctx, resolveId(ctx, 'feedback', ref));
  if (row === undefined) throw notFound(`no feedback "${ref}"`);
  return row;
}

/** Store a reaction. The caller has checked the target exists and who is asking. */
export function addFeedback(ctx: Ctx, input: {target: FeedbackTarget; target_id: string; kind: string; note: string}): Feedback {
  const note = input.note.trim();
  const problem = feedbackProblem(input.target, input.kind, note);
  if (problem !== undefined) throw usageError(problem);
  const id = ctx.newId();
  ctx.db.query('INSERT INTO feedback (id, target, target_id, kind, note, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.target, input.target_id, input.kind, note, ctx.actor, ctx.now());
  ctx.event('feedback', id, {kind: input.kind, target: input.target, target_id: input.target_id});
  return getFeedback(ctx, id)!;
}

const TARGET_REF: Record<FeedbackTarget, RefKind> = {lesson: 'lesson', block: 'block', question: 'question', attempt: 'attempt', quiz: 'quiz', subject: 'subject'};

/** A reaction to something by its (possibly abbreviated) id. Disputes go through `dispute`. */
export function createFeedback(ctx: Ctx, input: {target: string | undefined; target_id: string | undefined; kind: string | undefined; note: string | undefined}): Feedback {
  if (!isFeedbackTarget(input.target)) throw usageError(`what is it about? one of ${FEEDBACK_TARGETS.join(', ')}`);
  if (input.kind === undefined) throw usageError('which reaction?');
  if (input.target === 'attempt') throw usageError('dispute an attempt with "lectio dispute <attempt>"');
  const targetId = input.target === 'subject' ? resolveSubject(ctx, input.target_id).id : resolveId(ctx, TARGET_REF[input.target], input.target_id);
  return addFeedback(ctx, {target: input.target, target_id: targetId, kind: input.kind, note: input.note ?? ''});
}

export function listFeedback(ctx: Ctx, filter: {target?: string; targetId?: string; kind?: string; since?: string; limit?: number} = {}): Feedback[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter.target !== undefined) {
    where.push('target = ?');
    params.push(filter.target);
  }
  if (filter.targetId !== undefined) {
    where.push('target_id = ?');
    params.push(filter.targetId);
  }
  if (filter.kind !== undefined) {
    where.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.since !== undefined) {
    where.push('at >= ?');
    params.push(filter.since);
  }
  params.push(filter.limit ?? 500);
  return ctx.db.query(`SELECT * FROM feedback ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY at DESC LIMIT ?`).all(...params) as Feedback[];
}

/** Flags still waiting for the tutor: wrong, broken, wrong_key, ambiguous, dispute. */
export function unresolvedFlags(ctx: Ctx): Feedback[] {
  const kinds = [...FIX_FLAGS];
  return ctx.db.query(`SELECT * FROM feedback WHERE resolved IS NULL AND kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY at`).all(...kinds) as Feedback[];
}

export function unansweredAsks(ctx: Ctx): Feedback[] {
  return ctx.db.query("SELECT * FROM feedback WHERE kind IN ('ask', 'comment') AND reply IS NULL AND resolved IS NULL ORDER BY at").all() as Feedback[];
}

export function replyTo(ctx: Ctx, feedback: Feedback, input: {body: string | undefined; resolved: string | undefined}): Feedback {
  const body = input.body?.trim() ?? '';
  if (body === '') throw usageError('what is the reply? --body "…"');
  if (body.length > 8000) throw usageError('the reply is too long (8000 characters at most)');
  const resolved: Resolution = input.resolved === undefined ? (feedback.kind === 'ask' ? 'answered' : 'noted') : (input.resolved as Resolution);
  if (!isResolution(resolved)) throw usageError(`--resolved must be one of ${RESOLUTIONS.join(', ')}`);
  ctx.db.query('UPDATE feedback SET reply = ?, resolved = ?, replied_at = ? WHERE id = ?').run(body, resolved, ctx.now(), feedback.id);
  ctx.event('feedback', feedback.id, {kind: 'replied', resolved, target: feedback.target, target_id: feedback.target_id});
  return getFeedback(ctx, feedback.id)!;
}

/**
 * Resolve flags as part of a fix. Each must be about the thing fixed (`matches` decides:
 * a question's flags include disputes on its attempts).
 */
export function resolveFeedbackRows(
  ctx: Ctx,
  refs: readonly string[],
  input: {target: string; targetId: string; reply: string; resolution: Resolution; matches?: (row: Feedback) => boolean},
): string[] {
  const done: string[] = [];
  for (const ref of refs) {
    const row = resolveFeedback(ctx, ref);
    const about = input.matches?.(row) ?? (row.target === input.target && row.target_id === input.targetId);
    if (!about) throw new AppError(`feedback ${row.id} is about ${row.target} ${row.target_id}, not this ${input.target}`, EXIT_USAGE);
    if (row.resolved !== null) continue;
    ctx.db.query('UPDATE feedback SET reply = ?, resolved = ?, replied_at = ? WHERE id = ?').run(input.reply, input.resolution, ctx.now(), row.id);
    ctx.event('feedback', row.id, {kind: 'replied', resolved: input.resolution, target: row.target, target_id: row.target_id});
    done.push(row.id);
  }
  return done;
}

export function requireOpen(row: Feedback): void {
  if (row.resolved !== null) throw failed(`feedback ${row.id} is already resolved (${row.resolved})`);
}
