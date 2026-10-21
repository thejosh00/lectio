import {usageError} from '../../core/errors.ts';
import {activeSubjects, resolveSubject} from '../../db/subjects.ts';
import {assemblePractice, listQuizzes, openQuiz, quizDetail, resolveQuiz, submitQuiz} from '../../db/quizzes.ts';
import {int, q, str, type Route} from '../http.ts';

export const quizRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/quizzes',
    handler: (ctx, req) => {
      const subject = q(req, 'subject');
      return {quizzes: listQuizzes(ctx, {subjectId: subject === undefined ? undefined : resolveSubject(ctx, subject).id, limit: int({limit: q(req, 'limit')}, 'limit', 1)})};
    },
  },
  {method: 'GET', path: '/api/quizzes/:ref', handler: (ctx, req) => ({quiz: quizDetail(ctx, resolveQuiz(ctx, req.params['ref']))})},
  {
    method: 'POST',
    path: '/api/subjects/:ref/quizzes',
    allow: ['learner', 'tutor'],
    what: 'writing quizzes',
    handler: (ctx, req) =>
      ctx.write(() => {
        if (req.body['quiz'] === undefined) throw usageError('send the quiz JSON: --file quiz.json or --stdin');
        return {...submitQuiz(ctx, resolveSubject(ctx, req.params['ref']), {day: str(req.body, 'day'), run: str(req.body, 'run'), kind: str(req.body, 'kind'), quiz: req.body['quiz']})};
      }),
  },
  {
    method: 'POST',
    path: '/api/quizzes/:ref/open',
    allow: ['learner'],
    what: 'taking quizzes',
    handler: (ctx, req) => ctx.write(() => ({quiz: quizDetail(ctx, openQuiz(ctx, resolveQuiz(ctx, req.params['ref'])))})),
  },
  {
    method: 'POST',
    path: '/api/practice',
    allow: ['learner'],
    what: 'starting practice',
    handler: (ctx, req) =>
      ctx.write(() => {
        const ref = str(req.body, 'subject');
        const max = int(req.body, 'max', 1);
        const subjects = ref === undefined ? activeSubjects(ctx) : [resolveSubject(ctx, ref)];
        const results = subjects.map(subject => ({subject: {id: subject.id, title: subject.title}, ...assemblePractice(ctx, subject, max)}));
        return {practice: results.filter(r => r.quiz !== null || ref !== undefined), due: results.reduce((sum, r) => sum + r.due, 0)};
      }),
  },
];
