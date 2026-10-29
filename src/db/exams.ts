/**
 * Checkups (M12): a referee the tutor doesn't control.
 *
 * A third agent, the examiner, asks about what the tutor taught, from the syllabus alone.
 * The app draws which concepts each checkup covers — at random, never-examined first — and
 * keeps the draw, so nobody can choose or recompute it. The examiner sees each concept's
 * title and summary and the objectives of the lesson that introduced it: no lesson text, no
 * tutor questions, no notes, no memory. It writes a question or more per concept, and the
 * learner answers. Checkup answers never count for memory and are left out of every
 * existing measure; the tutor sees nothing of a checkup until it is finished.
 */
import {randomInt} from 'node:crypto';
import {failed, usageError} from '../core/errors.ts';
import {Invalid, readExam} from '../core/submission.ts';
import {addDays, addDaysIso, daysBetween} from '../core/time.ts';
import type {Feedback, Quiz, Subject} from '../core/types.ts';
import {conceptIds} from './concepts.ts';
import {parseJson, type Ctx} from './context.ts';
import {examFlags} from './feedback.ts';
import {invalid, subjectFacts} from './lessons.ts';
import {getQuestion, insertQuestion} from './questions.ts';
import {getQuiz, isExpired, progressOf, quizItems} from './quizzes.ts';
import {runFor} from './runs.ts';
import {numberSetting} from './settings.ts';
import {activeSubjects} from './subjects.ts';

/** The fewest concepts worth a checkup. */
const MIN_CONCEPTS = 3;

export interface ExamPlan {
  id: string;
  subject_id: string;
  day: string;
  /** Concept ids, in the order drawn. */
  concepts: string[];
  quiz_id: string | null;
  run_id: string | null;
  created: string;
}

const planFromRow = (row: Omit<ExamPlan, 'concepts'> & {concepts: string}): ExamPlan => ({...row, concepts: parseJson<string[]>(row.concepts, [])});

function planFor(ctx: Ctx, subjectId: string, day: string): ExamPlan | undefined {
  const row = ctx.db.query('SELECT * FROM exam_plans WHERE subject_id = ? AND day = ?').get(subjectId, day) as (Omit<ExamPlan, 'concepts'> & {concepts: string}) | null;
  return row === null ? undefined : planFromRow(row);
}

/** The last checkup that was written (a draw nobody wrote up doesn't count). */
function lastWritten(ctx: Ctx, subjectId: string): ExamPlan | undefined {
  const row = ctx.db.query('SELECT * FROM exam_plans WHERE subject_id = ? AND quiz_id IS NOT NULL ORDER BY day DESC LIMIT 1').get(subjectId) as
    | (Omit<ExamPlan, 'concepts'> & {concepts: string})
    | null;
  return row === null ? undefined : planFromRow(row);
}

interface EligibleConcept {
  id: string;
  key: string;
  title: string;
  summary: string;
  prereqs: string;
  introduced: string;
}

/** Concepts introduced at least `exam_min_age_days` ago: what a checkup may ask about. */
function eligibleConcepts(ctx: Ctx, subjectId: string): EligibleConcept[] {
  const before = addDaysIso(ctx.now(), -numberSetting(ctx.db, 'exam_min_age_days'));
  return ctx.db
    .query("SELECT id, key, title, summary, prereqs, introduced FROM concepts WHERE subject_id = ? AND status = 'introduced' AND introduced IS NOT NULL AND introduced <= ? ORDER BY position, key")
    .all(subjectId, before) as EligibleConcept[];
}

type SubjectStatus = {due: true; why: 'checkup' | 'unwritten'} | {due: false; why: 'waiting_for_learner' | 'not_yet' | 'too_few_concepts'; message: string};

