/**
 * M3: what the web app relies on — the page and its bundle, signing a browser in with a
 * `you` token, live updates (a lesson the tutor submits reaches an open browser), the
 * on-demand KaTeX files, and the reading-time beacons.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

async function signIn(token: string): Promise<Response> {
  return fetch(`${lc.url}/api/session`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token})});
}

async function cookie(): Promise<string> {
  return (await signIn(lc.token('you'))).headers.get('set-cookie')!.split(';')[0]!;
}

test('the page and its script are served, without KaTeX fonts in the bundle', async () => {
  const page = await fetch(`${lc.url}/`);
  expect(page.status).toBe(200);
  const html = await page.text();
  const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  const css = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(html)?.[1];
  const js = await fetch(new URL(script!, lc.url));
  expect(js.status).toBe(200);
  expect(await js.text()).toContain('lectio');
  const styles = await (await fetch(new URL(css!, lc.url))).text();
  expect(styles.length).toBeLessThan(100_000);
  expect(styles).not.toContain('KaTeX_Main');
});

test('KaTeX loads on demand from the installed package, and nothing outside it is served', async () => {
  const css = await fetch(`${lc.url}/katex/katex.min.css`);
  expect(css.status).toBe(200);
  expect(css.headers.get('content-type')).toContain('text/css');
  const font = /url\((fonts\/KaTeX_Main-Regular\.woff2)\)/.exec(await css.text())?.[1];
  expect((await fetch(`${lc.url}/katex/${font}`)).headers.get('content-type')).toBe('font/woff2');
  expect((await fetch(`${lc.url}/katex/..%2F..%2Fpackage.json`)).status).toBe(404);
  expect((await fetch(`${lc.url}/katex/katex.js`)).status).toBe(404);
});

test('a browser signs in with a you token and gets a session cookie; agent tokens are refused', async () => {
  expect((await signIn('nope')).status).toBe(403);
  expect((await signIn(lc.token('agent:tutor'))).status).toBe(403);
  const who = await (await fetch(`${lc.url}/api/whoami`, {headers: {cookie: await cookie()}})).json();
  expect(who).toMatchObject({ok: true, actor: 'you', role: 'learner', today: '2026-09-12'});
  expect((await fetch(`${lc.url}/api/whoami`)).status).toBe(401);
});

test('a lesson the tutor submits is pushed to an open browser', async () => {
  const subject = await rustSubject(lc);
  const controller = new AbortController();
  const stream = await fetch(`${lc.url}/api/events`, {headers: {cookie: await cookie()}, signal: controller.signal});
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = async (needle: string) => {
    while (!text.includes(needle)) {
      const {value, done} = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
  };
  await until('event: hello');
  await submitLesson(lc, subject, await startRun(lc));
  await until('"entity":"lesson"');
  controller.abort();
  expect(text).toContain('"actor":"agent:tutor"');
  expect(text).toContain('"kind":"added"');
});

test('reading time arrives in batches and opens the lesson; only for the learner', async () => {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc));
  const id = lesson.json.lesson.id;
  const blocks = (await lc.j(['lesson', 'show', id])).json.lesson.blocks;
  const beacon = (body: unknown, headers: Record<string, string>) => fetch(`${lc.url}/api/lessons/${id}/activity`, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  const c = await cookie();
  const first = await beacon({active_seconds: 30, blocks: [{id: blocks[0].id, seen_seconds: 20}, {id: blocks[1].id, seen_seconds: 10}]}, {cookie: c});
  expect(first.status).toBe(200);
  await beacon({active_seconds: 15, blocks: [{id: blocks[1].id, seen_seconds: 15, interactions: 2, completed: true}, {id: 'not-a-block', seen_seconds: 99}]}, {cookie: c});
  const after = (await lc.j(['lesson', 'show', id])).json.lesson;
  expect(after).toMatchObject({state: 'open', active_seconds: 45});
  expect(after.blocks[0]).toMatchObject({seen_seconds: 20});
  expect(after.blocks[1]).toMatchObject({seen_seconds: 25, interactions: 2, completed: true});
  expect((await beacon({active_seconds: 5}, {authorization: `Bearer ${lc.token('agent:tutor')}`})).status).toBe(403);
  expect((await beacon({active_seconds: 99_999}, {cookie: c})).status).toBe(400);
});

test('a lesson shows the reactions to it, with the tutor\'s replies', async () => {
  const subject = await rustSubject(lc);
  const lesson = await submitLesson(lc, subject, await startRun(lc));
  const block = (await lc.j(['lesson', 'show', lesson.json.lesson.id])).json.lesson.blocks[0];
  const ask = await lc.j(['ask', block.id, 'Why one owner?']);
  await lc.j(['reply', ask.json.feedback.id, '--body', 'So exactly one place frees it.'], {as: 'agent:tutor'});
  const detail = await (await fetch(`${lc.url}/api/lessons/${lesson.json.lesson.id}`, {headers: {cookie: await cookie()}})).json();
  expect(detail.lesson.feedback).toEqual([expect.objectContaining({kind: 'ask', target_id: block.id, reply: 'So exactly one place frees it.'})]);
});

test('a failed request is written to the server log', async () => {
  const response = await fetch(`${lc.url}/api/lessons/nope-nope`, {headers: {authorization: `Bearer ${lc.token('you')}`}});
  const {error} = await response.json();
  expect(lc.log).toContainEqual(expect.stringContaining(`GET /api/lessons/nope-nope ${response.status} (you): ${error}`));
});
