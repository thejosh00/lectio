/**
 * Guard (§15, M21): a widget is untrusted code, even though the tutor wrote it. Its document is
 * served with a CSP sandbox — an opaque origin, no network — so it can't read the session
 * cookie or call /api, even opened directly in a tab while signed in; the libraries route
 * serves only the pinned libraries; and the page takes only the bridge's messages.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {readBridgeMessage} from '../../src/core/widget.ts';
import {createSession} from '../../src/db/auth.ts';
import {inPage} from '../../src/local/chrome.ts';
import {chromePath, realToolDeps} from '../../src/local/tools.ts';
import {ownershipLesson, rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

/** Tries everything a widget mustn't be able to do, and writes down what happened. */
const PROBE = `<pre id="out">running</pre>
<script>
  const seen = {};
  try { seen.cookie = document.cookie; } catch (e) { seen.cookie = 'threw ' + e.name; }
  try { seen.storage = String(localStorage.length); } catch (e) { seen.storage = 'threw ' + e.name; }
  seen.origin = String(self.origin);
  fetch('/api/today').then(r => r.text()).then(t => { seen.api = 'answered ' + t.slice(0, 40); }, () => { seen.api = 'blocked'; }).finally(() => {
    document.getElementById('out').textContent = JSON.stringify(seen);
  });
</script>`;

async function widgetBlock(html = PROBE) {
  const subject = await rustSubject(lc);
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, {type: 'widget', approach: 'interactive', concepts: ['ownership'], body: {kind: 'interactive', html, height: 200, alt: 'a probe', goal: 'none'}}] as never;
  const submitted = await submitLesson(lc, subject, await startRun(lc), lesson);
  expect(submitted.code).toBe(0);
  return (await lc.j(['lesson', 'show', submitted.json.lesson.id], {as: 'agent:tutor'})).json.lesson.blocks[4].id as string;
}

const get = (path: string, auth = true) => fetch(`${lc.url}${path}`, auth ? {headers: {authorization: `Bearer ${lc.token('you')}`}} : {});

test('a widget is served only to someone signed in, under a sandbox that gives it no origin and no network', async () => {
  const id = await widgetBlock();
  expect((await get(`/w/${id}`, false)).status).toBe(401);
  const served = await get(`/w/${id}`);
  expect(served.status).toBe(200);
  const csp = served.headers.get('content-security-policy')!;
  expect(csp).toContain('sandbox allow-scripts');
  expect(csp).not.toContain('allow-same-origin');
  for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", `script-src 'unsafe-inline' ${lc.url}/w/lib/`]) expect(csp).toContain(directive);
  expect(served.headers.get('x-content-type-options')).toBe('nosniff');
  // A block that isn't a widget is not served as one.
  const markdown = (await lc.j(['lesson', 'show', (await lc.j(['lessons'])).json.lessons[0].id], {as: 'agent:tutor'})).json.lesson.blocks[0].id;
  expect((await get(`/w/${markdown}`)).status).toBe(404);
});

test('the libraries route serves the pinned libraries and nothing else', async () => {
  for (const lib of ['d3', 'p5']) {
    const response = await fetch(`${lc.url}/w/lib/${lib}.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
  }
  for (const path of ['/w/lib/react.js', '/w/lib/..%2Fpackage.json', '/w/lib/%2e%2e%2f%2e%2e%2fpackage.json']) expect((await fetch(`${lc.url}${path}`)).status).toBe(404);
});

test('the page takes only the bridge’s shapes', () => {
  for (const junk of [null, 'done', {type: 'done'}, {lectio: 2, type: 'done'}, {lectio: 1, type: 'navigate', to: '/'}, {lectio: 1, type: 'resize', height: 'big'}]) expect(readBridgeMessage(junk)).toBeUndefined();
  expect(readBridgeMessage({lectio: 1, type: 'answer', value: 3, score: 7})).toEqual({type: 'answer', value: 3, score: 1});
  expect(readBridgeMessage({lectio: 1, type: 'event', name: 'x'.repeat(100)})).toEqual({type: 'event', name: 'x'.repeat(40)});
});

const chrome = chromePath(realToolDeps(process.env));
test.skipIf(chrome === null)('opened directly in a tab while signed in, a widget can read no cookie, no storage, and can’t call /api', async () => {
  const id = await widgetBlock();
  const session = createSession(lc.db, lc.clock.now);
  const seen = await inPage(chrome!, `${lc.url}/w/${id}`, {width: 358, height: 200}, page => page.eval("document.getElementById('out').textContent"), {cookies: [{name: 'lectio_session', value: session}]});
  const result = JSON.parse(String(seen)) as Record<string, string>;
  expect(result.cookie).toStartWith('threw');
  expect(result.storage).toStartWith('threw');
  expect(result.origin).toBe('null');
  expect(result.api).toBe('blocked');
}, 30_000);
