import {usageError} from '../../core/errors.ts';
import {noteHistory} from '../../db/notes.ts';
import {markPlaybookSeen, PLAYBOOK_SCOPE, playbookView, revertPlaybook, setPlaybook} from '../../db/playbook.ts';
import {bool, int, q, str, type Route} from '../http.ts';

/** The tutor's playbook (M13): how it teaches, versioned, edited by the tutor and by you. */
export const playbookRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/playbook',
    handler: (ctx, req) => ({playbook: playbookView(ctx), ...(bool({h: q(req, 'history')}, 'h') === true ? {history: noteHistory(ctx, PLAYBOOK_SCOPE)} : {})}),
  },
  {
    method: 'PUT',
    path: '/api/playbook',
    allow: ['learner', 'tutor'],
    what: 'writing the playbook',
    handler: (ctx, req) =>
      ctx.write(() => {
        const body = str(req.body, 'body');
        if (body === undefined) throw usageError('send the playbook: --file playbook.md or --stdin');
        return {...setPlaybook(ctx, body, str(req.body, 'note') ?? '')};
      }),
  },
  {
    method: 'POST',
    path: '/api/playbook/revert',
    allow: ['learner'],
    what: 'restoring an earlier playbook',
    handler: (ctx, req) => ctx.write(() => ({...revertPlaybook(ctx, int(req.body, 'version', 1), str(req.body, 'note'))})),
  },
  {
    method: 'POST',
    path: '/api/playbook/seen',
    allow: ['learner'],
    what: 'marking the playbook seen',
    handler: ctx =>
      ctx.write(() => {
        markPlaybookSeen(ctx);
        return {};
      }),
  },
];
