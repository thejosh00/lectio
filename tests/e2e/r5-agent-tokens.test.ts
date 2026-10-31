/**
 * R5: agents can't act as you. `client.json` never holds the learner's `you` token beside an
 * agent's (either way round), the examiner's token is kept apart from the tutor's, and
 * `lectio service status` warns when one file holds both.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLIENT_FILE, clientConfig, EXAMINER_CLIENT_FILE, tokenFileWarnings} from '../../src/client.ts';
import {serviceCommand} from '../../src/local/service.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const login = (actor: string, extra: string[] = []) => lc.j(['login', '--url', lc.url, '--token', lc.token(actor), ...extra]);
const actorsIn = (name: string) => Object.keys((JSON.parse(readFileSync(join(lc.dir, name), 'utf8')) as {tokens: Record<string, string>}).tokens);

test('lectio login refuses an agent token into a client.json holding "you"', async () => {
  expect((await login('you')).code).toBe(0);
  const refused = await login('agent:tutor', ['--default']);
  expect(refused.code).toBe(2);
  expect(refused.json).toMatchObject({ok: false, actor: 'agent:tutor'});
  expect(refused.json.error).toContain('an agent could sign in as you');
  expect(actorsIn(CLIENT_FILE)).toEqual(['you']);
});

test('lectio login refuses "you" into a client.json holding agent tokens, and says where to go instead', async () => {
  expect((await login('agent:tutor', ['--default'])).code).toBe(0);
  expect((await login('agent:builder')).code).toBe(0);
  const refused = await login('you');
  expect(refused.code).toBe(2);
  expect(refused.json.error).toContain('agent:tutor, agent:builder');
  expect(refused.json.error).toContain('browser');
  expect(actorsIn(CLIENT_FILE)).toEqual(['agent:tutor', 'agent:builder']);
  // Nothing in the refusal is a token.
  expect(JSON.stringify(refused.json)).not.toContain(lc.token('you'));
});

test("the examiner's token goes to its own file, not beside the tutor's, and --as agent:examiner finds it", async () => {
  expect((await login('agent:tutor', ['--default'])).code).toBe(0);
  const examiner = await login('agent:examiner');
  expect(examiner.code).toBe(0);
  expect(examiner.json.path).toBe(join(lc.dir, EXAMINER_CLIENT_FILE));
  expect(examiner.json.warnings).toEqual([]);
  expect(actorsIn(CLIENT_FILE)).toEqual(['agent:tutor']);
  expect(actorsIn(EXAMINER_CLIENT_FILE)).toEqual(['agent:examiner']);
  expect(clientConfig({}, lc.dir, 'agent:examiner').token).toBe(lc.token('agent:examiner'));
  expect(clientConfig({}, lc.dir).token).toBe(lc.token('agent:tutor'));
  // The examiner's own run may pass its token as LECTIO_TOKEN instead, which wins.
  expect(clientConfig({LECTIO_TOKEN: 'from-its-run'}, lc.dir, 'agent:examiner').token).toBe('from-its-run');
});

test("without its own file or LECTIO_TOKEN, --as agent:examiner says what's missing", () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-r5-'));
  expect(clientConfig({}, dir, 'agent:examiner').missing).toContain(EXAMINER_CLIENT_FILE);
  expect(existsSync(join(dir, EXAMINER_CLIENT_FILE))).toBe(false);
});

test('a warning fires when one token file holds both the tutor and the examiner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-r5-'));
  // What an older setup left: the examiner beside the tutor in client.json.
  writeFileSync(join(dir, CLIENT_FILE), JSON.stringify({url: 'http://h:1', tokens: {'agent:tutor': 'secret-t', 'agent:examiner': 'secret-e'}, default: 'agent:tutor'}));
  const warnings = tokenFileWarnings(dir);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("both the tutor's (agent:tutor) and the examiner's token");
  expect(warnings.join('\n')).not.toContain('secret');

  const err: string[] = [];
  const code = serviceCommand(
    {dataDir: dir, agentsDir: join(dir, 'agents'), platform: 'darwin', uid: 501, out: () => {}, err: line => err.push(line ?? ''), launchctl: () => ({code: 1, stdout: '', stderr: ''})},
    ['status'],
  );
  expect(code).toBe(0);
  expect(err).toEqual(warnings);

  // The builder isn't a tutor: it beside the examiner is no warning; a builder-only file is clean.
  writeFileSync(join(dir, CLIENT_FILE), JSON.stringify({tokens: {'agent:builder': 'b'}}));
  writeFileSync(join(dir, EXAMINER_CLIENT_FILE), JSON.stringify({tokens: {'agent:examiner': 'e'}}));
  expect(tokenFileWarnings(dir)).toEqual([]);
});

test('a warning fires for a client.json that already holds "you" beside agents', async () => {
  writeFileSync(join(lc.dir, CLIENT_FILE), JSON.stringify({tokens: {you: 'secret-y', 'agent:tutor': 'secret-t'}, default: 'agent:tutor'}));
  expect(tokenFileWarnings(lc.dir)).toEqual([expect.stringContaining('holds your "you" token beside agent tokens (agent:tutor)')]);
  // And login won't add to it.
  expect((await login('agent:builder')).code).toBe(2);
});
