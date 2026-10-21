import {expect, test} from 'bun:test';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {clientConfig, writeClientToken} from '../../src/client.ts';
import {resolveDataDir} from '../../src/config.ts';

test('data dir: flag, then LECTIO_DIR, then ~/.lectio', () => {
  const base = {home: '/home/u', cwd: '/work'};
  expect(resolveDataDir({...base, env: {}})).toBe('/home/u/.lectio');
  expect(resolveDataDir({...base, env: {LECTIO_DIR: '~/other'}})).toBe('/home/u/other');
  expect(resolveDataDir({...base, env: {LECTIO_DIR: '/x'}, flag: 'rel'})).toBe('/work/rel');
});

test('client.json: one token per actor, the first is the default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-client-'));
  writeClientToken(dir, {url: 'http://h:1/', actor: 'agent:tutor', token: 't1', makeDefault: false});
  writeClientToken(dir, {url: 'http://h:1', actor: 'agent:builder', token: 't2', makeDefault: false});
  expect(clientConfig({}, dir)).toEqual({url: 'http://h:1', token: 't1'});
  expect(clientConfig({}, dir, 'agent:builder').token).toBe('t2');
  expect(clientConfig({LECTIO_TOKEN: 'env'}, dir).token).toBe('env');
  expect(clientConfig({}, dir, 'you').missing).toContain('no token for you');
  writeClientToken(dir, {url: 'http://h:1', actor: 'agent:builder', token: 't2', makeDefault: true});
  expect(clientConfig({}, dir).token).toBe('t2');
});

test('a legacy single-token file still works', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-client-'));
  writeFileSync(join(dir, 'client.json'), JSON.stringify({url: 'http://h:2', token: 'old'}));
  expect(clientConfig({}, dir)).toEqual({url: 'http://h:2', token: 'old'});
});
