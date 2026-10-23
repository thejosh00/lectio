/**
 * M7: knowing what shipped. A build ships like any other change — merged and restarted —
 * and the server notices its commit running. A scratch git repo stands in for the checkout.
 */
import {afterEach, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {noteRunningCommit} from '../../src/local/git.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

function sh(cwd: string, ...cmd: string[]): string {
  const result = Bun.spawnSync(cmd, {cwd, stdout: 'pipe', stderr: 'pipe'});
  if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** A repo with one commit on main. */
function scratchRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lectio-repo-'));
  sh(repo, 'git', 'init', '-q', '-b', 'main');
  sh(repo, 'git', 'config', 'user.email', 'test@example.com');
  sh(repo, 'git', 'config', 'user.name', 'test');
  writeFileSync(join(repo, 'README.md'), 'scratch\n');
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

async function inReview(instance: Instance, n: number, branch: string, sha: string): Promise<void> {
  const proposal = {title: `Proposal ${n}`, area: 'other', problem: 'p', change: 'c', success: 's', evidence: []};
  expect((await instance.j(['proposal', 'add', '--file', instance.file('p.json', proposal)])).json.proposal.number).toBe(n);
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
