/**
 * What the tutor's context says about improving lectio itself (§11): open proposals to
 * support rather than duplicate, what shipped since the last run, what is waiting for an
 * outcome, and whether the weekly retrospective is due.
 */
import {daysBetween} from '../core/time.ts';
import type {Run} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {proposalsContext} from './proposals.ts';
import {numberSetting} from './settings.ts';

export function retroDue(ctx: Ctx): boolean {
  const days = numberSetting(ctx.db, 'retro_days');
  const lastRetro = ctx.db.query('SELECT started FROM agent_runs WHERE actor = ? AND retro = 1 ORDER BY started DESC LIMIT 1').get(ctx.actor) as {started: string} | null;
  const first = ctx.db.query('SELECT started FROM agent_runs WHERE actor = ? ORDER BY started LIMIT 1').get(ctx.actor) as {started: string} | null;
  const anchor = lastRetro?.started ?? first?.started;
  if (anchor === undefined) return false;
  return daysBetween(ctx.dayOf(anchor), ctx.today()) >= days;
}

export function improvementsContext(ctx: Ctx, lastRun: Run | undefined) {
  return {...proposalsContext(ctx, lastRun), retro_due: retroDue(ctx)};
}