function subjectStatus(ctx: Ctx, subject: Subject): SubjectStatus {
  const today = ctx.today();
  const plan = planFor(ctx, subject.id, today);
  if (plan !== undefined && plan.quiz_id === null) return {due: true, why: 'unwritten'};
  const open = ctx.db.query("SELECT * FROM quizzes WHERE subject_id = ? AND kind = 'exam' AND state IN ('ready', 'open') ORDER BY day DESC LIMIT 1").get(subject.id) as Quiz | null;
  if (open !== null && !isExpired(ctx, open)) return {due: false, why: 'waiting_for_learner', message: `the checkup of ${open.day} is waiting for the learner`};
  const last = lastWritten(ctx, subject.id);
  const every = numberSetting(ctx.db, 'exam_days');
  if (last !== undefined && daysBetween(last.day, today) < every) return {due: false, why: 'not_yet', message: `the next checkup is from ${addDays(last.day, every)}`};
  const eligible = eligibleConcepts(ctx, subject.id).length;
  if (eligible < MIN_CONCEPTS) {
    return {due: false, why: 'too_few_concepts', message: `a checkup needs ${MIN_CONCEPTS} concepts introduced at least ${numberSetting(ctx.db, 'exam_min_age_days')} days ago; there ${eligible === 1 ? 'is' : 'are'} ${eligible}`};
  }
  return {due: true, why: 'checkup'};
}

export interface ExamDue {
  due: boolean;
  subjects: Array<{id: string; title: string; why: 'checkup' | 'unwritten'}>;
  waiting: Array<{id: string; title: string; why: string; message: string}>;
  /** Flags and disputes on checkup questions: yours to fix before writing anything new. */
  flags: Array<Feedback & {question: {id: string; prompt: string; version: number} | null}>;
}

/** Feedback on a checkup, with the question it is about. */
function flagView(ctx: Ctx, f: Feedback) {
  const questionId =
    f.target === 'question' ? f.target_id : f.target === 'attempt' ? ((ctx.db.query('SELECT question_id FROM attempts WHERE id = ?').get(f.target_id) as {question_id: string} | null)?.question_id ?? null) : null;
  const question = questionId === null ? undefined : getQuestion(ctx, questionId);
  return {...f, question: question === undefined ? null : {id: question.id, prompt: question.prompt, version: question.version}};
}

export function examDue(ctx: Ctx): ExamDue {
  const report: ExamDue = {due: false, subjects: [], waiting: [], flags: examFlags(ctx).map(f => flagView(ctx, f))};
  for (const subject of activeSubjects(ctx)) {
    const status = subjectStatus(ctx, subject);
    if (status.due) report.subjects.push({id: subject.id, title: subject.title, why: status.why});
    else report.waiting.push({id: subject.id, title: subject.title, why: status.why, message: status.message});
  }
  report.due = report.subjects.length > 0 || report.flags.length > 0;
  return report;
}

/** Shuffle with real randomness, then put the concepts examined longest ago (or never) first. */
function draw(ctx: Ctx, subjectId: string, eligible: EligibleConcept[], max: number): EligibleConcept[] {
  const lastExamined = new Map<string, string>();
  for (const row of ctx.db.query('SELECT day, concepts FROM exam_plans WHERE subject_id = ? AND quiz_id IS NOT NULL').all(subjectId) as Array<{day: string; concepts: string}>) {
    for (const id of parseJson<string[]>(row.concepts, [])) if ((lastExamined.get(id) ?? '') < row.day) lastExamined.set(id, row.day);
  }
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  // A stable sort keeps the shuffle among concepts examined on the same day (or never).
  return pool.sort((a, b) => (lastExamined.get(a.id) ?? '').localeCompare(lastExamined.get(b.id) ?? '')).slice(0, max);
}

export interface ExamContext {
  plan: {id: string; day: string; concepts: string[]};
  subject: {id: string; title: string; goal: string; level: string};
  concepts: Array<{key: string; title: string; summary: string; prereqs: string[]; introduced: string | null; objectives: string[]; past_prompts: string[]}>;
  max_questions: number;
}

