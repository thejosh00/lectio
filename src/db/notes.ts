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

export function setNote(ctx: Ctx, scope: string, body: string, note: string): {note: NoteVersion; changed: boolean} {
  const max = numberSetting(ctx.db, 'notes_max_bytes');
  const size = byteLength(body);
  if (size > max) throw failed(`the notes are ${size} bytes; the cap is ${max} (notes_max_bytes). Make them more concise: replace, don't append.`);
  if (ctx.isAgent && note.trim() === '') throw usageError('say what changed and why: --note "…"');
  const latest = latestNote(ctx, scope);
  if (latest !== null && latest.body === body) return {note: latest, changed: false};
  const version = (latest?.version ?? 0) + 1;
  ctx.db.query('INSERT INTO note_versions (scope, version, body, actor, note, at) VALUES (?, ?, ?, ?, ?, ?)').run(scope, version, body, ctx.actor, note.trim(), ctx.now());
  ctx.event('note', scope, {kind: 'changed', scope, version, note: note.trim()});
  return {note: latestNote(ctx, scope)!, changed: true};
}

/**
 * Which lines of the latest version the learner wrote. A line belongs to whoever first
 * wrote it in the unbroken run of versions that kept it, so the tutor can see what it
 * must never contradict.
 */
export function learnerLines(history: readonly NoteVersion[]): string[] {
  const ordered = [...history].sort((a, b) => a.version - b.version);
  let owners = new Map<string, string>();
  for (const version of ordered) {
    const next = new Map<string, string>();
    for (const line of version.body.split('\n').map(l => l.trim()).filter(l => l !== '')) {
      next.set(line, owners.get(line) ?? version.actor);
    }
    owners = next;
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
