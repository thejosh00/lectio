/**
 * `lectio context`: everything a tutor run needs, in one call.
 *
 * Detail goes back `context_days`; older history is in the measures only. Attempts and
 * feedback are "since the last run", so each run reads what is new.
 */
import {addDaysIso} from '../core/time.ts';
import type {Feedback, Subject} from '../core/types.ts';
import {awaitingRegrade} from './attempts.ts';
import {listConcepts} from './concepts.ts';
import type {Ctx} from './context.ts';
import {contractVersion} from './contract.ts';
import {blocksWithErrors, dueReport, subjectOfFeedback} from './due.ts';
import {listFeedback, tutorSees, unansweredAsks, unresolvedFlags} from './feedback.ts';
import {examResults} from './exams.ts';
import {improvementsContext} from './improvements.ts';
import {lessonDetail, listLessons, readinessOf, unfinishedLessons} from './lessons.ts';
import {attemptFacts, progressReport} from './measures.ts';
import {memoryOf} from './memory.ts';
import {LEARNER_SCOPE, noteView, subjectScope} from './notes.ts';
import {playbookView} from './playbook.ts';
import {getQuestion} from './questions.ts';
import {quizDetail, visibleQuizzes} from './quizzes.ts';
import {lastFinishedRun, listRuns, openRunOf} from './runs.ts';
import {getSetting, numberSetting} from './settings.ts';
import {activeSubjects, getSubject} from './subjects.ts';
import {SECONDS_PER_QUESTION} from '../blocks/question.ts';

const clip = (text: string, max = 240) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Where a piece of feedback points, in a line the tutor can act on. */
function aboutOf(ctx: Ctx, f: Feedback): Record<string, unknown> {
  switch (f.target) {
    case 'block': {
      const row = ctx.db.query('SELECT b.lesson_id, b.type, b.approach, b.version, l.title FROM blocks b JOIN lessons l ON l.id = b.lesson_id WHERE b.id = ?').get(f.target_id) as Record<string, unknown> | null;
      return {block_id: f.target_id, ...(row ?? {})};
    }
    case 'question': {
      const q = getQuestion(ctx, f.target_id);
      return {question_id: f.target_id, type: q?.type, prompt: q === undefined ? null : clip(q.prompt), version: q?.version};
    }
    case 'attempt': {
      const row = ctx.db.query('SELECT question_id, answer, score FROM attempts WHERE id = ?').get(f.target_id) as {question_id: string; answer: string; score: number | null} | null;
      const q = row === null ? undefined : getQuestion(ctx, row.question_id);
      return {attempt_id: f.target_id, question_id: row?.question_id, answer: row === null ? null : JSON.parse(row.answer), prompt: q === undefined ? null : clip(q.prompt), body: q?.body};
    }
    case 'lesson': {
      const row = ctx.db.query('SELECT title, day FROM lessons WHERE id = ?').get(f.target_id) as Record<string, unknown> | null;
      return {lesson_id: f.target_id, ...(row ?? {})};
    }
    default:
      return {[`${f.target}_id`]: f.target_id};
  }
}

/** Feedback the tutor may see (never a checkup's flags; asks about a finished one), with where it points. */
function feedbackJson(ctx: Ctx, rows: Feedback[]) {
  return rows.filter(f => ctx.seesExams || tutorSees(ctx, f)).map(f => ({...f, subject_id: subjectOfFeedback(ctx, f) ?? null, about: aboutOf(ctx, f)}));
}

