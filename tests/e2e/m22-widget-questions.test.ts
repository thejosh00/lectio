/**
 * M22: widget questions. The learner does something in a widget and the widget scores it; the
 * score lands on the attempt as graded by the widget and counts for memory like any other. It
 * is served in the same sandbox as a widget block; a checkup can't use one.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {answerQ, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const HTML = `<input id="t" type="range" min="0" max="255" value="0">
<button id="go">That's it</button>
<script>
  document.getElementById('go').onclick = () => {
    const t = Number(document.getElementById('t').value);
    lectio.answer({value: {threshold: t}, score: t >= 100 && t <= 140 ? 1 : 0});
  };
</script>`;
const question = (over: Record<string, unknown> = {}) => ({
  type: 'widget',
  aim: 'apply',
  difficulty: 3,
  concepts: ['ownership'],
  prompt: 'Set the threshold so only the edges are left.',
  body: {html: HTML, height: 200, alt: 'a threshold slider over an edge map'},
  explanation: 'Between about 100 and 140 the noise is gone and the edges stay.',
  ...over,
});

test('a widget question is graded by the widget, counts for memory, and is served in the sandbox', async () => {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc));
  const quiz = ownershipQuiz(lesson.json.lesson.id);
  quiz.items = [{role: 'new', predict: 0.6, question: question()}] as never;
  const submitted = await submitQuiz(lc, subject, await startRun(lc), quiz);
  expect(submitted.code).toBe(0);
  const id = submitted.json.question_ids[0] as string;
  await lc.j(['finish', lesson.json.lesson.id]);

  // The learner's view has no HTML: the widget is served on its own.
  const view = (await lc.j(['quiz', 'show', submitted.json.quiz.id])).json.quiz.items[0].question;
  expect(view).toMatchObject({type: 'widget', graded_by: 'widget', body: {height: 200, alt: 'a threshold slider over an edge map'}});
  expect(view.body.html).toBeUndefined();
  const served = await fetch(`${lc.url}/w/q/${id}`, {headers: {authorization: `Bearer ${lc.token('you')}`}});
  expect(served.status).toBe(200);
  expect(served.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
  expect(await served.text()).toContain('lectio.answer({value: {threshold: t}');
  expect((await fetch(`${lc.url}/w/q/${id}`)).status).toBe(401);

  // A score outside 0–1 is refused; one inside is the attempt's score, graded by the widget.
  expect((await answerQ(lc, {question: id, quiz: submitted.json.quiz.id, answer: {value: {threshold: 120}, score: 2}})).ok).toBe(false);
  const answered = await answerQ(lc, {question: id, quiz: submitted.json.quiz.id, answer: {value: {threshold: 120}, score: 1}});
  expect(answered.outcome).toMatchObject({score: 1, graded_by: 'widget', needs_self_grade: false, disputable: false});
  expect(lc.db.query('SELECT counts_for_memory, graded_by FROM attempts WHERE question_id = ?').get(id)).toEqual({counts_for_memory: 1, graded_by: 'widget'});
});

test("a widget question must be answerable, belongs to the tutor's quizzes, and the terminal sends the learner to the web", async () => {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc));
  const quiz = ownershipQuiz(lesson.json.lesson.id);
  quiz.items = [{role: 'new', predict: 0.6, question: question({body: {html: '<p>no answer here</p>', height: 200, alt: 'x'}})}] as never;
  const refused = await submitQuiz(lc, subject, await startRun(lc), quiz);
  expect(refused.json.errors).toEqual([{path: 'items[0].question.body.html', message: expect.stringContaining('never calls lectio.answer')}]);

  quiz.items = [{role: 'new', predict: 0.6, question: question()}, ...ownershipQuiz(lesson.json.lesson.id).items.slice(0, 1)] as never;
  const submitted = await submitQuiz(lc, subject, await startRun(lc), quiz);
  await lc.j(['finish', lesson.json.lesson.id]);
  expect(submitted.code).toBe(0);
  const taken = await lc.cli(['quiz'], {lines: ['owner', 's']});
  expect(taken.stdout).toContain('Set the threshold so only the edges are left.\n  (a widget question: open it in the web app)\n\n[2/2]');
  expect(taken.stdout).toContain('✓ right');
});
