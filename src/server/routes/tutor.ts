import {agentContext} from '../../db/agentContext.ts';
import {contractVersion} from '../../db/contract.ts';
import {dueReport} from '../../db/due.ts';
import {progressReport} from '../../db/measures.ts';
import {finishRun, listRuns, startRun} from '../../db/runs.ts';
import {resolveSubject} from '../../db/subjects.ts';
import {resolveId} from '../../db/refs.ts';
import {EXAMINER_ACTOR} from '../../core/types.ts';
import {bool, int, object, q, str, type Route} from '../http.ts';

export const tutorRoutes: Route[] = [
  {method: 'GET', path: '/api/due', handler: ctx => ({...dueReport(ctx)})},
  {
    method: 'GET',
    path: '/api/context',
    handler: (ctx, req) => {
      const subject = q(req, 'subject');
      return {...agentContext(ctx, subject === undefined ? undefined : resolveSubject(ctx, subject).id)};
    },
  },
  {
    method: 'GET',
    path: '/api/progress',
    handler: (ctx, req) => {
      const subject = q(req, 'subject');
      return {progress: progressReport(ctx, subject === undefined ? undefined : resolveSubject(ctx, subject).id)};
    },
  },
  {
    method: 'GET',
    path: '/api/runs',
    // The examiner's runs are its own business while the tutor can't see checkups.
    handler: (ctx, req) => ({runs: listRuns(ctx, int({limit: q(req, 'limit')}, 'limit', 1) ?? 30, undefined, ctx.seesExams ? undefined : EXAMINER_ACTOR)}),
  },
  {
    method: 'POST',
    path: '/api/runs',
    allow: ['tutor', 'examiner'],
    what: 'starting a tutor run',
    handler: ctx => ctx.write(() => ({...startRun(ctx, contractVersion(ctx))})),
  },
  {
    method: 'POST',
    path: '/api/runs/:ref/finish',
    allow: ['tutor', 'examiner'],
    what: 'finishing a tutor run',
    handler: (ctx, req) =>
      ctx.write(() => ({
        run: finishRun(ctx, resolveId(ctx, 'run', req.params['ref']), {outcome: str(req.body, 'outcome'), made: object(req.body, 'made'), summary: str(req.body, 'summary'), retro: bool(req.body, 'retro')}),
      })),
  },
];
