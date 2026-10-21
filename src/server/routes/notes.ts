import {usageError} from '../../core/errors.ts';
import {LEARNER_SCOPE, noteHistory, noteView, setNote, subjectScope} from '../../db/notes.ts';
import {resolveSubject} from '../../db/subjects.ts';
import type {Ctx} from '../../db/context.ts';
import {bool, q, str, type Route} from '../http.ts';

function scopeOf(ctx: Ctx, subject: string | undefined): string {
  return subject === undefined ? LEARNER_SCOPE : subjectScope(resolveSubject(ctx, subject).id);
}

export const noteRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/notes',
    handler: (ctx, req) => {
      const scope = scopeOf(ctx, q(req, 'subject'));
      return {notes: noteView(ctx, scope), ...(bool({h: q(req, 'history')}, 'h') === true ? {history: noteHistory(ctx, scope)} : {})};
    },
  },
  {
    method: 'PUT',
    path: '/api/notes',
    allow: ['learner', 'tutor'],
    what: 'writing notes',
    handler: (ctx, req) =>
      ctx.write(() => {
        const body = str(req.body, 'body');
        if (body === undefined) throw usageError('send the notes on stdin: --stdin');
        const result = setNote(ctx, scopeOf(ctx, str(req.body, 'subject')), body, str(req.body, 'note') ?? '');
        return {notes: noteView(ctx, result.note.scope), changed: result.changed};
      }),
  },
];