function subjectContext(ctx: Ctx, subject: Subject, since: string, contextSince: string) {
  const today = ctx.today();
  const concepts = listConcepts(ctx, subject.id).map(c => {
    const memory = memoryOf(ctx, c.id, today);
    return {
      key: c.key,
      title: c.title,
      summary: c.summary,
      prereqs: c.prereqs,
      position: c.position,
      status: c.status,
      introduced: c.introduced,
      recall_now: memory === null ? null : Math.round(memory.recall_now * 1000) / 1000,
      due: memory?.due ?? null,
      is_due: memory?.is_due ?? false,
      reps: memory?.reps ?? 0,
      lapses: memory?.lapses ?? 0,
    };
  });
  const keyOf = new Map(listConcepts(ctx, subject.id).map(c => [c.id, c.key]));
  // Which approaches taught each concept: the blocks on it in lessons that included it.
  const taughtBy = new Map<string, Set<string>>();
  for (const row of ctx.db
    .query("SELECT b.approach, b.concepts FROM blocks b JOIN lessons l ON l.id = b.lesson_id WHERE l.subject_id = ? AND l.state IN ('open', 'finished')")
    .all(subject.id) as Array<{approach: string; concepts: string}>) {
    for (const key of JSON.parse(row.concepts) as string[]) (taughtBy.get(key) ?? taughtBy.set(key, new Set()).get(key)!).add(row.approach);
  }
  // What the tutor predicted for each quiz first try, to read beside what happened.
  const predictedFor = new Map(
    (
      ctx.db
        .query(
          `SELECT a.id, qi.predicted FROM attempts a JOIN quiz_items qi ON qi.quiz_id = a.quiz_id AND qi.question_id = a.question_id
           JOIN questions q ON q.id = a.question_id WHERE q.subject_id = ? AND a.at >= ? AND qi.predicted IS NOT NULL`,
        )
        .all(subject.id, since) as Array<{id: string; predicted: number}>
    ).map(r => [r.id, r.predicted]),
  );
  const attempts = attemptFacts(ctx, {subjectId: subject.id, since})
    .slice(-300)
    .map(a => {
      const q = getQuestion(ctx, a.question_id)!;
      const keys = a.concepts.map(c => keyOf.get(c) ?? c);
      return {
        id: a.id,
        at: a.at,
        context: a.context,
        role: a.role,
        question: {id: q.id, type: q.type, aim: q.aim, prompt: clip(q.prompt), version: q.version, difficulty: q.difficulty, lesson_id: q.lesson_id},
        concepts: keys,
        taught_by: Object.fromEntries(keys.map(k => [k, [...(taughtBy.get(k) ?? [])]])),
        answer: a.answer,
        score: a.score,
        predicted: predictedFor.get(a.id) ?? null,
        confidence: a.confidence,
        hints_used: a.hints_used,
        seconds: a.seconds,
        misconception: a.misconception,
        gap_hours: a.gap_hours,
        counts_for_memory: a.counts_for_memory,
        attempt_no: a.attempt_no,
        void: a.void,
      };
    });
  const lessonMinutes = Math.round(subject.minutes_per_day * 0.6);
  const quizMinutes = subject.minutes_per_day - lessonMinutes;
  const readiness = readinessOf(ctx, subject);
  return {
    subject,
    readiness,
    plan: noteView(ctx, subjectScope(subject.id)),
    concepts,
    open_lessons: unfinishedLessons(ctx, subject.id).map(l => {
      const d = lessonDetail(ctx, l);
      return {id: d.id, day: d.day, title: d.title, state: d.state, concepts: d.concepts, estimated_minutes: d.estimated_minutes};
    }),
    recent_lessons: listLessons(ctx, {subjectId: subject.id, limit: 10})
      .filter(l => l.added >= contextSince)
      .map(l => ({id: l.id, day: l.day, title: l.title, state: l.state, active_seconds: l.active_seconds, estimated_minutes: l.estimated_minutes, hypothesis: l.hypothesis, verdict: l.verdict})),
    quizzes: visibleQuizzes(ctx, subject.id).map(q => {
      const d = quizDetail(ctx, q);
      return {id: d.id, day: d.day, kind: d.kind, state: d.state, progress: d.progress, blocked: d.blocked};
    }),
    attempts_since_last_run: attempts,
    measures: progressReport(ctx, subject.id),
    // Checkups the learner finished since the last run, now there is nothing left to give away (M12).
    exams: examResults(ctx, subject.id, since),
    widget_errors: blocksWithErrors(ctx, subject.id),
    budget: {
      minutes_per_day: subject.minutes_per_day,
      lesson_minutes: lessonMinutes,
      quiz_minutes: quizMinutes,
      quiz_questions: Math.max(3, Math.round((quizMinutes * 60) / SECONDS_PER_QUESTION)),
    },
  };
}

export function agentContext(ctx: Ctx, subjectId?: string) {
  const last = lastFinishedRun(ctx, ctx.actor);
  const contextSince = addDaysIso(ctx.now(), -numberSetting(ctx.db, 'context_days'));
  const since = last === undefined || last.started < contextSince ? contextSince : last.started;
  const subjects = subjectId === undefined ? activeSubjects(ctx) : [getSubject(ctx, subjectId)!];
  const inScope = (rows: Feedback[]) => rows.filter(f => subjectId === undefined || subjectOfFeedback(ctx, f) === subjectId);
  const n = (key: string) => numberSetting(ctx.db, key);
  const version = contractVersion(ctx);
  return {
    now: ctx.now(),
    today: ctx.today(),
    since_last_run: since,
    settings: {
      timezone: ctx.timeZone,
      lesson_ready_hour: n('lesson_ready_hour'),
      quiz_max_questions: n('quiz_max_questions'),
      lesson_max_blocks: n('lesson_max_blocks'),
      lesson_max_bytes: n('lesson_max_bytes'),
      widget_max_bytes: n('widget_max_bytes'),
      notes_max_bytes: n('notes_max_bytes'),
      target_accuracy: n('target_accuracy'),
      desired_retention: n('desired_retention'),
      memory_gap_hours: n('memory_gap_hours'),
      context_days: n('context_days'),
      chrome_path: getSetting(ctx.db, 'chrome_path') ?? null,
    },
    due: dueReport(ctx),
    learner_notes: noteView(ctx, LEARNER_SCOPE),
    // How you teach (M13): yours to change, at most every playbook_min_days; empty until you seed it.
    playbook: playbookView(ctx),
    subjects: subjects.map(s => subjectContext(ctx, s, since, contextSince)),
    regrade: awaitingRegrade(ctx)
      .filter(a => subjectId === undefined || getQuestion(ctx, a.question_id)?.subject_id === subjectId)
      .map(a => {
        const q = getQuestion(ctx, a.question_id)!;
        return {attempt_id: a.id, at: a.at, question_id: q.id, subject_id: q.subject_id, prompt: q.prompt, model_answer: q.body['model_answer'], rubric: q.body['rubric'], answer: a.answer, self_score: a.score};
      }),
    feedback_since_last_run: feedbackJson(ctx, inScope(listFeedback(ctx, {since}))),
    unresolved_flags: feedbackJson(ctx, inScope(unresolvedFlags(ctx))),
    unanswered_asks: feedbackJson(ctx, inScope(unansweredAsks(ctx))),
    recent_runs: listRuns(ctx, 3, ctx.actor).map(r => ({id: r.id, started: r.started, finished: r.finished, outcome: r.outcome, made: r.made, retro: r.retro, summary: r.summary})),
    open_run: openRunOf(ctx)?.id ?? null,
    contract_version: version,
    contract_changed: last !== undefined && last.contract_version !== null && last.contract_version !== version,
    ...improvementsContext(ctx, last),
  };
}
