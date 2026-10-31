/**
 * R5: a widget question scores itself with code the tutor wrote, so its attempts stay out of
 * the measures the tutor is graded on — the predictions measure (M11) and the experiment arms
 * (M14) — while still counting for memory.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {answerQ, ownershipLesson, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const widget = {
  type: 'widget',
  aim: 'apply',
  difficulty: 3,
  concepts: ['ownership'],
  prompt: 'Drag the owner onto the value.',
  body: {html: '<button id="go">Done</button><script>document.getElementById("go").onclick = () => lectio.answer({value: 1, score: 1});</script>', height: 120, alt: 'a drag target'},
  explanation: 'The owner is the variable bound to the value.',
};

async function widgetAndShortText(lessonOver: Record<string, unknown> = {}) {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc), ownershipLesson(lessonOver));
  expect(lesson.json.ok).toBe(true);
  const quiz = ownershipQuiz(lesson.json.lesson.id);
  quiz.items = [{role: 'new', predict: 0.9, question: widget}, {...(quiz.items[0] as object), predict: 0.9}] as never;
  const submitted = await submitQuiz(lc, subject, await startRun(lc), quiz);
  expect(submitted.code).toBe(0);
  await lc.j(['finish', lesson.json.lesson.id]);
  const [widgetId, textId] = submitted.json.question_ids as [string, string];
  const quizId = submitted.json.quiz.id as string;
  // The widget reports exactly what the tutor predicted would happen; the learner misses the other.
  await answerQ(lc, {question: widgetId, quiz: quizId, answer: {value: 1, score: 1}});
  lc.advance({minutes: 1});
  await answerQ(lc, {question: textId, quiz: quizId, answer: 'nobody'});
  return {subject, widgetId, textId};
}

test('widget-scored attempts are left out of the predictions measure but still count for memory', async () => {
  const {subject, widgetId} = await widgetAndShortText();
  const progress = (await lc.j(['progress', '--subject', subject])).json.progress;
  expect(progress.predictions.n).toBe(1);
  expect(JSON.stringify(progress.predictions)).not.toContain(widgetId);
  expect(progress.self_scored).toMatchObject({widget_attempts: 1, excluded_from: ['predictions', 'experiments']});
  expect(progress.self_scored.note).toContain('still count for memory');
  expect(lc.db.query('SELECT counts_for_memory FROM attempts WHERE question_id = ?').get(widgetId)).toEqual({counts_for_memory: 1});
});

test('widget-scored attempts are left out of the experiment-arm measures', async () => {
  const lessonOver = {
    experiment: {name: 'worked_vs_problem_first', arms: {a: 'worked first', b: 'problem first'}},
    blocks: [
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], body: {md: 'Every value has one owner.'}},
      {type: 'markdown', approach: 'worked_example', concepts: ['ownership'], arm: 'a', body: {md: 'A worked trace.'}},
      {type: 'markdown', approach: 'problem_first', concepts: ['ownership'], arm: 'b', body: {md: 'Try it first.'}},
      {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q1'}},
    ],
  };
  const {subject} = await widgetAndShortText(lessonOver);
  const experiment = (await lc.j(['progress', '--subject', subject])).json.progress.experiments[0];
  const sameDay = [experiment.a.same_day_accuracy, experiment.b.same_day_accuracy];
  // One arm taught; its only counted new item is the missed short-text one, not the widget's 1.
  expect(sameDay.map(r => r.n).sort()).toEqual([0, 1]);
  expect(sameDay.find(r => r.n === 1)).toMatchObject({n: 1, rate: 0});
});