/** What the examiner may know for a checkup: the syllabus and the objectives, nothing the tutor wrote to teach. */
function examContext(ctx: Ctx, subject: Subject, plan: ExamPlan): ExamContext {
  const concepts = plan.concepts.map(id => {
    const row = ctx.db.query('SELECT key, title, summary, prereqs, introduced FROM concepts WHERE id = ?').get(id) as {key: string; title: string; summary: string; prereqs: string; introduced: string | null};
    const objectives = (
      ctx.db.query("SELECT l.objectives FROM lesson_concepts lc JOIN lessons l ON l.id = lc.lesson_id WHERE lc.concept_id = ? AND lc.role = 'new' ORDER BY l.day").all(id) as Array<{objectives: string}>
    ).flatMap(r => parseJson<string[]>(r.objectives, []));
    const pastPrompts = (
      ctx.db
        .query("SELECT q.prompt FROM questions q JOIN question_concepts qc ON qc.question_id = q.id WHERE qc.concept_id = ? AND q.status = 'exam' ORDER BY q.added DESC LIMIT 5")
        .all(id) as Array<{prompt: string}>
    ).map(r => r.prompt);
    return {key: row.key, title: row.title, summary: row.summary, prereqs: parseJson<string[]>(row.prereqs, []), introduced: row.introduced, objectives, past_prompts: pastPrompts};
  });
  return {
    plan: {id: plan.id, day: plan.day, concepts: concepts.map(c => c.key)},
    subject: {id: subject.id, title: subject.title, goal: subject.goal, level: subject.level},
    concepts,
    max_questions: numberSetting(ctx.db, 'exam_max_questions'),
  };
}

