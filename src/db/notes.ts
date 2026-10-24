/**
 * The tutor's working documents, versioned: `learner` (how this person learns, across
 * subjects) and `subject:<id>` (the plan for one subject). The learner can read and edit
 * them. Nothing is overwritten: every change is a new version, so the learner's own
 * edits stay in the history and their lines can always be told apart.
 */
import {failed, usageError} from '../core/errors.ts';
import type {NoteVersion} from '../core/types.ts';
import {byteLength} from '../core/validate.ts';
import type {Ctx} from './context.ts';
import {numberSetting} from './settings.ts';

export const LEARNER_SCOPE = 'learner';
export const subjectScope = (subjectId: string) => `subject:${subjectId}`;

export function latestNote(ctx: Ctx, scope: string): NoteVersion | null {
  return (ctx.db.query('SELECT * FROM note_versions WHERE scope = ? ORDER BY version DESC LIMIT 1').get(scope) as NoteVersion | null) ?? null;
}

export function noteHistory(ctx: Ctx, scope: string): NoteVersion[] {
  return ctx.db.query('SELECT * FROM note_versions WHERE scope = ? ORDER BY version DESC').all(scope) as NoteVersion[];
}

export function setNote(
  ctx: Ctx,
  scope: string,
  body: string,
  note: string,
  options: {cap?: 'notes_max_bytes' | 'playbook_max_bytes'; restoredFrom?: number} = {},
): {note: NoteVersion; changed: boolean} {
  const cap = options.cap ?? 'notes_max_bytes';
  const max = numberSetting(ctx.db, cap);
  const size = byteLength(body);
  if (size > max) throw failed(`it is ${size} bytes; the cap is ${max} (${cap}). Make it more concise: replace, don't append.`);
  if (ctx.isAgent && note.trim() === '') throw usageError('say what changed and why: --note "…"');
  const latest = latestNote(ctx, scope);
  if (latest !== null && latest.body === body) return {note: latest, changed: false};
  const version = (latest?.version ?? 0) + 1;
  ctx.db
    .query('INSERT INTO note_versions (scope, version, body, actor, note, at, restored_from) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(scope, version, body, ctx.actor, note.trim(), ctx.now(), options.restoredFrom ?? null);
  ctx.event('note', scope, {kind: 'changed', scope, version, note: note.trim()});
  return {note: latestNote(ctx, scope)!, changed: true};
}

/**
 * Which lines of the latest version the learner wrote. A line belongs to whoever first
 * wrote it in the unbroken run of versions that kept it, so the tutor can see what it
 * must never contradict. A version that restores an earlier one gives the lines it brings
 * back the owners they had there: restoring the tutor's words doesn't make them yours.
 */
export function learnerLines(history: readonly Pick<NoteVersion, 'version' | 'body' | 'actor' | 'restored_from'>[]): string[] {
  const ordered = [...history].sort((a, b) => a.version - b.version);
  const ownersAt = new Map<number, Map<string, string>>();
  let owners = new Map<string, string>();
  for (const version of ordered) {
    const restored = version.restored_from === null ? undefined : ownersAt.get(version.restored_from);
    const next = new Map<string, string>();
    for (const line of version.body.split('\n').map(l => l.trim()).filter(l => l !== '')) {
      next.set(line, owners.get(line) ?? restored?.get(line) ?? version.actor);
    }
    owners = next;
    ownersAt.set(version.version, next);
  }
  return [...owners].filter(([, actor]) => actor === 'you').map(([line]) => line);
}

export interface NoteView {
  scope: string;
  body: string;
  version: number;
  actor: string | null;
  note: string;
  at: string | null;
  learner_lines: string[];
}

export function noteView(ctx: Ctx, scope: string): NoteView {
  const latest = latestNote(ctx, scope);
  return {
    scope,
    body: latest?.body ?? '',
    version: latest?.version ?? 0,
    actor: latest?.actor ?? null,
    note: latest?.note ?? '',
    at: latest?.at ?? null,
    learner_lines: learnerLines(noteHistory(ctx, scope)),
  };
}
