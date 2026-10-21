#!/usr/bin/env bun
/**
 * `bun run guard [<range>]`: which protected paths (PROTECTED) a range of commits touches.
 *
 * Exit 0 when none are touched, 1 when some are (listed), 2 on a usage or git problem.
 * The builder runs it before handing back; scripts/ship.sh runs it before shipping and
 * refuses protected paths the approval didn't acknowledge.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

export function protectedPatterns(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => line !== '');
}

export function touchedProtected(paths: readonly string[], patterns: readonly string[]): string[] {
  const globs = patterns.map(p => new Bun.Glob(p));
  return paths.filter(path => globs.some(g => g.match(path)));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const range = args.find(a => !a.startsWith('--')) ?? 'main..HEAD';
  const repo = process.cwd();
  const file = join(repo, 'PROTECTED');
  const patterns = existsSync(file) ? protectedPatterns(readFileSync(file, 'utf8')) : [];
  const diff = Bun.spawnSync(['git', 'diff', '--name-only', range], {cwd: repo, stdout: 'pipe', stderr: 'pipe'});
  if (diff.exitCode !== 0) {
    process.stderr.write(`guard: git diff ${range} failed: ${diff.stderr.toString().trim()}\n`);
    process.exit(2);
  }
  const changed = diff.stdout.toString().split('\n').filter(Boolean);
  const touched = touchedProtected(changed, patterns);
  if (json) process.stdout.write(`${JSON.stringify({range, changed: changed.length, protected: touched})}\n`);
  else if (touched.length === 0) process.stdout.write(`guard: ${range} touches no protected paths (${changed.length} files changed)\n`);
  else process.stdout.write(`guard: ${range} touches protected paths:\n${touched.map(p => `  ${p}`).join('\n')}\n`);
  process.exit(touched.length === 0 ? 0 : 1);
}
