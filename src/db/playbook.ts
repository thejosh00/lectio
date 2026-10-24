/**
 * The living playbook (M13): how the tutor teaches, as a versioned document it edits
 * directly instead of waiting for a build. Each lesson records the version it was written
 * under, so outcomes can be compared by version. The learner sees every change the tutor
 * makes, as a diff, and can put an earlier version back in one tap; their own lines are
 * theirs, as in the notes. The tutor's rules (`rules.md`) stay a file only the learner
 * changes: the playbook never overrides them.
 */
import {failed, notFound, usageError} from '../core/errors.ts';
import {addDays, daysBetween} from '../core/time.ts';
import type {NoteVersion} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {getMark, setMark} from './database.ts';
import {latestNote, noteHistory, noteView, setNote, type NoteView} from './notes.ts';
import {numberSetting} from './settings.ts';

export const PLAYBOOK_SCOPE = 'playbook';
const SEEN = 'playbook_seen';

/** The version the tutor last changed, other than the seed it wrote into an empty playbook. */
function lastTutorChange(ctx: Ctx): NoteVersion | undefined {
  return noteHistory(ctx, PLAYBOOK_SCOPE).find(v => v.actor.startsWith('agent:') && v.version > 1);
}

export interface PlaybookView extends NoteView {
  /** The first day the tutor may change it again; null when it may now. */
  next_change_from: string | null;
}

export function playbookView(ctx: Ctx): PlaybookView {
  const last = lastTutorChange(ctx);
  const wait = numberSetting(ctx.db, 'playbook_min_days');
  const from = last === undefined ? null : addDays(ctx.dayOf(last.at), wait);
  return {...noteView(ctx, PLAYBOOK_SCOPE), next_change_from: from !== null && from > ctx.today() ? from : null};
}

/**
 * A new version. The tutor says why (what changed, the evidence, what should move) and
 * changes it at most every `playbook_min_days`, so each version runs long enough to be
 * judged; writing the first version (the seed) doesn't count. The learner may edit any time.
 */
export function setPlaybook(ctx: Ctx, body: string, note: string): {playbook: PlaybookView; changed: boolean} {
  if (ctx.isAgent && note.trim() === '') throw usageError('say what changed, the evidence, and what should move: --note "…"');
  if (ctx.isAgent && latestNote(ctx, PLAYBOOK_SCOPE) !== null) {
    const last = lastTutorChange(ctx);
    const wait = numberSetting(ctx.db, 'playbook_min_days');
    if (last !== undefined && daysBetween(ctx.dayOf(last.at), ctx.today()) < wait) {
      const from = addDays(ctx.dayOf(last.at), wait);
      throw failed(`you changed the playbook on ${ctx.dayOf(last.at)}; the next change is from ${from} (playbook_min_days), so each version runs long enough to judge`, {why: 'cooldown', next_change_from: from});
    }
  }
  const result = setNote(ctx, PLAYBOOK_SCOPE, body, note, {cap: 'playbook_max_bytes'});
  return {playbook: playbookView(ctx), changed: result.changed};
}

/** The learner puts an earlier version back. Its lines keep the owners they had then. */
export function revertPlaybook(ctx: Ctx, version: number | undefined, note: string | undefined): {playbook: PlaybookView; changed: boolean} {
  if (version === undefined) throw usageError('which version? lectio playbook revert <version>');
  const target = noteHistory(ctx, PLAYBOOK_SCOPE).find(v => v.version === version);
  if (target === undefined) throw notFound(`the playbook has no version ${version}`);
  const result = setNote(ctx, PLAYBOOK_SCOPE, target.body, note?.trim() || `restored v${version}`, {cap: 'playbook_max_bytes', restoredFrom: version});
  return {playbook: playbookView(ctx), changed: result.changed};
}

/** The tutor's latest change the learner hasn't looked at yet, for a line on Today; null if none. */
export function unseenPlaybookChange(ctx: Ctx): {version: number; note: string; at: string} | null {
  const latest = latestNote(ctx, PLAYBOOK_SCOPE);
  if (latest === null || !latest.actor.startsWith('agent:') || latest.version === 1) return null;
  const seen = Number(getMark(ctx.db, SEEN) ?? '0');
  return latest.version > seen ? {version: latest.version, note: latest.note, at: latest.at} : null;
}

export function markPlaybookSeen(ctx: Ctx): void {
  const latest = latestNote(ctx, PLAYBOOK_SCOPE);
  if (latest !== null) setMark(ctx.db, SEEN, String(latest.version));
}
