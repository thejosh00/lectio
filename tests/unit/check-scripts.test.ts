/**
 * The otto check scripts: exit 1 (wake) when there is something to do, 0 when there
 * isn't or the server is down, 2 on anything else — against a real server.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {chmodSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {startInstance, type Instance} from '../helpers/instance.ts';

const ROOT = resolve(import.meta.dir, '..', '..');
let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

async function check(script: string, env: Record<string, string>, bin?: string): Promise<number> {
  const wrapper = join(lc.dir, 'lectio');
  writeFileSync(wrapper, bin ?? `#!/bin/sh\nexec bun '${join(ROOT, 'src', 'cli.ts')}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  // Async: the server under test runs in this process and must keep answering.
  return Bun.spawn(['sh', join(ROOT, 'skills', script, 'check.sh')], {env: {...process.env, LECTIO_BIN: wrapper, LECTIO_DIR: lc.dir, ...env}, stdout: 'pipe', stderr: 'pipe'}).exited;
}

test('the tutor check wakes only when something is due', async () => {
  const env = {LECTIO_URL: lc.url, LECTIO_TOKEN: lc.token('agent:tutor')};
  expect(await check('lectio-teach', env)).toBe(0);
  await lc.j(['subject', 'add', 'Rust']);
  expect(await check('lectio-teach', env)).toBe(1);
  expect(await check('lectio-teach', {...env, LECTIO_URL: 'http://127.0.0.1:1'})).toBe(0);
  expect(await check('lectio-teach', env, '#!/bin/sh\nexit 3\n')).toBe(2);
});

test('the examiner check wakes only when a subject is due a checkup', async () => {
  await lc.cli(['login', '--url', lc.url, '--token', lc.token('agent:examiner')]);
  const env = {LECTIO_URL: lc.url, LECTIO_TOKEN: ''};
  expect(await check('lectio-examine', env)).toBe(0);
  const subject = (await lc.j(['subject', 'add', 'Rust'])).json.subject.id;
  const concepts = ['a', 'b', 'c'].map((key, position) => ({key, title: key, position}));
  await lc.j(['concepts', 'upsert', subject, '--file', lc.file('c.json', concepts)], {as: 'agent:tutor'});
  lc.db.query("UPDATE concepts SET status = 'introduced', introduced = '2026-09-01T00:00:00Z'").run();
  expect(await check('lectio-examine', env)).toBe(1);
});

test('the builder check wakes only for an approved proposal', async () => {
  await lc.cli(['login', '--url', lc.url, '--token', lc.token('agent:builder')]);
  const env = {LECTIO_URL: lc.url, LECTIO_TOKEN: ''};
  expect(await check('lectio-build', env)).toBe(0);
  await lc.j(['proposal', 'add', '--file', lc.file('p.json', {title: 'x', area: 'other', problem: 'p', change: 'c', success: 's'})]);
  expect(await check('lectio-build', env)).toBe(1);
});
