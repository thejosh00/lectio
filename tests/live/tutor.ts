#!/usr/bin/env bun
/**
 * `bun run test:live`: a real tutor, with a real model, against a throwaway lectio. The other tests
 * can't say whether a model reading `skills/lectio-teach` still writes a lesson that works, and
 * that skill is prose a model follows. It runs the skill once on a new subject, checks what came
 * back through the same commands the app uses, and then looks at it in a browser, at phone and
 * desktop size. Spends real tokens: about 5 minutes, about 1M.
 *
 * The model gets what a tutor needs and no more: `lectio` commands, reading files, and writing
 * inside the throwaway directory. Anything else it tries is refused, and it can't ask, so a skill
 * that comes to need more fails here, where someone sees it.
 */
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {labelledBackup} from '../../src/db/backup.ts';
import {RUST_CONCEPTS} from '../helpers/fixtures.ts';
import {startInstance} from '../helpers/instance.ts';

const repo = join(import.meta.dirname, '../..');
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const lc = await startInstance({now: iso()});
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const bin = join(lc.dir, 'bin');
  mkdirSync(bin);
  const shim = join(bin, 'lectio');
  writeFileSync(shim, `#!/bin/sh\nLECTIO_DIR='${lc.dir}' exec bun '${join(repo, 'src/cli.ts')}' "$@"\n`);
  chmodSync(shim, 0o755);
  const env: Record<string, string | undefined> = {...process.env, PATH: `${bin}:${process.env['PATH']}`, LECTIO_DIR: lc.dir};
  delete env['LECTIO_TOKEN'];
  delete env['LECTIO_URL'];
  // A session of its own, on the logged-in subscription, as otto's wakes are: a stray API key would
  // otherwise take precedence, and the settings of whatever session started this would carry over.
  for (const name of Object.keys(env)) if (name === 'ANTHROPIC_API_KEY' || name.startsWith('CLAUDE')) delete env[name];

  // Not spawnSync: this process is the server it signs in to.
  const login = Bun.spawn([shim, 'login', '--url', lc.url, '--token', lc.token('agent:tutor'), '--default'], {env, stdout: 'ignore', stderr: 'inherit'});
  check((await login.exited) === 0, 'the tutor can sign in to the throwaway instance');

  const added = await lc.j(['subject', 'add', 'Rust ownership', '--goal', 'read and change Rust services', '--minutes', '10']);
  const subject = added.json.subject.id as string;
  await lc.j(['concepts', 'upsert', subject, '--file', lc.file('concepts.json', RUST_CONCEPTS)], {as: 'agent:tutor'});

  const prompt = [
    `Read ${join(repo, 'skills/lectio-teach/SKILL.md')} and follow it: do one tutor run, end to end.`,
    `The \`lectio\` on your PATH is already signed in as the tutor to a test instance. Use only that.`,
    `This learner has one new subject and has told you nothing else. Don't ask anything; decide and carry on. Don't use subagents.`,
    `Write any files you need in the current directory.`,
  ].join('\n');
  console.log(`instance ${lc.dir}\nrunning the tutor…`);
  // spawnSync would stop this process serving the instance, so the model has to run beside it.
  const child = Bun.spawn(
    ['claude', '-p', prompt, '--output-format', 'json', '--tools', 'Bash,Read,Write,Edit', '--allowedTools', 'Bash(lectio:*)', 'Read', 'Write(./**)', 'Edit(./**)', '--add-dir', join(repo, 'skills')],
    {cwd: lc.dir, env, stdout: 'pipe', stderr: 'inherit'},
  );
  const killer = setTimeout(() => child.kill(), 40 * 60_000);
  const raw = await new Response(child.stdout).text();
  const code = await child.exited;
  clearTimeout(killer);
  check(code === 0, `the model finished (exit ${code})`);
  mkdirSync(join(repo, '.playwright'), {recursive: true});
  writeFileSync(join(repo, '.playwright/live-tutor.json'), raw);
  try {
    const result = JSON.parse(raw) as {num_turns?: number; result?: string; permission_denials?: unknown[]};
    console.log(`turns ${result.num_turns}; refused ${result.permission_denials?.length ?? 0}; said: ${String(result.result ?? '').slice(0, 600)}`);
  } catch {
    console.log(raw.slice(0, 600));
  }

  const lessons = lc.db.query('SELECT id, state, title FROM lessons').all() as Array<{id: string; state: string; title: string}>;
  const quizzes = lc.db.query('SELECT id, kind FROM quizzes').all() as Array<{id: string; kind: string}>;
  const runs = lc.db.query('SELECT id, finished AS finished_at FROM agent_runs').all() as Array<{id: string; finished_at: string | null}>;
  check(runs.length >= 1, `it started a run (${runs.length})`);
  check(runs.every(r => r.finished_at !== null), 'it finished its run');
  check(lessons.length + quizzes.length >= 1, `it wrote something to learn from (${lessons.length} lessons, ${quizzes.length} quizzes: ${quizzes.map(q => q.kind).join(', ')})`);
  check((await lc.j(['today'])).code === 0, "the learner's day still reads");

  if (lessons.length > 0) {
    labelledBackup(lc.db, lc.dir, 'live-tutor', iso());
    const browser = spawnSync('bun', ['run', 'test:browser', '--project=iphone-webkit', '--project=desktop-chromium'], {
      cwd: repo,
      env: {...process.env, LECTIO_REAL_DATA: lc.dir},
      stdio: 'inherit',
    });
    check(browser.status === 0, 'what it wrote holds up in a browser, at phone and desktop size');
  }
} finally {
  await lc.stop();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nthe tutor still teaches');
process.exit(0);
