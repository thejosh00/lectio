import {listConcepts, upsertConcepts} from '../../db/concepts.ts';
import type {Ctx} from '../../db/context.ts';
import {readinessOf} from '../../db/lessons.ts';
import {memoryOf} from '../../db/memory.ts';
import {noteView, subjectScope} from '../../db/notes.ts';
import {addSubject, editSubject, listSubjects, resolveSubject, setSubjectStatus, type SubjectInput} from '../../db/subjects.ts';
import type {Subject} from '../../core/types.ts';
import {usageError} from '../../core/errors.ts';
import {bool, int, q, str, type Route} from '../http.ts';

const LEARNER = ['learner'] as const;

function subjectInput(body: Record<string, unknown>): SubjectInput {
  return {
    title: str(body, 'title'),
    goal: str(body, 'goal'),
    level: str(body, 'level'),
    minutes_per_day: int(body, 'minutes_per_day', 1),
    days: str(body, 'days'),
    note: str(body, 'note'),
  };
}

/** The syllabus with each concept's memory: recall now and the next review. */
export function syllabus(ctx: Ctx, subject: Subject) {
  const today = ctx.today();
  return listConcepts(ctx, subject.id).map(c => ({...c, memory: memoryOf(ctx, c.id, today)}));
}

export const subjectRoutes: Route[] = [
  {method: 'GET', path: '/api/subjects', handler: (ctx, req) => ({subjects: listSubjects(ctx, {all: bool({all: q(req, 'all')}, 'all') === true})})},
  {
    method: 'POST',
    path: '/api/subjects',
    allow: LEARNER,
    what: 'adding subjects',
    handler: (ctx, req) => ctx.write(() => ({subject: addSubject(ctx, subjectInput(req.body))})),
  },
  {
    method: 'GET',
    path: '/api/subjects/:ref',
    handler: (ctx, req) => {
      const subject = resolveSubject(ctx, req.params['ref']);
      const readiness = readinessOf(ctx, subject);
      return {subject, concepts: syllabus(ctx, subject), plan: noteView(ctx, subjectScope(subject.id)), readiness};
    },
  },
  {
    method: 'PATCH',
    path: '/api/subjects/:ref',
    allow: LEARNER,
    what: 'editing subjects',
    handler: (ctx, req) => ctx.write(() => editSubject(ctx, resolveSubject(ctx, req.params['ref']), subjectInput(req.body))),
  },
  {
    method: 'POST',
    path: '/api/subjects/:ref/status',
    allow: LEARNER,
    what: 'pausing, resuming or archiving subjects',
    handler: (ctx, req) =>
      ctx.write(() => {
        const status = str(req.body, 'status');
        if (status === undefined) throw usageError('which status? active, paused or archived');
        return {subject: setSubjectStatus(ctx, resolveSubject(ctx, req.params['ref']), status)};
      }),
  },
  {
    method: 'GET',
    path: '/api/subjects/:ref/concepts',
    handler: (ctx, req) => ({concepts: syllabus(ctx, resolveSubject(ctx, req.params['ref']))}),
  },
  {
    method: 'POST',
    path: '/api/subjects/:ref/concepts',
    allow: ['learner', 'tutor'],
    what: 'changing the syllabus',
    handler: (ctx, req) => ctx.write(() => ({...upsertConcepts(ctx, resolveSubject(ctx, req.params['ref']), req.body['concepts'])})),
  },
];
