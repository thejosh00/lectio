/**
 * Guard (§17, M12): the tutor and the builder see nothing of a checkup — not its quiz, its
 * questions, the answers, the feedback on it, or the examiner's runs — except the tutor's
 * `exams` results once it is finished. Every GET route is tried, with every id it might be
 * given, and the event stream too. A route added later is covered without being listed.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {allRoutes} from '../../src/server/api.ts';
import {answerQ, ownershipLesson, rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance({settings: {exam_min_age_days: '0'}});
});
afterEach(async () => {
  await lc.stop();
});

const KEYS = ['stack-vs-heap', 'ownership', 'moves'];
const MARKER = 'EXAM-ONLY-PROMPT';

async function openCheckup() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run, ownershipLesson({concepts: KEYS.map(key => ({key, role: 'new'})), blocks: [{type: 'markdown', approach: 'explanation', concepts: KEYS, body: {md: 'x'}}], questions: []}));
  await lc.j(['finish', lesson.json.lesson.id]);
  const examRun = (await lc.j(['run', 'start'], {as: 'agent:examiner'})).json.run.id;
  await lc.j(['exam', 'start', subject, '--run', examRun], {as: 'agent:examiner'});
  const exam = {items: KEYS.map(k => ({question: {type: 'short_text', aim: 'recall', difficulty: 2, concepts: [k], prompt: `${MARKER} ${k}?`, body: {accept: ['yes']}, explanation: 'x'}}))};
  const written = await lc.j(['exam', 'submit', subject, '--run', examRun, '--file', lc.file('exam.json', exam)], {as: 'agent:examiner'});
  await lc.j(['run', 'finish', examRun, '--outcome', 'ok', '--summary', 'Wrote a checkup.'], {as: 'agent:examiner'});
  const questions = written.json.question_ids as string[];
  const quiz = written.json.quiz.id as string;
  const answered = await answerQ(lc, {question: questions[0], quiz, answer: 'no'});
  await lc.j(['dispute', answered.attempt.id]);
  const flag = await lc.j(['rate', 'question', questions[1]!, 'ambiguous']);
  // A flag the examiner has answered: its reply is the learner's to read, never the tutor's.
  const answered2 = await lc.j(['rate', 'question', questions[2]!, 'wrong_key']);
  await lc.j(['reply', answered2.json.feedback.id, '--body', `${MARKER} the key stands`, '--resolved', 'disagreed'], {as: 'agent:examiner'});
  return {subject, lesson: lesson.json.lesson.id as string, quiz, questions, attempt: answered.attempt.id as string, flag: flag.json.feedback.id as string, examRun: examRun as string};
}

/** Everything a GET could be asked for: each route with each id in each parameter, and every query we know. */
function paths(ids: string[]): string[] {
  const query = '?subject=Rust%20ownership&status=all&history=true&since=2000-01-01T00:00:00Z&limit=500&all=true';
  return allRoutes()
    .filter(r => r.method === 'GET')
    .flatMap(r => {
      const filled = r.names.length === 0 ? [r.path] : ids.map(id => r.path.replace(/:[a-z_]+/g, encodeURIComponent(id)));
      return filled.flatMap(p => [p, `${p}${query}`]);
    });
}

async function leaks(actor: string, secrets: string[], allow: (path: string, body: any) => any = (_, body) => body): Promise<string[]> {
  const found: string[] = [];
  const ids = [...secrets.filter(s => s !== MARKER), 'Rust ownership'];
  for (const path of paths(ids)) {
    const response = await fetch(`${lc.url}${path}`, {headers: {authorization: `Bearer ${lc.token(actor)}`}});
    const body = await response.json();
    // A refusal repeats the id it was asked about; anything else it carries (candidates for
    // a prefix, say) still counts.
    const text = JSON.stringify(body.ok === false ? {...body, error: undefined} : allow(path, body));
    for (const secret of secrets) if (text.includes(secret)) found.push(`${path} shows ${secret === MARKER ? 'a checkup prompt' : secret}`);
  }
  // The event stream, from the beginning.
  const controller = new AbortController();
  const response = await fetch(`${lc.url}/api/events?since=0`, {headers: {authorization: `Bearer ${lc.token(actor)}`}, signal: controller.signal});
  const reader = response.body!.getReader();
  let text = '';
  const deadline = Date.now() + 300;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(100).then(() => undefined)]);
    if (chunk === undefined) continue;
    if (chunk.done) break;
    text += new TextDecoder().decode(chunk.value);
  }
  controller.abort();
  for (const secret of secrets) if (text.includes(secret)) found.push(`/api/events shows ${secret === MARKER ? 'a checkup prompt' : secret}`);
  return found;
}

test('while a checkup is open, no GET and no event shows the tutor or the builder anything of it', async () => {
  const c = await openCheckup();
  const secrets = [MARKER, c.quiz, ...c.questions, c.attempt, c.flag, c.examRun];
  for (const actor of ['agent:tutor', 'agent:builder']) expect({actor, leaks: await leaks(actor, secrets)}).toEqual({actor, leaks: []});
  // The learner, meanwhile, sees it — which also shows the probe finds what is there.
  expect(await leaks('you', [c.quiz, MARKER])).toEqual(expect.arrayContaining(['/api/today shows ' + c.quiz, `/api/quizzes/${c.quiz} shows a checkup prompt`]));
});

test('once it is finished, the tutor sees its results in the context, and nowhere else', async () => {
  const c = await openCheckup();
  for (const question of c.questions.slice(1)) await answerQ(lc, {question, quiz: c.quiz, answer: 'yes'});
  // The flag and the dispute stay the examiner's; only the results reach the tutor.
  const withoutResults = (path: string, body: any) => {
    if (!path.startsWith('/api/context')) return body;
    for (const subject of body.subjects ?? []) delete subject.exams;
    return body;
  };
  const secrets = [c.quiz, c.attempt, c.flag, c.examRun];
  expect(await leaks('agent:tutor', [...secrets, MARKER], withoutResults)).toEqual([]);
  const context = (await lc.j(['context'], {as: 'agent:tutor'})).json;
  expect(context.subjects[0].exams[0]).toMatchObject({quiz_id: c.quiz, items: expect.arrayContaining([expect.objectContaining({prompt: `${MARKER} stack-vs-heap?`})])});
});
