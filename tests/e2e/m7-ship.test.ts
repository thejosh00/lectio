/**
 * M7: knowing what shipped, and shipping safely. A scratch git repo stands in for the
 * lectio checkout; a real `lectio serve` runs against a scratch instance.
 */
import {afterAll, afterEach, beforeAll, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Database} from 'bun:sqlite';
import {run} from '../../src/cli.ts';
import {noteRunningCommit} from '../../src/local/git.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

const ROOT = resolve(import.meta.dir, '..', '..');
const CLI = join(ROOT, 'src', 'cli.ts');
const SHIP = join(ROOT, 'scripts', 'ship.sh');

function sh(cwd: string, ...cmd: string[]): string {
  const result = Bun.spawnSync(cmd, {cwd, stdout: 'pipe', stderr: 'pipe'});
  if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** A repo with one commit on main. */
function scratchRepo(files: Record<string, string> = {}): string {
  const repo = mkdtempSync(join(tmpdir(), 'lectio-repo-'));
  sh(repo, 'git', 'init', '-q', '-b', 'main');
  sh(repo, 'git', 'config', 'user.email', 'test@example.com');
  sh(repo, 'git', 'config', 'user.name', 'test');
  writeFileSync(join(repo, 'README.md'), 'scratch\n');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), {recursive: true});
    writeFileSync(join(repo, path), content);
  }
  sh(repo, 'git', 'add', '-A');
  sh(repo, 'git', 'commit', '-q', '-m', 'start');
  return repo;
}

function branchWith(repo: string, branch: string, path: string, content = 'change\n'): string {
  sh(repo, 'git', 'checkout', '-q', '-b', branch);
  mkdirSync(join(repo, path, '..'), {recursive: true});
  writeFileSync(join(repo, path), content);
  sh(repo, 'git', 'add', '-A');
  sh(repo, 'git', 'commit', '-q', '-m', `${branch}`);
  const sha = sh(repo, 'git', 'rev-parse', 'HEAD');
  sh(repo, 'git', 'checkout', '-q', 'main');
  return sha;
}

let lc: Instance | undefined;
afterEach(async () => {
  await lc?.stop();
  lc = undefined;
});

async function inReview(instance: Instance, n: number, branch: string, sha: string, extra: string[] = []): Promise<void> {
  const proposal = {title: `Proposal ${n}`, area: extra.includes('--protected') ? 'limits' : 'other', problem: 'p', change: 'c', success: 's', evidence: []};
  expect((await instance.j(['proposal', 'add', '--file', instance.file('p.json', proposal), ...extra])).json.proposal.number).toBe(n);
  expect((await instance.j(['proposal', 'claim', String(n)], {as: 'agent:builder'})).code).toBe(0);
  const submitted = await instance.j(['proposal', 'submit', String(n), '--branch', branch, '--commit', sha, '--note-file', instance.file('h.md', 'handback')], {as: 'agent:builder'});
  expect(submitted.json.proposal.status).toBe('in_review');
}

test('startup marks an in-review proposal shipped once its commit is running, and leaves others alone', async () => {
  lc = await startInstance({settings: {build_wip_max: '2'}});
  const repo = scratchRepo();
  const merged = branchWith(repo, 'lectio/p1-merged', 'a.txt');
  const pending = branchWith(repo, 'lectio/p2-pending', 'b.txt');
  await inReview(lc, 1, 'lectio/p1-merged', merged);
  await inReview(lc, 2, 'lectio/p2-pending', pending);
  expect(noteRunningCommit(lc.db, repo, () => lc!.clock.now).shipped).toEqual([]);
  sh(repo, 'git', 'merge', '-q', '--ff-only', 'lectio/p1-merged');
  const noted = noteRunningCommit(lc.db, repo, () => lc!.clock.now);
  expect(noted.commit).toBe(merged);
  expect(noted.shipped.map(p => p.number)).toEqual([1]);
  expect((await lc.j(['proposal', 'show', '1'])).json.proposal).toMatchObject({status: 'shipped', shipped_at: lc.clock.now});
  expect((await lc.j(['proposal', 'show', '2'])).json.proposal.status).toBe('in_review');
  // A directory that isn't a checkout ships nothing.
  expect(noteRunningCommit(lc.db, mkdtempSync(join(tmpdir(), 'not-a-repo-')))).toEqual({commit: undefined, shipped: []});
});

// --- scripts/ship.sh against a real server -------------------------------------------------

