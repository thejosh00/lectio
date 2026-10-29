/**
 * Fixing what's wrong. "Wrong is worse than nothing": a flagged question is rewritten in
 * place (its id stays, its version goes up), and when its key was wrong the attempts it
 * graded are voided, leaving stats and memory as if it had never been asked.
 */
import {usageError} from '../core/errors.ts';
import {questionFigureAssets, questionFigureWarnings} from '../core/figureLint.ts';
import {examQuestionProblems, Invalid, readQuestion} from '../core/submission.ts';
import type {Question} from '../core/types.ts';
import {Node} from '../core/validate.ts';
import {svgWarnings} from './assets.ts';
import {voidAttempts} from './attempts.ts';
import {conceptIds} from './concepts.ts';
import type {Ctx} from './context.ts';
import {resolveFeedbackRows} from './feedback.ts';
import {invalid, subjectFacts} from './lessons.ts';
import {getQuestion, rewriteQuestion} from './questions.ts';

export function fixQuestion(
  ctx: Ctx,
  question: Question,
  input: {question: unknown; voidAttempts: boolean; resolve: string[]; reply: string | undefined; diagrams?: ReadonlyMap<string, string | null>},
): {question: Question; changed: boolean; voided: number; resolved: string[]; warnings: string[]} {
  const reply = input.reply?.trim() ?? '';
  if (input.resolve.length > 0 && reply === '') throw usageError('say what changed: --reply "…"');
  const node = Node.root(input.question);
  const read = readQuestion(node, subjectFacts(ctx, question.subject_id, input.diagrams), {needsRef: false});
  // A checkup question stays one: graded by the app, no hints, not a variant.
  if (read !== undefined && question.status === 'exam') examQuestionProblems(read, node);
  if (read === undefined || node.issues.length > 0) throw invalid(new Invalid('question', node.issues));
  const voided = input.voidAttempts ? voidAttempts(ctx, question) : 0;
  const {question: fixed, changed} = rewriteQuestion(ctx, question, read, conceptIds(ctx, question.subject_id));
  const attemptsOf = new Set((ctx.db.query('SELECT id FROM attempts WHERE question_id = ?').all(question.id) as Array<{id: string}>).map(r => r.id));
  const resolved = resolveFeedbackRows(ctx, input.resolve, {
    target: 'question',
    targetId: question.id,
    reply,
    resolution: 'fixed',
    matches: row => (row.target === 'question' && row.target_id === question.id) || (row.target === 'attempt' && attemptsOf.has(row.target_id)),
  });
  return {question: getQuestion(ctx, fixed.id)!, changed, voided, resolved, warnings: questionFigureWarnings(read, 'question', svgWarnings(ctx, questionFigureAssets([read])))};
}
