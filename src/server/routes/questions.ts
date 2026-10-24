import {AppError, EXIT_USAGE, usageError} from '../../core/errors.ts';
import {EXAMINER_ACTOR} from '../../core/types.ts';
import {fixQuestion} from '../../db/fixes.ts';
import {questionBank} from '../../db/measures.ts';
import {resolveQuestion, retireQuestion} from '../../db/questions.ts';
import {resolveSubject} from '../../db/subjects.ts';
import {bool, q, str, strList, type Route} from '../http.ts';

export const questionRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/questions',
    handler: (ctx, req) => {
      const subject = q(req, 'subject');
      return {questions: questionBank(ctx, {subjectId: subject === undefined ? undefined : resolveSubject(ctx, subject).id, concept: q(req, 'concept'), status: q(req, 'status')})};
    },
  },
  {
    method: 'GET',
    path: '/api/questions/:ref',
    handler: (ctx, req) => {
      const question = resolveQuestion(ctx, req.params['ref']);
      return {question: questionBank(ctx, {ids: [question.id], status: 'all'})[0]};
    },
  },
  {
    method: 'POST',
    path: '/api/questions/:ref/fix',
    allow: ['tutor', 'examiner'],
    what: 'fixing questions',
    handler: (ctx, req) =>
      ctx.write(() => {
        if (req.body['question'] === undefined) throw usageError('send the question JSON: --file q.json');
        const question = resolveQuestion(ctx, req.params['ref']);
        // The examiner fixes its own checkup questions and nothing else (the tutor can't even see them).
        if (ctx.role === 'examiner' && question.added_by !== EXAMINER_ACTOR) throw new AppError(`question ${question.id} is the tutor's; the examiner fixes only its own checkup questions`, EXIT_USAGE, {refused: true}, 403);
        return {
          ...fixQuestion(ctx, question, {
            question: req.body['question'],
            voidAttempts: bool(req.body, 'void_attempts') === true,
            resolve: strList(req.body, 'resolve'),
            reply: str(req.body, 'reply'),
          }),
        };
      }),
  },
  {
    method: 'POST',
    path: '/api/questions/:ref/retire',
    allow: ['tutor'],
    what: 'retiring questions',
    handler: (ctx, req) => ctx.write(() => ({question: retireQuestion(ctx, resolveQuestion(ctx, req.params['ref']))})),
  },
];