interface Live {
  dir: string;
  repo: string;
  url: string;
  you: string;
  env: Record<string, string>;
  start: string;
  stop: string;
  cli(args: string[], as?: string): Promise<any>;
}

let live: Live | undefined;
const scratch: string[] = [];

async function freePort(): Promise<number> {
  const probe = Bun.serve({port: 0, fetch: () => new Response('')});
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

async function healthy(url: string): Promise<{commit: string | null} | undefined> {
  try {
    return (await (await fetch(`${url}/api/health`)).json()) as {commit: string | null};
  } catch {
    return undefined;
  }
}

async function startLive(files: Record<string, string> = {}): Promise<Live> {
  const dir = mkdtempSync(join(tmpdir(), 'lectio-live-'));
  const repo = scratchRepo(files);
  scratch.push(dir, repo);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const start = `LECTIO_DIR='${dir}' LECTIO_REPO='${repo}' nohup bun '${CLI}' serve --port ${port} --host 127.0.0.1 > '${dir}/serve.log' 2>&1 & echo $! > '${dir}/serve.pid'`;
  const stop = `kill $(cat '${dir}/serve.pid') 2>/dev/null; for i in $(seq 1 50); do curl -fs ${url}/api/health >/dev/null 2>&1 || exit 0; sleep 0.1; done`;
  Bun.spawnSync(['sh', '-c', start]);
  for (let i = 0; i < 100 && (await healthy(url)) === undefined; i++) await Bun.sleep(100);
  const you = sh(dir, 'bun', CLI, '--dir', dir, 'token', 'you');
  const builder = sh(dir, 'bun', CLI, '--dir', dir, 'token', 'agent:builder');
  const cli = async (args: string[], as = 'you') => {
    const out: string[] = [];
    await run({argv: [...args, '--json'], out: l => out.push(l ?? ''), err: () => {}, env: {LECTIO_DIR: dir, LECTIO_URL: url, LECTIO_TOKEN: as === 'you' ? you : builder}, readStdin: async () => ''});
    return JSON.parse(out.join('\n'));
  };
  return {dir, repo, url, you, start, stop, cli, env: {LECTIO_REPO: repo, LECTIO_DIR: dir, LECTIO_URL: url, LECTIO_TOKEN: you, LECTIO_AS: '', SHIP_STOP_CMD: stop, SHIP_START_CMD: start, SHIP_RESTART_CMD: `(${stop}); ${start}`, SHIP_INSTALL_CMD: 'true', SHIP_WAIT_SECONDS: '20'}};
}

async function propose(l: Live, n: number, branch: string, sha: string, protectedArea = false): Promise<void> {
  const path = join(l.dir, `p${n}.json`);
  writeFileSync(path, JSON.stringify({title: `Proposal ${n}`, area: protectedArea ? 'limits' : 'other', problem: 'p', change: 'c', success: 's', evidence: []}));
  expect((await l.cli(['proposal', 'add', '--file', path, ...(protectedArea ? ['--protected'] : [])])).ok).toBe(true);
  expect((await l.cli(['proposal', 'claim', String(n)], 'builder')).ok).toBe(true);
  const handback = join(l.dir, 'h.md');
  writeFileSync(handback, 'handback');
  expect((await l.cli(['proposal', 'submit', String(n), '--branch', branch, '--commit', sha, '--note-file', handback], 'builder')).proposal.status).toBe('in_review');
}

function ship(l: Live, branch: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(['bash', SHIP, branch], {cwd: l.repo, env: {...process.env, ...l.env, ...env}, stdout: 'pipe', stderr: 'pipe'});
  return {code: result.exitCode, out: result.stdout.toString() + result.stderr.toString()};
}

beforeAll(() => {
  live = undefined;
});
afterAll(() => {
  for (const dir of scratch) {
    Bun.spawnSync(['sh', '-c', `kill $(cat '${dir}/serve.pid' 2>/dev/null) 2>/dev/null`]);
    rmSync(dir, {recursive: true, force: true});
  }
});

test('ship.sh rolls back a branch whose tests fail, restoring the database', async () => {
  live = await startLive();
  const sha = branchWith(live.repo, 'lectio/p1-change', 'feature.txt');
  await propose(live, 1, 'lectio/p1-change', sha);
  const before = sh(live.repo, 'git', 'rev-parse', 'main');
  // The "tests" damage the database, then fail: the backup must undo the damage.
  const damage = `bun -e "const {Database} = await import('bun:sqlite'); const db = new Database('${live.dir}/lectio.db'); db.run(\\"INSERT INTO settings (key, value) VALUES ('practice_max', '3')\\"); db.close()" && false`;
  const result = ship(live, 'lectio/p1-change', {SHIP_TEST_CMD: damage});
  expect(result.code).toBe(1);
  expect(result.out).toContain('the tests failed — rolled back');
  expect(result.out).toContain('restored');
  expect(sh(live.repo, 'git', 'rev-parse', 'main')).toBe(before);
  expect(sh(live.repo, 'git', 'rev-parse', 'lectio/p1-change')).toBe(sha);
  // Rolled back, the server is started again on the old commit, with the old database.
  let health: {commit: string | null} | undefined;
  for (let i = 0; i < 100 && (health = await healthy(live.url)) === undefined; i++) await Bun.sleep(100);
  expect(health?.commit).toBe(before);
  const db = new Database(join(live.dir, 'lectio.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  expect(db.query("SELECT value FROM settings WHERE key = 'practice_max'").get()).toBeNull();
  db.close();
  expect((await live.cli(['proposal', 'show', '1'])).proposal.status).toBe('in_review');
}, 60_000);

test('ship.sh refuses a dirty checkout, and a branch whose proposal is not in review', async () => {
  live = await startLive();
  branchWith(live.repo, 'lectio/p1-change', 'feature.txt');
  expect(ship(live, 'lectio/p1-change').out).toContain("no proposal 1");
  writeFileSync(join(live.repo, 'README.md'), 'edited\n');
  expect(ship(live, 'lectio/p1-change').out).toContain('uncommitted changes');
}, 60_000);

test('ship.sh refuses protected paths the approval did not acknowledge', async () => {
  live = await startLive({PROTECTED: 'rules/**\n'});
  const sha = branchWith(live.repo, 'lectio/p1-loosen', 'rules/tutor.md');
  await propose(live, 1, 'lectio/p1-loosen', sha);
  const before = sh(live.repo, 'git', 'rev-parse', 'main');
  const refused = ship(live, 'lectio/p1-loosen', {SHIP_TEST_CMD: 'true'});
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("protected paths the approval didn't acknowledge");
  expect(refused.out).toContain('rules/tutor.md');
  expect(sh(live.repo, 'git', 'rev-parse', 'main')).toBe(before);
}, 60_000);

test('ship.sh ships: main moves, the server restarts on the new commit, and marks the proposal shipped', async () => {
  live = await startLive({PROTECTED: 'rules/**\n'});
  const sha = branchWith(live.repo, 'lectio/p1-rules', 'rules/tutor.md');
  await propose(live, 1, 'lectio/p1-rules', sha, true);
  // main moves on meanwhile: the branch is rebased onto it.
  writeFileSync(join(live.repo, 'other.txt'), 'meanwhile\n');
  sh(live.repo, 'git', 'add', '-A');
  sh(live.repo, 'git', 'commit', '-q', '-m', 'meanwhile');
  const result = ship(live, 'lectio/p1-rules', {SHIP_TEST_CMD: 'true'});
  expect(result.out).toContain('main has moved; rebasing');
  expect(result.out).toContain('as the approval acknowledged');
  expect(result.code).toBe(0);
  const head = sh(live.repo, 'git', 'rev-parse', 'main');
  expect((await healthy(live.url))?.commit).toBe(head);
  expect(result.out).toContain(`shipped #1`);
  // The rebase gave the branch a new head; ship.sh records that as what shipped.
  expect((await live.cli(['proposal', 'show', '1'])).proposal).toMatchObject({status: 'shipped', commit_sha: head});
}, 60_000);

test('ship.sh without a rebase: the restarted server marks the proposal shipped itself', async () => {
  live = await startLive();
  const sha = branchWith(live.repo, 'lectio/p1-plain', 'plain.txt');
  await propose(live, 1, 'lectio/p1-plain', sha);
  const result = ship(live, 'lectio/p1-plain', {SHIP_TEST_CMD: 'true'});
  expect(result.code).toBe(0);
  expect((await live.cli(['proposal', 'show', '1'])).proposal).toMatchObject({status: 'shipped', commit_sha: sha});
  expect(await Bun.file(join(live.dir, 'serve.log')).text()).toContain('shipped #1: Proposal 1');
}, 60_000);
