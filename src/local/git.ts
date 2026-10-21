/**
 * What the server learns from the git checkout it runs from: the commit it is running,
 * and which proposals that commit now includes. A server built as a binary has no
 * checkout, and `lectio proposal shipped` marks them by hand.
 */
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {Database} from 'bun:sqlite';
import {nowIso} from '../core/time.ts';
import {Ctx} from '../db/context.ts';
import {setMark} from '../db/database.ts';
import {detectShipped, type Proposal} from '../db/proposals.ts';

/** The checkout this code runs from (`LECTIO_REPO` overrides it, for tests). */
export function sourceRepo(env: Record<string, string | undefined> = process.env): string {
  return env['LECTIO_REPO']?.trim() || resolve(import.meta.dir, '..', '..');
}

function git(repo: string, args: string[]): {code: number; out: string} {
  const result = Bun.spawnSync(['git', '-C', repo, ...args], {stdout: 'pipe', stderr: 'pipe'});
  return {code: result.exitCode, out: result.stdout.toString().trim()};
}

export function gitHead(repo: string): string | undefined {
  if (!existsSync(join(repo, '.git'))) return undefined;
  const head = git(repo, ['rev-parse', 'HEAD']);
  return head.code === 0 && /^[0-9a-f]{40}$/.test(head.out) ? head.out : undefined;
}

export function isAncestor(repo: string, sha: string, of: string): boolean {
  return git(repo, ['merge-base', '--is-ancestor', sha, of]).code === 0;
}

/**
 * At startup: record the commit, and mark every in-review proposal whose submitted commit
 * is an ancestor of it as shipped — "shipped" means running, not merged.
 */
export function noteRunningCommit(db: Database, repo: string, now: () => string = nowIso): {commit: string | undefined; shipped: Proposal[]} {
  const commit = gitHead(repo);
  if (commit === undefined) return {commit, shipped: []};
  setMark(db, 'running_commit', commit);
  const ctx = new Ctx({db, now}, 'you');
  const shipped = ctx.write(() => detectShipped(ctx, sha => isAncestor(repo, sha, commit)));
  return {commit, shipped};
}
