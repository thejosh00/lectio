/**
 * Two-arm lessons (M14): instead of choosing an approach and counting afterwards, the tutor
 * writes two versions of part of a lesson and the app picks which one the learner sees.
 *
 * The pick is a biased coin (Efron's): two to one toward the arm with fewer lessons so far,
 * even odds when they're level. That keeps an experiment balanced without making the next
 * arm predictable, so the tutor can't steer which concepts land in which arm. The pick
 * lives in its own table and is shown to agents only once the lesson is finished: the
 * same-day quiz is written blind.
 */
import {randomInt} from 'node:crypto';
import {failed, notFound, usageError} from '../core/errors.ts';
import type {ExperimentInput} from '../core/submission.ts';
import {parseJson, type Ctx} from './context.ts';

export interface Experiment {
  name: string;
  subject_id: string;
  arms: {a: string; b: string};
  status: 'open' | 'closed';
  verdict: string | null;
  opened: string;
  closed: string | null;
}

const fromRow = (row: Omit<Experiment, 'arms'> & {arms: string}): Experiment => ({...row, arms: parseJson<{a: string; b: string}>(row.arms, {a: '', b: ''})});

export function getExperiment(ctx: Ctx, name: string): Experiment | undefined {
  const row = ctx.db.query('SELECT * FROM experiments WHERE name = ?').get(name) as (Omit<Experiment, 'arms'> & {arms: string}) | null;
  return row === null ? undefined : fromRow(row);
}

export function listExperiments(ctx: Ctx, subjectId?: string): Experiment[] {
  return (
    subjectId === undefined ? ctx.db.query('SELECT * FROM experiments ORDER BY opened').all() : ctx.db.query('SELECT * FROM experiments WHERE subject_id = ? ORDER BY opened').all(subjectId)
  ).map(row => fromRow(row as Omit<Experiment, 'arms'> & {arms: string}));
}

/** The experiment a lesson names: opened on first use, and the same arms every time after. */
export function ensureExperiment(ctx: Ctx, subjectId: string, input: ExperimentInput): Experiment {
  const existing = getExperiment(ctx, input.name);
  if (existing === undefined) {
    ctx.db.query("INSERT INTO experiments (name, subject_id, arms, status, opened) VALUES (?, ?, ?, 'open', ?)").run(input.name, subjectId, JSON.stringify(input.arms), ctx.now());
    ctx.event('lesson', input.name, {kind: 'experiment_opened', subject_id: subjectId});
    return getExperiment(ctx, input.name)!;
  }
  if (existing.subject_id !== subjectId) throw failed(`experiment "${input.name}" belongs to another subject; give this one its own name`);
  if (existing.status === 'closed') throw failed(`experiment "${input.name}" is closed (${existing.verdict ?? 'no verdict'}); start a new one under a new name`);
  if (existing.arms.a !== input.arms.a || existing.arms.b !== input.arms.b) {
    throw failed(`experiment "${input.name}" compares a: "${existing.arms.a}" with b: "${existing.arms.b}"; use the same arms, or a new name for a different comparison`);
  }
  return existing;
}

/** Draw an arm for a lesson in an experiment: two to one toward the arm behind, even odds when level. */
export function drawArm(ctx: Ctx, name: string): 'a' | 'b' {
  const counts = ctx.db
    .query("SELECT la.arm, COUNT(*) AS n FROM lesson_arms la JOIN lessons l ON l.id = la.lesson_id WHERE l.experiment = ? AND l.state != 'skipped' GROUP BY la.arm")
    .all(name) as Array<{arm: string; n: number}>;
  const a = counts.find(c => c.arm === 'a')?.n ?? 0;
  const b = counts.find(c => c.arm === 'b')?.n ?? 0;
  if (a === b) return randomInt(2) === 0 ? 'a' : 'b';
  const behind = a < b ? 'a' : 'b';
  return randomInt(3) < 2 ? behind : behind === 'a' ? 'b' : 'a';
}

/** The arm a lesson's learner sees, or null outside an experiment. Never hand this to an agent before the lesson is finished. */
export function armOf(ctx: Ctx, lessonId: string): 'a' | 'b' | null {
  return ((ctx.db.query('SELECT arm FROM lesson_arms WHERE lesson_id = ?').get(lessonId) as {arm: 'a' | 'b'} | null)?.arm) ?? null;
}

export function setArm(ctx: Ctx, lessonId: string, arm: 'a' | 'b' | null): void {
  if (arm === null) ctx.db.query('DELETE FROM lesson_arms WHERE lesson_id = ?').run(lessonId);
  else ctx.db.query('INSERT INTO lesson_arms (lesson_id, arm) VALUES (?, ?) ON CONFLICT(lesson_id) DO UPDATE SET arm = excluded.arm').run(lessonId, arm);
}

export function closeExperiment(ctx: Ctx, name: string | undefined, verdict: string | undefined): Experiment {
  if (name === undefined || name.trim() === '') throw usageError('which experiment? lectio experiment close <name> --note "…"');
  const experiment = getExperiment(ctx, name.trim());
  if (experiment === undefined) throw notFound(`no experiment "${name}"`);
  const note = verdict?.trim() ?? '';
  if (note === '') throw usageError('what did it show, with numbers? --note "…"');
  if (experiment.status === 'closed') throw failed(`experiment "${experiment.name}" is already closed`);
  ctx.db.query("UPDATE experiments SET status = 'closed', verdict = ?, closed = ? WHERE name = ?").run(note, ctx.now(), experiment.name);
  ctx.event('lesson', experiment.name, {kind: 'experiment_closed', verdict: note});
  return getExperiment(ctx, experiment.name)!;
}
