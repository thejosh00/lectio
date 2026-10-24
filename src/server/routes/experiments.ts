import {closeExperiment, listExperiments} from '../../db/experiments.ts';
import {resolveSubject} from '../../db/subjects.ts';
import {q, str, type Route} from '../http.ts';

/** Two-arm experiments (M14): which are running, and closing one with a verdict. */
export const experimentRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/experiments',
    handler: (ctx, req) => {
      const subject = q(req, 'subject');
      return {experiments: listExperiments(ctx, subject === undefined ? undefined : resolveSubject(ctx, subject).id)};
    },
  },
  {
    method: 'POST',
    path: '/api/experiments/:name/close',
    allow: ['tutor'],
    what: 'closing experiments',
    handler: (ctx, req) => ctx.write(() => ({experiment: closeExperiment(ctx, req.params['name'], str(req.body, 'note'))})),
  },
];
