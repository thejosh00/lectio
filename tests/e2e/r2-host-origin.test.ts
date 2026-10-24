/**
 * R2: the server answers only to this machine's loopback names and the names in
 * allowed_hosts, and refuses writes from a foreign Origin — so a web page using DNS
 * rebinding, or a stranger on the network, gets a 403 that says how to allow a name.
 * Mirrors legenda's R2 test.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {setSetting} from '../../src/db/settings.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
let port: number;
beforeEach(async () => {
  lc = await startInstance();
  port = lc.server.server.port!;
});
afterEach(async () => {
  await lc.stop();
});

const whoami = (host: string) =>
  fetch(`http://127.0.0.1:${port}/api/whoami`, {headers: {host, authorization: `Bearer ${lc.token('you')}`}});

const signIn = (headers: Record<string, string>) =>
  fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify({token: lc.token('you')}),
  });

test('a request for a foreign host is refused with 403, naming the host and allowed_hosts', async () => {
  const response = await whoami('evil.example');
  expect(response.status).toBe(403);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body.error).toContain('"evil.example"');
  expect(body.error).toContain('allowed_hosts');
  expect(body.error).toContain('lectio settings set allowed_hosts evil.example');
});

test('the refusal reaches every route, even ones that do not exist', async () => {
  expect((await fetch(`http://127.0.0.1:${port}/api/events`, {headers: {host: 'evil.example'}})).status).toBe(403);
  expect((await fetch(`http://127.0.0.1:${port}/nothing-here`, {headers: {host: 'evil.example'}})).status).toBe(403);
  expect((await fetch(`http://127.0.0.1:${port}/nothing-here`)).status).toBe(404);
});

test('a foreign host with our port, or a loopback name on another port, is refused', async () => {
  expect((await whoami(`evil.example:${port}`)).status).toBe(403);
  expect((await whoami(`localhost:${port + 1}`)).status).toBe(403);
  expect((await whoami('localhost')).status).toBe(403);
});

test('localhost, 127.0.0.1 and [::1] with our port are answered', async () => {
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
    const response = await whoami(host);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok: true, actor: 'you'});
  }
});

test('a name added to allowed_hosts is answered, and takes effect without a restart', async () => {
  expect((await whoami(`mac.local:${port}`)).status).toBe(403);
  setSetting(lc.db, 'allowed_hosts', 'mac.local, phone-proxy.lan');
  expect((await whoami(`mac.local:${port}`)).status).toBe(200);
  expect((await whoami(`phone-proxy.lan:${port}`)).status).toBe(200);
  expect((await whoami(`evil.example:${port}`)).status).toBe(403);
  // The suggested command keeps what is already allowed.
  const body = await (await whoami(`other.lan:${port}`)).json();
  expect(body.error).toContain('lectio settings set allowed_hosts mac.local,phone-proxy.lan,other.lan');
});

test('allowed_hosts can be set from the CLI, and rejects things that are not host names', async () => {
  const ok = await lc.j(['settings', 'set', 'allowed_hosts', 'mac.local']);
  expect(ok.code).toBe(0);
  expect((await whoami(`mac.local:${port}`)).status).toBe(200);
  const bad = await lc.j(['settings', 'set', 'allowed_hosts', 'mac.local,evil example/x']);
  expect(bad.code).not.toBe(0);
  expect(bad.json.error).toContain('allowed_hosts');
});

test('a POST with a foreign Origin is refused with 403', async () => {
  const response = await signIn({origin: 'http://evil.example'});
  expect(response.status).toBe(403);
  const body = await response.json();
  expect(body.error).toContain('evil.example');
  expect(body.error).toContain('allowed_hosts');
  // https to our own host is not our origin either; nor is the opaque "null".
  expect((await signIn({origin: `https://127.0.0.1:${port}`})).status).toBe(403);
  expect((await signIn({origin: 'null'})).status).toBe(403);
});

test('a POST with a matching Origin, or none, is answered', async () => {
  expect((await signIn({})).status).toBe(200);
  expect((await signIn({origin: `http://127.0.0.1:${port}`})).status).toBe(200);
  expect((await signIn({origin: `http://localhost:${port}`})).status).toBe(200);
  setSetting(lc.db, 'allowed_hosts', 'mac.local');
  expect((await signIn({host: `mac.local:${port}`, origin: `http://mac.local:${port}`})).status).toBe(200);
});

test('a GET carrying a foreign Origin is still answered (reads are not cross-origin writes)', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/whoami`, {headers: {origin: 'http://evil.example', authorization: `Bearer ${lc.token('you')}`}});
  expect(response.status).toBe(200);
});

test("the CLI (what the tutor and builder skills run) still reaches the server over 127.0.0.1 and localhost", async () => {
  for (const url of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
    const tutor = await lc.j(['due'], {as: 'agent:tutor', env: {LECTIO_URL: url}});
    expect(tutor.code).toBe(0);
    expect(tutor.json).toHaveProperty('due');
    const builder = await lc.j(['proposals', 'due'], {as: 'agent:builder', env: {LECTIO_URL: url}});
    expect(builder.code).toBe(0);
    expect(builder.json).toHaveProperty('due');
  }
});

test('/api/health and the static files the page loads stay reachable on localhost', async () => {
  expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
  expect((await fetch(`http://127.0.0.1:${port}/api/health`, {headers: {host: 'evil.example'}})).status).toBe(403);
});
