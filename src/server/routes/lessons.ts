import {notFound, usageError} from '../../core/errors.ts';
import {fixBlock, finishLesson, getBlock, getLesson, lessonDetail, lessonForDay, unfinishedLessons, listLessons, openLesson, recordActivity, resolveBlock, resolveLesson, reviseLesson, setVerdict, skipLesson, submitLesson} from '../../db/lessons.ts';
import {activeSubjects, resolveSubject} from '../../db/subjects.ts';
import {addFeedback, refuseExamAsk} from '../../db/feedback.ts';
import {getQuestion} from '../../db/questions.ts';
import {resolveId} from '../../db/refs.ts';
import {markRepliesSeen, todayView} from '../../db/today.ts';
import {diagramVerdicts} from '../diagrams.ts';
import {int, q, str, strList, type Route} from '../http.ts';

const LEARNER = ['learner'] as const;
const TUTOR = ['tutor'] as const;

export const lessonRoutes: Route[] = [
  {method: 'GET', path: '/api/today', handler: ctx => ({...todayView(ctx)})},
  {
    method: 'POST',
    path: '/api/replies/seen',
    allow: LEARNER,
    what: "marking the tutor's replies seen",
    handler: ctx =>
      ctx.write(() => {
        markRepliesSeen(ctx);
        return {};
      }),
  },
  {
    method: 'GET',
    path: '/api/lessons',
    handler: (ctx, req) => {
      const subject = q(req, 'subject');
      return {lessons: listLessons(ctx, {subjectId: subject === undefined ? undefined : resolveSubject(ctx, subject).id, state: q(req, 'state'), limit: int({limit: q(req, 'limit')}, 'limit', 1)})};
    },
  },
  {
    method: 'GET',
    path: '/api/hypotheses',
    handler: ctx => ({
      hypotheses: ctx.db
        .query('SELECT l.id, l.subject_id, s.title AS subject, l.day, l.title, l.hypothesis, l.verdict, l.state FROM lessons l JOIN subjects s ON s.id = l.subject_id WHERE l.hypothesis IS NOT NULL ORDER BY l.day DESC LIMIT 100')
        .all(),
    }),
  },
  {
    method: 'GET',
    path: '/api/lessons/current',
    handler: (ctx, req) => {
      const ref = q(req, 'subject');
      const subjects = ref === undefined ? activeSubjects(ctx) : [resolveSubject(ctx, ref)];
      const lessons = subjects.flatMap(s => {
        const lesson = unfinishedLessons(ctx, s.id)[0] ?? lessonForDay(ctx, s.id, ctx.today());
        return lesson === undefined ? [] : [lessonDetail(ctx, lesson)];
      });
      return {lessons};
    },
  },
  {method: 'GET', path: '/api/lessons/:ref', handler: (ctx, req) => ({lesson: lessonDetail(ctx, resolveLesson(ctx, req.params['ref']))})},
  {
    method: 'POST',
    path: '/api/subjects/:ref/lessons',
    allow: ['learner', 'tutor'],
    what: 'writing lessons',
    handler: async (ctx, req) => {
      const diagrams = await diagramVerdicts(req.body['lesson']);
      return ctx.write(() => {
        if (req.body['lesson'] === undefined) throw usageError('send the lesson JSON: --file lesson.json or --stdin');
        const result = submitLesson(ctx, resolveSubject(ctx, req.params['ref']), {day: str(req.body, 'day'), run: str(req.body, 'run'), lesson: req.body['lesson'], diagrams});
        return {...result};
      });
    },
  },
  {
    method: 'PUT',
    path: '/api/lessons/:ref',
    allow: ['learner', 'tutor'],
    what: 'revising lessons',
    handler: async (ctx, req) => {
      const diagrams = await diagramVerdicts(req.body['lesson']);
      return ctx.write(() => {
        if (req.body['lesson'] === undefined) throw usageError('send the lesson JSON: --file lesson.json or --stdin');
        return {...reviseLesson(ctx, resolveLesson(ctx, req.params['ref']), {lesson: req.body['lesson'], diagrams})};
      });
    },
  },
  {
    method: 'POST',
    path: '/api/lessons/:ref/open',
    allow: LEARNER,
    what: 'opening lessons',
    handler: (ctx, req) => ctx.write(() => ({lesson: lessonDetail(ctx, openLesson(ctx, resolveLesson(ctx, req.params['ref'])))})),
  },
  {
    method: 'POST',
    path: '/api/lessons/:ref/finish',
    allow: LEARNER,
    what: 'finishing lessons',
    handler: (ctx, req) => ctx.write(() => ({...finishLesson(ctx, resolveLesson(ctx, req.params['ref']), {rate: str(req.body, 'rate'), note: str(req.body, 'note')})})),
  },
  {
    method: 'POST',
    path: '/api/lessons/:ref/skip',
    allow: LEARNER,
    what: 'skipping lessons',
    handler: (ctx, req) => ctx.write(() => ({...skipLesson(ctx, resolveLesson(ctx, req.params['ref']), {reason: str(req.body, 'reason'), note: str(req.body, 'note')})})),
  },
  {
    method: 'POST',
    path: '/api/lessons/:ref/activity',
    allow: LEARNER,
    what: 'reporting reading time',
    handler: (ctx, req) => ctx.write(() => recordActivity(ctx, resolveLesson(ctx, req.params['ref']), req.body)),
  },
  {
    method: 'POST',
    path: '/api/lessons/:ref/verdict',
    allow: TUTOR,
    what: 'recording verdicts on hypotheses',
    handler: (ctx, req) => ctx.write(() => ({lesson: setVerdict(ctx, resolveLesson(ctx, req.params['ref']), str(req.body, 'note'))})),
  },
  {
    method: 'POST',
    path: '/api/ask',
    allow: LEARNER,
    what: 'asking the tutor',
    handler: (ctx, req) =>
      ctx.write(() => {
        const ref = str(req.body, 'ref');
        const tryId = (kind: 'block' | 'question') => {
          try {
            return resolveId(ctx, kind, ref);
          } catch {
            return undefined;
          }
        };
        const blockId = tryId('block');
        const questionId = blockId === undefined ? tryId('question') : undefined;
        if (blockId === undefined && questionId === undefined) throw notFound(`no block or question "${ref ?? ''}"`);
        const target = blockId !== undefined && getBlock(ctx, blockId) !== undefined ? 'block' : 'question';
        if (target === 'question' && getQuestion(ctx, questionId!) === undefined) throw notFound(`no block or question "${ref ?? ''}"`);
        refuseExamAsk(ctx, {target, target_id: (blockId ?? questionId)!});
        return {feedback: addFeedback(ctx, {target, target_id: (blockId ?? questionId)!, kind: 'ask', note: str(req.body, 'note') ?? ''})};
      }),
  },
  {
    method: 'GET',
    path: '/api/blocks/:ref',
    handler: (ctx, req) => {
      const block = resolveBlock(ctx, req.params['ref']);
      const lesson = getLesson(ctx, block.lesson_id)!;
      return {block, lesson: {id: lesson.id, title: lesson.title, day: lesson.day, subject_id: lesson.subject_id}};
    },
  },
  {
    method: 'POST',
    path: '/api/blocks/:ref/fix',
    allow: TUTOR,
    what: 'fixing blocks',
    handler: async (ctx, req) => {
      const diagrams = await diagramVerdicts(req.body['block']);
      return ctx.write(() => {
        if (req.body['block'] === undefined) throw usageError('send the block JSON: --file block.json');
        return {...fixBlock(ctx, resolveBlock(ctx, req.params['ref']), {block: req.body['block'], resolve: strList(req.body, 'resolve'), reply: str(req.body, 'reply'), diagrams})};
      });
    },
  },
];
