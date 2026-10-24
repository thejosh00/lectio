/**
 * What is waiting for the learner today, per subject: the lesson, the quizzes, how many
 * reviews are due, and — when nothing is ready yet — the real reason why.
 */
import {nextScheduledDay} from '../core/schedule.ts';
import {addDays} from '../core/time.ts';
import type {Feedback, Lesson, Quiz, Subject} from '../core/types.ts';
import {getMark, setMark} from './database.ts';
import {visibleFeedback} from './feedback.ts';
import type {Ctx} from './context.ts';
import {lessonForDay, readinessOf, unfinishedLessons} from './lessons.ts';
import {dueConcepts} from './memory.ts';
import {openBlocker, progressOf, quizItems, visibleQuizzes, type QuizProgress} from './quizzes.ts';
import {needsYou} from './proposals.ts';
import {numberSetting} from './settings.ts';
import {activeSubjects} from './subjects.ts';
import {SECONDS_PER_QUESTION} from '../blocks/question.ts';

export interface TodayQuiz {
  id: string;
  kind: string;
  state: string;
  day: string;
  counts: Record<string, number>;
  estimate_minutes: number;
  progress: QuizProgress;
  blocked: string | null;
}

export interface TodaySubject {
  subject: Subject;
  lesson: (Pick<Lesson, 'id' | 'title' | 'day' | 'state' | 'estimated_minutes' | 'objectives'> & {is_today: boolean}) | null;
  quizzes: TodayQuiz[];
  /** When there's no lesson to read: why, in the learner's terms. */
  waiting: {why: string; message: string} | null;
  practice_due: number;
}

export interface TodayView {
  day: string;
  subjects: TodaySubject[];
  replies: Feedback[];
  practice_due: number;
  /** Proposals waiting on the learner: to decide, a question to answer, a branch to review. */
  improvements: number;
}

const REPLIES_SEEN = 'replies_seen';

function waitingFor(ctx: Ctx, subject: Subject): {why: string; message: string} {
  const readiness = readinessOf(ctx, subject);
  const hasConcepts = (ctx.db.query('SELECT COUNT(*) AS n FROM concepts WHERE subject_id = ?').get(subject.id) as {n: number}).n > 0;
  if (readiness.ready) {
    return hasConcepts ? {why: 'writing', message: "Your tutor is writing today's lesson."} : {why: 'planning', message: 'Your tutor is planning this subject.'};
  }
  switch (readiness.why) {
    case 'before_ready_hour': {
      const hour = numberSetting(ctx.db, 'lesson_ready_hour');
      return {why: readiness.why, message: `Your lesson arrives after ${String(hour).padStart(2, '0')}:00.`};
    }
    case 'not_scheduled_today': {
      const next = nextScheduledDay(subject.days, addDays(ctx.today(), 1));
      const when = next === undefined ? '' : ` Next lesson: ${new Date(`${next}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'long', timeZone: 'UTC'})}.`;
      return {why: readiness.why, message: `No lesson today.${when}`};
    }
    case 'unfinished_lesson':
      return {why: readiness.why, message: 'Finish the earlier lesson first.'};
    case 'has_lesson_today':
      return {why: 'done_today', message: "That's today's lesson done."};
    default:
      return {why: readiness.why, message: readiness.message};
  }
}

function todayQuiz(ctx: Ctx, quiz: Quiz): TodayQuiz {
  const items = quizItems(ctx, quiz.id);
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.role] = (counts[item.role] ?? 0) + 1;
  return {
    id: quiz.id,
    kind: quiz.kind,
    state: quiz.state,
    day: quiz.day,
    counts,
    estimate_minutes: Math.max(1, Math.round((items.length * SECONDS_PER_QUESTION) / 60)),
    progress: progressOf(ctx, quiz),
    blocked: openBlocker(ctx, quiz) ?? null,
  };
}

export function todayView(ctx: Ctx): TodayView {
  const day = ctx.today();
  const subjects: TodaySubject[] = activeSubjects(ctx).map(subject => {
    const lesson = unfinishedLessons(ctx, subject.id)[0] ?? lessonForDay(ctx, subject.id, day);
    const due = dueConcepts(ctx, subject.id).length;
    return {
      subject,
      lesson:
        lesson === undefined
          ? null
          : {id: lesson.id, title: lesson.title, day: lesson.day, state: lesson.state, estimated_minutes: lesson.estimated_minutes, objectives: lesson.objectives, is_today: lesson.day === day},
      quizzes: visibleQuizzes(ctx, subject.id).map(q => todayQuiz(ctx, q)),
      waiting: lesson !== undefined && lesson.state !== 'finished' && lesson.state !== 'skipped' ? null : waitingFor(ctx, subject),
      practice_due: due,
    };
  });
  const seen = getMark(ctx.db, REPLIES_SEEN) ?? '';
  const replies = ctx.db.query("SELECT * FROM feedback WHERE reply IS NOT NULL AND replied_at > ? AND actor = 'you' ORDER BY replied_at DESC LIMIT 20").all(seen) as Feedback[];
  // The examiner's replies on a checkup are the learner's to read, not the tutor's (M12).
  return {day, subjects, replies: visibleFeedback(ctx, replies), practice_due: subjects.reduce((sum, s) => sum + s.practice_due, 0), improvements: needsYou(ctx)};
}

export function markRepliesSeen(ctx: Ctx): void {
  setMark(ctx.db, REPLIES_SEEN, ctx.now());
}
