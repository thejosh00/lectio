import {createFeedback, listFeedback, replyTo, resolveFeedback} from '../../db/feedback.ts';
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
    handler: (ctx, req) => ({feedback: listFeedback(ctx, {target: q(req, 'target'), targetId: q(req, 'target_id'), kind: q(req, 'kind'), since: q(req, 'since')})}),
  },
  {
    method: 'POST',
    path: '/api/feedback/:ref/reply',
    allow: ['tutor'],
    what: 'replying to feedback',
    handler: (ctx, req) => ctx.write(() => ({feedback: replyTo(ctx, resolveFeedback(ctx, req.params['ref']), {body: str(req.body, 'body'), resolved: str(req.body, 'resolved')})})),
  },
];
