import {AppError, EXIT_USAGE, notFound} from '../../core/errors.ts';
import {createFeedback, examScope, listFeedback, replyTo, resolveFeedback, tutorSees, visibleFeedback} from '../../db/feedback.ts';
import {q, str, type Route} from '../http.ts';

export const feedbackRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/feedback',
    allow: ['learner'],
    what: 'giving feedback',
    handler: (ctx, req) =>
      ctx.write(() => ({
        feedback: createFeedback(ctx, {target: str(req.body, 'target'), target_id: str(req.body, 'target_id'), kind: str(req.body, 'kind'), note: str(req.body, 'note')}),
      })),
  },
  {
    method: 'GET',
    path: '/api/feedback',
    handler: (ctx, req) => ({feedback: visibleFeedback(ctx, listFeedback(ctx, {target: q(req, 'target'), targetId: q(req, 'target_id'), kind: q(req, 'kind'), since: q(req, 'since')}))}),
  },
  {
    method: 'POST',
    path: '/api/feedback/:ref/reply',
    allow: ['tutor', 'examiner'],
    what: 'replying to feedback',
    handler: (ctx, req) =>
      ctx.write(() => {
        const feedback = resolveFeedback(ctx, req.params['ref']);
        // Feedback on a checkup is the examiner's (the tutor can't see it); the examiner answers nothing else.
        if (ctx.role === 'tutor' && !tutorSees(ctx, feedback)) throw notFound(`no feedback "${req.params['ref']}"`);
        if (ctx.role === 'examiner' && !examScope(ctx, feedback).exam) throw new AppError(`feedback ${feedback.id} is the tutor's to answer`, EXIT_USAGE, {refused: true}, 403);
        return {feedback: replyTo(ctx, feedback, {body: str(req.body, 'body'), resolved: str(req.body, 'resolved')})};
      }),
  },
];
