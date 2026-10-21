/**
 * Subjects: what the learner wants to learn, in their words. Written by the learner only.
 */
import {AppError, EXIT_ERROR, EXIT_USAGE, notFound, usageError} from '../core/errors.ts';
import {foldAmbiguous} from '../core/id.ts';
import {DAYS_HELP, normalizeDays} from '../core/schedule.ts';
import {isLevel, LEVELS, SUBJECT_STATUSES, type Subject, type SubjectStatus} from '../core/types.ts';
import type {Ctx} from './context.ts';

export function getSubject(ctx: Ctx, id: string): Subject | undefined {
  return (ctx.db.query('SELECT * FROM subjects WHERE id = ?').get(id) as Subject | null) ?? undefined;
}

export function listSubjects(ctx: Ctx, options: {all?: boolean} = {}): Subject[] {
  const where = options.all === true ? '' : "WHERE status != 'archived'";
  return ctx.db.query(`SELECT * FROM subjects ${where} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, added`).all() as Subject[];
}

export function activeSubjects(ctx: Ctx): Subject[] {
  return ctx.db.query("SELECT * FROM subjects WHERE status = 'active' ORDER BY added").all() as Subject[];
}

/** By id, a unique id prefix, or its title (any case). */
export function resolveSubject(ctx: Ctx, ref: string | undefined): Subject {
  if (ref === undefined || ref.trim() === '') throw usageError('which subject? give its id or title');
  const exact = getSubject(ctx, foldAmbiguous(ref));
  if (exact !== undefined) return exact;
  const all = ctx.db.query('SELECT * FROM subjects').all() as Subject[];
  const byTitle = all.filter(s => s.title.toLowerCase() === ref.trim().toLowerCase());
  const live = byTitle.filter(s => s.status !== 'archived');
  if (live.length === 1) return live[0]!;
  if (byTitle.length === 1) return byTitle[0]!;
  const needle = foldAmbiguous(ref);
  const prefixed = needle.length >= 4 ? all.filter(s => s.id.startsWith(needle)) : [];
  if (prefixed.length === 1) return prefixed[0]!;
  if (prefixed.length > 1 || live.length > 1) {
    throw new AppError(`"${ref}" matches more than one subject`, EXIT_USAGE, {candidates: [...prefixed, ...live].map(s => `${s.id}  ${s.title}`)});
  }
  throw notFound(`no subject "${ref}"; "lectio subjects" lists them`);
}

export interface SubjectInput {
  title?: string | undefined;
  goal?: string | undefined;
  level?: string | undefined;
  minutes_per_day?: number | undefined;
  days?: string | undefined;
  note?: string | undefined;
}

function clean(input: SubjectInput): Partial<Omit<Subject, 'id' | 'status' | 'added' | 'changed'>> {
  const out: Partial<Omit<Subject, 'id' | 'status' | 'added' | 'changed'>> = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title === '') throw usageError('a subject needs a title');
    if (title.length > 120) throw usageError('the title is too long (120 characters at most)');
    out.title = title;
  }
  if (input.goal !== undefined) {
    if (input.goal.length > 1000) throw usageError('the goal is too long (1000 characters at most)');
    out.goal = input.goal.trim();
  }
  if (input.level !== undefined) {
    if (!isLevel(input.level)) throw usageError(`--level must be one of ${LEVELS.join(', ')}`);
    out.level = input.level;
  }
  if (input.minutes_per_day !== undefined) {
    if (!Number.isInteger(input.minutes_per_day) || input.minutes_per_day < 5 || input.minutes_per_day > 240) throw usageError('--minutes must be a whole number from 5 to 240');
    out.minutes_per_day = input.minutes_per_day;
  }
  if (input.days !== undefined) {
    const days = normalizeDays(input.days);
    if (days === undefined) throw usageError(`--days must be ${DAYS_HELP}`);
    out.days = days;
  }
  if (input.note !== undefined) {
    if (input.note.length > 2000) throw usageError('the note is too long (2000 characters at most)');
    out.note = input.note.trim();
  }
  return out;
}

export function addSubject(ctx: Ctx, input: SubjectInput): Subject {
  const fields = clean({level: 'new', ...input});
  if (fields.title === undefined) throw usageError('a subject needs a title: lectio subject add "<title>" --goal "…"');
  const clash = listSubjects(ctx).find(s => s.title.toLowerCase() === fields.title!.toLowerCase());
  if (clash !== undefined) throw new AppError(`there is already a subject called "${clash.title}" (${clash.id})`, EXIT_ERROR, {subject: clash});
  const id = ctx.newId();
  const now = ctx.now();
  ctx.db
    .query('INSERT INTO subjects (id, title, goal, level, minutes_per_day, days, note, status, added, changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, fields.title, fields.goal ?? '', fields.level ?? 'new', fields.minutes_per_day ?? 15, fields.days ?? 'daily', fields.note ?? '', 'active', now, now);
  ctx.event('subject', id, {kind: 'added', title: fields.title});
  return getSubject(ctx, id)!;
}

export function editSubject(ctx: Ctx, subject: Subject, input: SubjectInput): {subject: Subject; changed: string[]} {
  const fields = clean(input);
  const changed = Object.entries(fields).filter(([key, value]) => subject[key as keyof Subject] !== value).map(([key]) => key);
  if (changed.length === 0) return {subject, changed};
  if (fields.title !== undefined && fields.title.toLowerCase() !== subject.title.toLowerCase()) {
    const clash = listSubjects(ctx).find(s => s.id !== subject.id && s.title.toLowerCase() === fields.title!.toLowerCase());
    if (clash !== undefined) throw new AppError(`there is already a subject called "${clash.title}"`, EXIT_ERROR);
  }
  const sets = changed.map(key => `${key} = ?`).join(', ');
  ctx.db.query(`UPDATE subjects SET ${sets}, changed = ? WHERE id = ?`).run(...changed.map(key => fields[key as keyof typeof fields] as string | number), ctx.now(), subject.id);
  ctx.event('subject', subject.id, {kind: 'edited', fields: changed});
  return {subject: getSubject(ctx, subject.id)!, changed};
}

export function setSubjectStatus(ctx: Ctx, subject: Subject, status: string): Subject {
  if (!(SUBJECT_STATUSES as readonly string[]).includes(status)) throw usageError(`status must be one of ${SUBJECT_STATUSES.join(', ')}`);
  if (subject.status === status) return subject;
  ctx.db.query('UPDATE subjects SET status = ?, changed = ? WHERE id = ?').run(status, ctx.now(), subject.id);
  ctx.event('subject', subject.id, {kind: 'status', from: subject.status, to: status as SubjectStatus});
  return getSubject(ctx, subject.id)!;
}
