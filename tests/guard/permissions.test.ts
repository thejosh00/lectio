/**
 * Guard (§11): what an agent token can never do, whatever else changes. A change that
 * needs one of these to move is a change to who may do what: say so in the hand-back.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {allRoutes} from '../../src/server/api.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const call = (path: string, actor: string, body: unknown = {}) =>
  fetch(`${lc.url}${path}`, {method: 'POST', headers: {authorization: `Bearer ${lc.token(actor)}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});

test('every write names who may make it', () => {
  const unnamed = allRoutes().filter(r => r.method !== 'GET' && (r.allow === undefined || r.allow.length === 0)).map(r => `${r.method} ${r.path}`);
  expect(unnamed).toEqual([]);
});

test('no agent writes attempts, creates feedback, or approves, declines or ships a proposal', async () => {
  for (const actor of ['agent:tutor', 'agent:builder', 'agent:examiner', 'agent:anything']) {
    for (const path of [
      '/api/attempts',
      '/api/attempts/x/self-grade',
      '/api/attempts/x/dispute',
      '/api/feedback',
      '/api/ask',
      '/api/proposals/1/approve',
      '/api/proposals/1/decline',
      '/api/proposals/1/defer',
      '/api/proposals/1/request-changes',
      '/api/proposals/1/shipped',
      '/api/proposals/1/answer',
      '/api/subjects',
      '/api/lessons/x/finish',
      '/api/lessons/x/skip',
      '/api/practice',
    ]) {
      const response = await call(path, actor);
      expect({actor, path, status: response.status}).toEqual({actor, path, status: 403});
    }
    const settings = await fetch(`${lc.url}/api/settings/quiz_max_questions`, {method: 'PUT', headers: {authorization: `Bearer ${lc.token(actor)}`, 'content-type': 'application/json'}, body: '{"value":"99"}'});
    expect(settings.status).toBe(403);
  }
});

test('the examiner writes only checkups, its runs, fixes to its own questions, and replies on its checkups', async () => {
  const writes = allRoutes()
    .filter(r => r.method !== 'GET' && r.allow?.includes('examiner'))
    .map(r => `${r.method} ${r.path}`)
    .sort();
  expect(writes).toEqual(['POST /api/exams/start', 'POST /api/feedback/:ref/reply', 'POST /api/questions/:ref/fix', 'POST /api/runs', 'POST /api/runs/:ref/finish', 'POST /api/subjects/:ref/exams']);
  const reads = allRoutes().filter(r => r.method === 'GET' && r.readers?.includes('examiner')).map(r => r.path).sort();
  expect(reads).toEqual(['/api/agents', '/api/exams/due', '/api/whoami']);
});

test('the builder writes only proposals', async () => {
  const writes = allRoutes().filter(r => r.method !== 'GET' && r.allow?.includes('builder'));
  expect(writes.every(r => r.path.startsWith('/api/proposals'))).toBe(true);
});

test('only the builder claims and submits; only the tutor reviews builds and judges outcomes', async () => {
  for (const actor of ['you', 'agent:tutor']) {
    expect((await call('/api/proposals/1/claim', actor)).status).toBe(403);
    expect((await call('/api/proposals/1/submit', actor)).status).toBe(403);
  }
  for (const actor of ['you', 'agent:builder']) {
    expect((await call('/api/proposals/1/review', actor)).status).toBe(403);
    expect((await call('/api/proposals/1/outcome', actor)).status).toBe(403);
  }
});
