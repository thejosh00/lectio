/**
 * Tutor runs: one row per run, so the learner can see what the tutor did and why.
 *
 * One open run per actor. A run left open by a crash is resumed if it is recent (so a
 * retried wake carries on where it left off) and closed as failed if it is stale.
 */
import {AppError, EXIT_USAGE, notFound, usageError} from '../core/errors.ts';
import {isRunOutcome, RUN_OUTCOMES, type Run} from '../core/types.ts';
import {parseJson, type Ctx} from './context.ts';
import {resolveId} from './refs.ts';

const STALE_HOURS = 12;

interface RunRow extends Omit<Run, 'made' | 'retro'> {
  made: string;
  retro: number;
}

export const runFromRow = (row: RunRow): Run => ({...row, made: parseJson<Record<string, number>>(row.made, {}), retro: row.retro === 1});

export function getRun(ctx: Ctx, id: string): Run | undefined {
  const row = ctx.db.query('SELECT * FROM agent_runs WHERE id = ?').get(id.trim()) as RunRow | null;
  return row === null ? undefined : runFromRow(row);
}

export function openRunOf(ctx: Ctx): Run | undefined {
  const row = ctx.db.query('SELECT * FROM agent_runs WHERE actor = ? AND finished IS NULL ORDER BY started DESC LIMIT 1').get(ctx.actor) as RunRow | null;
  return row === null ? undefined : runFromRow(row);
}

export function startRun(ctx: Ctx, contractVersion: string): {run: Run; resumed: boolean} {
  const open = openRunOf(ctx);
  if (open !== undefined) {
    const staleBefore = new Date(new Date(ctx.now()).getTime() - STALE_HOURS * 3_600_000).toISOString();
    if (open.started >= staleBefore) return {run: open, resumed: true};
    ctx.db
      .query("UPDATE agent_runs SET finished = ?, outcome = 'failed', summary = CASE WHEN summary = '' THEN 'abandoned: never finished' ELSE summary END WHERE id = ?")
      .run(ctx.now(), open.id);
    ctx.event('run', open.id, {kind: 'abandoned'});
  }
  const id = ctx.newId();
  ctx.db.query('INSERT INTO agent_runs (id, actor, started, contract_version) VALUES (?, ?, ?, ?)').run(id, ctx.actor, ctx.now(), contractVersion);
  ctx.event('run', id, {kind: 'started'});
  return {run: getRun(ctx, id)!, resumed: false};
}

/** The caller's open run with this id, or a usage error saying what is wrong. */
export function requireOpenRun(ctx: Ctx, id: string | undefined): Run {
  if (id === undefined || id.trim() === '') throw usageError('which run? pass --run <run> from "lectio run start"');
  const run = getRun(ctx, resolveId(ctx, 'run', id));
  if (run === undefined) throw notFound(`no run "${id}"`);
  if (run.actor !== ctx.actor) throw new AppError(`run ${run.id} belongs to ${run.actor}`, EXIT_USAGE);
  if (run.finished !== null) throw new AppError(`run ${run.id} is already finished; start a new one`, EXIT_USAGE);
  return run;
}

/** An agent's writes name its run; the learner's don't need one. */
export function runFor(ctx: Ctx, id: string | undefined): string | null {
  if (!ctx.isAgent && (id === undefined || id.trim() === '')) return null;
  return requireOpenRun(ctx, id).id;
}

/** What the run made, counted from what is stored, so the log can't overstate it. */
function countMade(ctx: Ctx, runId: string): Record<string, number> {
  const count = (sql: string) => (ctx.db.query(sql).get(runId) as {n: number}).n;
  return {
    lessons: count('SELECT COUNT(*) AS n FROM lessons WHERE run_id = ?'),
    quizzes: count('SELECT COUNT(*) AS n FROM quizzes WHERE run_id = ?'),
    questions: count('SELECT COUNT(*) AS n FROM questions WHERE run_id = ?'),
    proposals: count('SELECT COUNT(*) AS n FROM proposals WHERE run_id = ?'),
  };
}

export function finishRun(ctx: Ctx, id: string, input: {outcome: string | undefined; made?: Record<string, unknown>; summary?: string; retro?: boolean}): Run {
  const run = requireOpenRun(ctx, id);
  if (!isRunOutcome(input.outcome)) throw usageError(`--outcome must be one of ${RUN_OUTCOMES.join(', ')}`);
  const summary = input.summary?.trim() ?? '';
  if (summary === '') throw usageError('say what the run saw, changed and why: --summary "…" (2–3 sentences)');
  const made: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.made ?? {})) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw usageError(`--made: "${key}" must be a whole number`);
    made[key] = value;
  }
  Object.assign(made, countMade(ctx, run.id));
  ctx.db
    .query('UPDATE agent_runs SET finished = ?, outcome = ?, made = ?, summary = ?, retro = ? WHERE id = ?')
    .run(ctx.now(), input.outcome, JSON.stringify(made), summary, input.retro === true ? 1 : 0, run.id);
  const finished = getRun(ctx, run.id)!;
  ctx.event('run', run.id, {kind: 'finished', outcome: finished.outcome, made, retro: finished.retro});
  return finished;
}

export function listRuns(ctx: Ctx, limit = 30, actor?: string): Run[] {
  const rows = actor === undefined
    ? (ctx.db.query('SELECT * FROM agent_runs ORDER BY started DESC LIMIT ?').all(limit) as RunRow[])
    : (ctx.db.query('SELECT * FROM agent_runs WHERE actor = ? ORDER BY started DESC LIMIT ?').all(actor, limit) as RunRow[]);
  return rows.map(runFromRow);
}

/** The last finished run of an actor, other than the one in progress. */
export function lastFinishedRun(ctx: Ctx, actor: string): Run | undefined {
  const row = ctx.db.query('SELECT * FROM agent_runs WHERE actor = ? AND finished IS NOT NULL ORDER BY started DESC LIMIT 1').get(actor) as RunRow | null;
  return row === null ? undefined : runFromRow(row);
}
