import {getAttempt, outcomeOf} from '../../db/attemptRows.ts';
import {agentGrade, answer, dispute, resolveAttempt, selfGrade} from '../../db/attempts.ts';
import {getQuestion} from '../../db/questions.ts';
import {int, num, str, type Route} from '../http.ts';

const LEARNER = ['learner'] as const;

export const attemptRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/attempts',
    allow: LEARNER,
    what: 'answering questions',
    handler: (ctx, req) =>
      ctx.write(() => ({
        ...answer(ctx, {
          question: str(req.body, 'question'),
          lesson: str(req.body, 'lesson'),
          quiz: str(req.body, 'quiz'),
          answer: req.body['answer'],
          shown_order: req.body['shown_order'],
          confidence: str(req.body, 'confidence'),
          hints_used: int(req.body, 'hints_used'),
          seconds: num(req.body, 'seconds'),
        }),
      })),
  },
  {
    method: 'GET',
    path: '/api/attempts/:ref',
    handler: (ctx, req) => {
      const attempt = resolveAttempt(ctx, req.params['ref']);
      return {attempt, outcome: outcomeOf(ctx, attempt, getQuestion(ctx, attempt.question_id)!)};
    },
  },
  {
    method: 'POST',
    path: '/api/attempts/:ref/self-grade',
    allow: LEARNER,
    what: 'grading your own answers',
    handler: (ctx, req) => ctx.write(() => ({...selfGrade(ctx, resolveAttempt(ctx, req.params['ref']), str(req.body, 'grade'))})),
  },
  {
    method: 'POST',
    path: '/api/attempts/:ref/dispute',
    allow: LEARNER,
    what: 'disputing a grade',
    handler: (ctx, req) => ctx.write(() => ({...dispute(ctx, resolveAttempt(ctx, req.params['ref']), str(req.body, 'note'))})),
  },
  {
    method: 'POST',
    path: '/api/attempts/:ref/grade',
    allow: ['tutor'],
    what: 're-grading free responses',
    handler: (ctx, req) =>
      ctx.write(() => {
        const attempt = agentGrade(ctx, resolveAttempt(ctx, req.params['ref']), {score: num(req.body, 'score'), note: str(req.body, 'note')});
        return {attempt: getAttempt(ctx, attempt.id)};
      }),
  },
];
