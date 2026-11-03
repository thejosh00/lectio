/**
 * Time estimates calibrated to this learner (#6): the rows the pure calibration in
 * `src/core/estimate.ts` reads, per subject.
 *
 * A past lesson's estimate is recomputed from its stored blocks, the same way a submit
 * times them (not the tutor's own `estimated_minutes`), over the blocks the learner was
 * shown: the shared ones and the arm they got. So the ratio scales exactly what a submit's
 * `estimate_minutes` measures.
 */
import {blockType} from '../blocks/index.ts';
import {questionSeconds, SECONDS_PER_QUESTION} from '../blocks/question.ts';
import {calibrate, CALIBRATION_ANSWERS, CALIBRATION_LESSONS, learnerLessonEstimate, learnerQuizEstimate, type Calibration, type LessonLearnerEstimate, type QuizLearnerEstimate} from '../core/estimate.ts';
import {assetLabels} from './assets.ts';
import {parseJson, type Ctx} from './context.ts';
import {armOf} from './experiments.ts';
import {getQuestion} from './questions.ts';

/** The seconds a stored lesson's blocks are estimated at, over the shared blocks and the arm shown (the longer arm before one is drawn). */
export function shownSeconds(ctx: Ctx, lessonId: string): number {
  const rows = ctx.db.query('SELECT type, body, arm FROM blocks WHERE lesson_id = ? ORDER BY position').all(lessonId) as Array<{type: string; body: string; arm: 'a' | 'b' | null}>;
  const labels = assetLabels(ctx);
  const questions = new Map<string, number>();
  const perArm = {shared: 0, a: 0, b: 0};
  for (const row of rows) {
    const body = parseJson<Record<string, unknown>>(row.body, {});
    if (row.type === 'question' && typeof body['question_id'] === 'string') {
      const question = getQuestion(ctx, body['question_id']);
      if (question !== undefined) questions.set(String(body['ref']), questionSeconds(question, labels));
    }
    perArm[row.arm ?? 'shared'] += blockType(row.type)?.estimateSeconds(body as never, {assetLabels: labels, questionSeconds: questions}) ?? 0;
  }
  const arm = armOf(ctx, lessonId);
  return perArm.shared + (arm === null ? Math.max(perArm.a, perArm.b) : perArm[arm]);
}

/** This learner's time in a subject against the generic estimate. */
export function calibrationOf(ctx: Ctx, subjectId: string): Calibration {
  const lessons = (
    ctx.db
      .query("SELECT id, active_seconds FROM lessons WHERE subject_id = ? AND state = 'finished' AND active_seconds > 0 ORDER BY finished DESC, day DESC LIMIT ?")
      .all(subjectId, CALIBRATION_LESSONS * 2) as Array<{id: string; active_seconds: number}>
  ).map(l => ({estimate_seconds: shownSeconds(ctx, l.id), active_seconds: l.active_seconds}));
  // First tries in the tutor's quizzes and practice, not inline checks or the examiner's checkups.
  const answers = (
    ctx.db
      .query(
        `SELECT a.seconds FROM attempts a JOIN quizzes z ON z.id = a.quiz_id
         WHERE z.subject_id = ? AND z.kind IN ('daily', 'placement', 'practice') AND a.attempt_no = 1 AND a.void = 0
         ORDER BY a.at DESC LIMIT ?`,
      )
      .all(subjectId, CALIBRATION_ANSWERS * 3) as Array<{seconds: number}>
  ).map(r => r.seconds);
  return calibrate({lessons, answer_seconds: answers, generic_seconds_per_question: SECONDS_PER_QUESTION});
}

/** A stored quiz's question count and generic estimate in seconds. */
export function quizSeconds(ctx: Ctx, quizId: string): {questions: number; generic_seconds: number} {
  const labels = assetLabels(ctx);
  const ids = (ctx.db.query('SELECT question_id FROM quiz_items WHERE quiz_id = ?').all(quizId) as Array<{question_id: string}>).map(r => r.question_id);
  const questions = ids.flatMap(id => {
    const q = getQuestion(ctx, id);
    return q === undefined ? [] : [q];
  });
  return {questions: questions.length, generic_seconds: questions.reduce((total, q) => total + questionSeconds(q, labels), 0)};
}

/** The day's lesson (not skipped) as this learner will take it; null without one. */
export function dayLessonEstimate(ctx: Ctx, subjectId: string, day: string, calibration: Calibration): LessonLearnerEstimate | null {
  const lesson = ctx.db.query("SELECT id FROM lessons WHERE subject_id = ? AND day = ? AND state != 'skipped'").get(subjectId, day) as {id: string} | null;
  return lesson === null ? null : learnerLessonEstimate(shownSeconds(ctx, lesson.id), calibration);
}

/** The day's tutor-written quiz (daily or placement) as this learner will take it; null without one. */
export function dayQuizEstimate(ctx: Ctx, subjectId: string, day: string, calibration: Calibration): QuizLearnerEstimate | null {
  const quiz = ctx.db.query("SELECT id FROM quizzes WHERE subject_id = ? AND day = ? AND kind IN ('daily', 'placement') AND state NOT IN ('skipped', 'superseded')").get(subjectId, day) as {id: string} | null;
  return quiz === null ? null : learnerQuizEstimate(quizSeconds(ctx, quiz.id), calibration);
}
