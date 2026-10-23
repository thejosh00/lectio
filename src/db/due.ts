/**
 * `lectio due`: whether the tutor has anything to do, and for which subjects.
 *
 * The otto check script runs this every hour and wakes the model only when it says yes:
 * a subject became ready for a lesson, a new subject needs a plan, a flag or ask is
 * waiting, or a build of one of its proposals is waiting for it to check. Most hours it
 * says no, and that costs nothing.
 */
import type {Feedback, Subject} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {unansweredAsks, unresolvedFlags} from './feedback.ts';
import {lessonForDay, readinessOf} from './lessons.ts';
import {tutorReviews} from './proposals.ts';
import {activeSubjects} from './subjects.ts';

export type DueWhy = 'needs_fix' | 'needs_reply' | 'needs_plan' | 'ready';
export type WaitWhy = 'unfinished_lesson' | 'not_scheduled_today' | 'before_ready_hour' | 'done_today';

export interface DueReport {
  due: boolean;
  subjects: Array<{id: string; title: string; why: DueWhy; reasons: DueWhy[]}>;
  waiting: Array<{id: string; title: string; why: WaitWhy; message: string}>;
  /** Builds of the tutor's proposals waiting for it to accept or send back. */
  reviews: Array<{number: number; title: string; status: string}>;
}

/** The subject a piece of feedback is ultimately about. */
export function subjectOfFeedback(ctx: Ctx, f: Pick<Feedback, 'target' | 'target_id'>): string | undefined {
  const one = (sql: string) => (ctx.db.query(sql).get(f.target_id) as {s: string} | null)?.s;
  switch (f.target) {
    case 'subject':
      return f.target_id;
    case 'lesson':
      return one('SELECT subject_id AS s FROM lessons WHERE id = ?');
    case 'block':
      return one('SELECT l.subject_id AS s FROM blocks b JOIN lessons l ON l.id = b.lesson_id WHERE b.id = ?');
    case 'question':
      return one('SELECT subject_id AS s FROM questions WHERE id = ?');
    case 'attempt':
      return one('SELECT q.subject_id AS s FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.id = ?');
    case 'quiz':
      return one('SELECT subject_id AS s FROM quizzes WHERE id = ?');
    default:
      return undefined;
  }
}

/** Blocks with errors the tutor hasn't fixed yet (widgets report their own). */
export function blocksWithErrors(ctx: Ctx, subjectId?: string): Array<{id: string; lesson_id: string; subject_id: string; type: string; errors: number; last_error: string | null}> {
  return ctx.db
    .query(
      `SELECT b.id, b.lesson_id, l.subject_id, b.type, b.errors, b.last_error FROM blocks b JOIN lessons l ON l.id = b.lesson_id
       WHERE b.errors > 0 ${subjectId === undefined ? '' : 'AND l.subject_id = ?'} ORDER BY l.day DESC`,
    )
    .all(...(subjectId === undefined ? [] : [subjectId])) as Array<{id: string; lesson_id: string; subject_id: string; type: string; errors: number; last_error: string | null}>;
}

function hasConcepts(ctx: Ctx, subject: Subject): boolean {
  return (ctx.db.query('SELECT COUNT(*) AS n FROM concepts WHERE subject_id = ?').get(subject.id) as {n: number}).n > 0;
}

export function dueReport(ctx: Ctx): DueReport {
  const bySubject = (rows: Feedback[]) => {
    const out = new Set<string>();
    for (const row of rows) {
      const s = subjectOfFeedback(ctx, row);
      if (s !== undefined) out.add(s);
    }
    return out;
  };
  const needsFix = bySubject(unresolvedFlags(ctx));
  for (const b of blocksWithErrors(ctx)) needsFix.add(b.subject_id);
  const needsReply = bySubject(unansweredAsks(ctx));
  const today = ctx.today();

  const report: DueReport = {due: false, subjects: [], waiting: [], reviews: tutorReviews(ctx).map(p => ({number: p.number, title: p.title, status: p.status}))};
  for (const subject of activeSubjects(ctx)) {
    const reasons: DueWhy[] = [];
    if (needsFix.has(subject.id)) reasons.push('needs_fix');
    if (needsReply.has(subject.id)) reasons.push('needs_reply');
    const readiness = readinessOf(ctx, subject);
    if (!hasConcepts(ctx, subject)) reasons.push('needs_plan');
    else if (readiness.ready) reasons.push('ready');
    if (!readiness.ready) {
      let why: WaitWhy;
      let message = readiness.message;
      if (readiness.why === 'has_lesson_today') {
        const lesson = lessonForDay(ctx, subject.id, today)!;
        why = lesson.state === 'finished' || lesson.state === 'skipped' ? 'done_today' : 'unfinished_lesson';
        message = why === 'done_today' ? `today's lesson is ${lesson.state}` : "today's lesson is waiting for the learner";
      } else {
        why = readiness.why === 'paused' ? 'not_scheduled_today' : readiness.why;
      }
      report.waiting.push({id: subject.id, title: subject.title, why, message});
    }
    if (reasons.length > 0) report.subjects.push({id: subject.id, title: subject.title, why: reasons[0]!, reasons});
  }
  report.due = report.subjects.length > 0 || report.reviews.length > 0;
  return report;
}