/** Draw today's checkup for a subject, or return the one already drawn. */
export function startExam(ctx: Ctx, subject: Subject, run: string | undefined): {existing: boolean; context: ExamContext} {
  const runId = runFor(ctx, run);
  const today = ctx.today();
  const existing = planFor(ctx, subject.id, today);
  if (existing !== undefined) return {existing: true, context: examContext(ctx, subject, existing)};
  if (subject.status !== 'active') throw failed(`${subject.title} is ${subject.status}`);
  const status = subjectStatus(ctx, subject);
  if (!status.due) throw failed(`no checkup for ${subject.title} today: ${status.message}`, {why: status.why});
  const picked = draw(ctx, subject.id, eligibleConcepts(ctx, subject.id), numberSetting(ctx.db, 'exam_max_questions'));
  const id = ctx.newId();
  ctx.db.query('INSERT INTO exam_plans (id, subject_id, day, concepts, quiz_id, run_id, created) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(id, subject.id, today, JSON.stringify(picked.map(c => c.id)), runId, ctx.now());
  ctx.event('exam', id, {kind: 'drawn', subject_id: subject.id, concepts: picked.length});
  return {existing: false, context: examContext(ctx, subject, planFor(ctx, subject.id, today)!)};
}

/** The examiner's checkup for today's draw: new, app-graded questions, every drawn concept covered and no other. */
export function submitExam(ctx: Ctx, subject: Subject, input: {run: string | undefined; exam: unknown; diagrams?: ReadonlyMap<string, string | null>}): {quiz: Quiz; existing: boolean; question_ids: string[]} {
  const runId = runFor(ctx, input.run);
  const plan = planFor(ctx, subject.id, ctx.today());
  if (plan === undefined) throw failed(`draw today's checkup first: lectio exam start ${subject.id} --run <run>`);
  if (plan.quiz_id !== null) return {quiz: getQuiz(ctx, plan.quiz_id)!, existing: true, question_ids: quizItems(ctx, plan.quiz_id).map(i => i.question_id)};
  if (input.exam === undefined) throw usageError('send the checkup JSON: --file exam.json or --stdin');
  const ids = conceptIds(ctx, subject.id);
  const keyOf = new Map([...ids].map(([key, id]) => [id, key]));
  let exam;
  try {
    exam = readExam(input.exam, subjectFacts(ctx, subject.id, input.diagrams), plan.concepts.map(id => keyOf.get(id)!), numberSetting(ctx.db, 'exam_max_questions'));
  } catch (error) {
    if (error instanceof Invalid) throw invalid(error);
    throw error;
  }
  const quizId = ctx.newId();
  ctx.db
    .query("INSERT INTO quizzes (id, subject_id, day, kind, lesson_id, rationale, run_id, added_by, state, added) VALUES (?, ?, ?, 'exam', NULL, ?, ?, ?, 'ready', ?)")
    .run(quizId, subject.id, plan.day, exam.rationale.trim(), runId, ctx.actor, ctx.now());
  const questionIds = exam.questions.map((question, position) => {
    const id = insertQuestion(ctx, question, {subjectId: subject.id, lessonId: null, runId, conceptIds: ids, variantOf: null}).id;
    ctx.db.query("UPDATE questions SET status = 'exam' WHERE id = ?").run(id);
    ctx.db.query("INSERT INTO quiz_items (quiz_id, position, question_id, role) VALUES (?, ?, ?, 'exam')").run(quizId, position, id);
    return id;
  });
  ctx.db.query('UPDATE exam_plans SET quiz_id = ?, run_id = COALESCE(run_id, ?) WHERE id = ?').run(quizId, runId, plan.id);
  ctx.event('exam', plan.id, {kind: 'written', quiz_id: quizId, subject_id: subject.id, items: questionIds.length});
  return {quiz: getQuiz(ctx, quizId)!, existing: false, question_ids: questionIds};
}

/** Skip checkups that waited too long, so a forgotten one can't keep its results from the tutor for ever. */
export function expireExams(ctx: Ctx): string[] {
  const cutoff = addDays(ctx.today(), -numberSetting(ctx.db, 'exam_expire_days'));
  const ids = (ctx.db.query("SELECT id FROM quizzes WHERE kind = 'exam' AND state IN ('ready', 'open') AND day <= ?").all(cutoff) as Array<{id: string}>).map(r => r.id);
  for (const id of ids) {
    ctx.db.query("UPDATE quizzes SET state = 'skipped' WHERE id = ?").run(id);
    ctx.event('exam', id, {kind: 'expired'});
  }
  return ids;
}

export interface ExamResult {
  quiz_id: string;
  day: string;
  finished: string | null;
  score: number | null;
  items: Array<{question_id: string; type: string; aim: string; prompt: string; concepts: string[]; answer: unknown; score: number | null; confidence: string; misconception: string | null; seconds: number}>;
}

/** Finished checkups of a subject since `since`: what the tutor sees, once there is nothing left to give away. */
export function examResults(ctx: Ctx, subjectId: string, since: string): ExamResult[] {
  const quizzes = ctx.db.query("SELECT * FROM quizzes WHERE subject_id = ? AND kind = 'exam' AND state = 'finished' AND finished >= ? ORDER BY day").all(subjectId, since) as Quiz[];
  return quizzes.map(quiz => {
    const attempts = new Map(
      (ctx.db.query('SELECT question_id, answer, score, confidence, misconception, seconds FROM attempts WHERE quiz_id = ? AND attempt_no = 1').all(quiz.id) as Array<{
        question_id: string;
        answer: string;
        score: number | null;
        confidence: string;
        misconception: string | null;
        seconds: number;
      }>).map(a => [a.question_id, a]),
    );
    return {
      quiz_id: quiz.id,
      day: quiz.day,
      finished: quiz.finished,
      score: progressOf(ctx, quiz).score,
      items: quizItems(ctx, quiz.id).map(item => {
        const question = getQuestion(ctx, item.question_id)!;
        const attempt = attempts.get(item.question_id);
        return {
          question_id: question.id,
          type: question.type,
          aim: question.aim,
          prompt: question.prompt,
          concepts: question.concepts,
          answer: attempt === undefined ? null : parseJson<unknown>(attempt.answer, null),
          score: attempt?.score ?? null,
          confidence: attempt?.confidence ?? '',
          misconception: attempt?.misconception ?? null,
          seconds: attempt?.seconds ?? 0,
        };
      }),
    };
  });
}
