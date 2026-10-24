import {examDue, startExam, submitExam} from '../../db/exams.ts';
import {resolveSubject} from '../../db/subjects.ts';
import {str, type Route} from '../http.ts';

const EXAMINER = ['examiner'] as const;

/** The examiner's checkups (M12). Nobody else reads or writes these routes. */
export const examRoutes: Route[] = [
  {method: 'GET', path: '/api/exams/due', readers: EXAMINER, handler: ctx => ({...examDue(ctx)})},
  {
    method: 'POST',
    path: '/api/exams/start',
    allow: EXAMINER,
    what: 'drawing a checkup',
    handler: (ctx, req) => ctx.write(() => ({...startExam(ctx, resolveSubject(ctx, str(req.body, 'subject')), str(req.body, 'run'))})),
  },
  {
    method: 'POST',
    path: '/api/subjects/:ref/exams',
    allow: EXAMINER,
    what: 'writing checkups',
    handler: (ctx, req) => ctx.write(() => ({...submitExam(ctx, resolveSubject(ctx, req.params['ref']), {run: str(req.body, 'run'), exam: req.body['exam']})})),
  },
];
