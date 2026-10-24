/**
 * M1: subjects, the syllabus, and lessons submitted, validated and printed.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {ownershipLesson, rustSubject, RUST_CONCEPTS, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};

describe('subjects', () => {
  test('add, list, edit, pause and resume', async () => {
    const added = await lc.j(['subject', 'add', 'Music theory', '--goal', 'read a lead sheet', '--level', 'some', '--minutes', '20', '--days', 'fri,mon']);
    expect(added.code).toBe(0);
    expect(added.stderr).toBe('');
    expect(added.json.subject).toMatchObject({title: 'Music theory', goal: 'read a lead sheet', level: 'some', minutes_per_day: 20, days: 'mon,fri', status: 'active'});
    const id = added.json.subject.id;

    expect((await lc.j(['subjects'])).json.subjects).toHaveLength(1);
    const edited = await lc.j(['subject', 'edit', 'music theory', '--minutes', '10']);
    expect(edited.json).toMatchObject({changed: ['minutes_per_day'], subject: {minutes_per_day: 10}});
    expect((await lc.j(['subject', 'pause', id])).json.subject.status).toBe('paused');
    expect((await lc.j(['subject', 'resume', id.slice(0, 6)])).json.subject.status).toBe('active');
  });

  test('bad values are usage errors, a duplicate title is refused', async () => {
    expect((await lc.j(['subject', 'add', 'X', '--days', 'someday'])).code).toBe(2);
    expect((await lc.j(['subject', 'add', 'X', '--level', 'expert'])).code).toBe(2);
    expect((await lc.j(['subject', 'add', 'X', '--minutes', '2'])).code).toBe(2);
    await lc.j(['subject', 'add', 'Rust']);
    const dup = await lc.j(['subject', 'add', 'rust']);
    expect(dup.code).toBe(1);
    expect(dup.json.error).toContain('already a subject');
  });

  test('only the learner adds and changes subjects', async () => {
    const refused = await lc.j(['subject', 'add', 'Chess'], TUTOR);
    expect(refused.code).toBe(2);
    expect(refused.json).toMatchObject({ok: false, refused: true});
    expect(refused.json.error).toContain("the learner's to do");
  });
});

describe('the syllabus', () => {
  test('upsert is idempotent by key, and can reorder, retire and mark known', async () => {
    const id = await rustSubject(lc);
    const again = await lc.j(['concepts', 'upsert', id, '--file', lc.file('c.json', RUST_CONCEPTS)], TUTOR);
    expect(again.json).toMatchObject({created: [], updated: [], unchanged: RUST_CONCEPTS.map(c => c.key)});

    const changed = await lc.j(['concepts', 'upsert', id, '--stdin'], {
      ...TUTOR,
      stdin: JSON.stringify([
        {key: 'borrowing', title: 'Borrowing', position: 0},
        {key: 'stack-vs-heap', title: 'Stack and heap', status: 'known'},
        {key: 'moves', title: 'Moves', status: 'retired'},
        {key: 'lifetimes', title: 'Lifetimes', prereqs: ['borrowing']},
      ]),
    });
    expect(changed.code).toBe(0);
    expect(changed.json.created).toEqual(['lifetimes']);
    expect(changed.json.updated.sort()).toEqual(['borrowing', 'moves', 'stack-vs-heap']);
    const keys = changed.json.concepts.map((c: {key: string}) => c.key);
    expect(keys[0]).toBe('borrowing');
    expect(keys.at(-1)).toBe('lifetimes');
    expect(changed.json.concepts.find((c: {key: string}) => c.key === 'moves').status).toBe('retired');
  });

  test('unknown prerequisites and cycles are refused, with paths', async () => {
    const id = await rustSubject(lc);
    const bad = await lc.j(['concepts', 'upsert', id, '--stdin'], {...TUTOR, stdin: JSON.stringify([{key: 'traits', title: 'Traits', prereqs: ['generics']}, {key: 'Bad Key', title: 'x'}])});
    expect(bad.code).toBe(2);
    expect(bad.json.errors.map((e: {path: string}) => e.path)).toEqual(['[1].key', '[0].prereqs']);
    const cycle = await lc.j(['concepts', 'upsert', id, '--stdin'], {...TUTOR, stdin: JSON.stringify([{key: 'stack-vs-heap', title: 'Stack and heap', prereqs: ['moves']}])});
    expect(cycle.code).toBe(2);
    expect(cycle.json.error).toContain('cycle');
  });
});

describe('lessons', () => {
  test('submitting a lesson twice for a day gives existing: true', async () => {
    const id = await rustSubject(lc);
    const run = await startRun(lc);
    const first = await submitLesson(lc, id, run);
    expect(first.code).toBe(0);
    expect(first.json).toMatchObject({existing: false, lesson: {state: 'ready', day: '2026-09-12', run_id: run, added_by: 'agent:tutor', version: 1}});
    expect(Object.keys(first.json.question_ids)).toEqual(['q1']);
    const second = await submitLesson(lc, id, run, ownershipLesson({title: 'Something else'}));
    expect(second.code).toBe(0);
    expect(second.json).toMatchObject({existing: true, lesson: {id: first.json.lesson.id, title: 'Ownership: who frees the memory'}});
    expect(second.json.question_ids).toEqual(first.json.question_ids);
  });

  test('an unknown block type, a bad body and an unknown concept are all named by path', async () => {
    const id = await rustSubject(lc);
    const run = await startRun(lc);
    const lesson = ownershipLesson();
    lesson.blocks = [
      {type: 'hologram', approach: 'visual', concepts: [], body: {md: 'x'}},
      {type: 'callout', approach: 'explanation', concepts: ['ownership'], body: {kind: 'warning', md: ''}},
      {type: 'markdown', approach: 'Explanation!', concepts: ['garbage-collection'], body: {md: 'x', extra: 1}},
      {type: 'question', approach: 'retrieval', concepts: [], body: {ref: 'q1'}},
      {type: 'steps', approach: 'visual', concepts: [], body: {}},
    ] as never;
    const result = await submitLesson(lc, id, run, lesson);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    const paths = result.json.errors.map((e: {path: string}) => e.path);
    expect(paths).toEqual(['blocks[0].type', 'blocks[1].body.kind', 'blocks[1].body.md', 'blocks[2].approach', 'blocks[2].concepts[0]', 'blocks[2].body.extra', 'blocks[4].type']);
    expect(result.json.error).toContain('unknown block type "hologram"');
    expect(result.json.error).toContain('no concept "garbage-collection" in this subject; upsert it first');
    expect(result.json.error).toContain('"steps" blocks arrive in M8');
    // Nothing was written.
    expect((await lc.j(['lessons'])).json.lessons).toEqual([]);
  });

  test('lesson-level problems: concepts, roles, questions, limits', async () => {
    const id = await rustSubject(lc);
    const run = await startRun(lc);
    const lesson = ownershipLesson({
      objectives: [],
      concepts: [{key: 'borrowing', role: 'review'}, {key: 'nope', role: 'new'}],
      questions: [
        {...ownershipLesson().questions[0], body: {choices: [{id: 'a', md: 'x'}], answer: 'z'}},
        {...ownershipLesson().questions[0], ref: 'q9'},
      ],
    });
    const result = await submitLesson(lc, id, run, lesson);
    expect(result.code).toBe(2);
    const paths = result.json.errors.map((e: {path: string}) => e.path);
    expect(paths).toContain('objectives');
    expect(paths).toContain('concepts[0].role');
    expect(paths).toContain('concepts[1].key');
    expect(paths).toContain('questions[0].body.choices');
    expect(paths).toContain('questions[1].ref');
  });

  test('lectio lesson today prints it, with the inline check and no key', async () => {
    const id = await rustSubject(lc);
    await submitLesson(lc, id, await startRun(lc));
    const printed = await lc.cli(['lesson', 'today']);
    expect(printed.code).toBe(0);
    expect(printed.stdout).toContain('# Ownership: who frees the memory');
    expect(printed.stdout).toContain('Every value has exactly one **owner**');
    expect(printed.stdout).toContain('```rust');
    expect(printed.stdout).toContain('[Pitfall]');
    expect(printed.stdout).toContain('2. A compile error: `s1` was moved');
    expect(printed.stdout).toContain('The Rust Book');
    expect(printed.stdout).not.toContain('move-is-shallow-copy');

    const json = await lc.j(['lesson', 'today']);
    const check = json.json.lessons[0].blocks.find((b: {type: string}) => b.type === 'question');
    expect(check.question.body.choices[0]).toEqual({id: 'a', md: 'It compiles; both point to the same buffer'});
    expect(JSON.stringify(check.question)).not.toContain('"answer"');
    // The tutor sees the whole question.
    const full = await lc.j(['lesson', 'show', json.json.lessons[0].id], TUTOR);
    expect(full.json.lesson.blocks[2].question.body.answer).toBe('b');
  });

  test('a lesson can be revised while ready; question ids survive by ref', async () => {
    const id = await rustSubject(lc);
    const first = await submitLesson(lc, id, await startRun(lc));
    const lessonId = first.json.lesson.id;
    const revised = await lc.j(['lesson', 'revise', lessonId, '--file', lc.file('l.json', ownershipLesson({title: 'Ownership, revised'}))], TUTOR);
    expect(revised.code).toBe(0);
    expect(revised.json.lesson).toMatchObject({title: 'Ownership, revised', version: 2});
    expect(revised.json.question_ids).toEqual(first.json.question_ids);
    await lc.j(['finish', lessonId]);
    const late = await lc.j(['lesson', 'revise', lessonId, '--file', lc.file('l.json', ownershipLesson())], TUTOR);
    expect(late.code).toBe(1);
    expect(late.json.error).toContain('block fix');
  });

  test('an agent needs an open run; lessons are for today', async () => {
    const id = await rustSubject(lc);
    const noRun = await lc.j(['lesson', 'submit', id, '--file', lc.file('l.json', ownershipLesson())], TUTOR);
    expect(noRun.code).toBe(2);
    expect(noRun.json.error).toContain('--run');
    const run = await startRun(lc);
    const tomorrow = await lc.j(['lesson', 'submit', id, '--day', '2026-09-13', '--run', run, '--file', lc.file('l.json', ownershipLesson())], TUTOR);
    expect(tomorrow.code).toBe(1);
    expect(tomorrow.json.error).toContain('today (2026-09-12)');
  });

  test('a lesson is too big past lesson_max_bytes, with too many blocks past lesson_max_blocks', async () => {
    lc.db.query("INSERT INTO settings (key, value) VALUES ('lesson_max_blocks', '2')").run();
    const id = await rustSubject(lc);
    const result = await submitLesson(lc, id, await startRun(lc));
    expect(result.code).toBe(2);
    expect(result.json.errors[0]).toMatchObject({path: 'blocks', message: 'has 4 entries; the most is 2'});
  });
});

describe('the envelope, tokens and login', () => {
  test('unknown commands and options exit 2', async () => {
    expect((await lc.j(['frobnicate'])).code).toBe(2);
    const bad = await lc.j(['subjects', '--colour', 'red']);
    expect(bad.code).toBe(2);
    expect(bad.json.error).toContain('--colour');
  });

  test('an unreachable server exits 4, a bad token 2', async () => {
    const down = await lc.cli(['subjects', '--json'], {env: {LECTIO_URL: 'http://127.0.0.1:1'}});
    expect(down.code).toBe(4);
    expect(down.json).toMatchObject({ok: false, code: 4});
    const bad = await lc.cli(['subjects', '--json'], {env: {LECTIO_TOKEN: 'nope'}});
    expect(bad.code).toBe(2);
    expect(bad.json.hint).toContain('lectio token');
  });

  test('not found is exit 3', async () => {
    const missing = await lc.j(['lesson', 'show', 'zzzzzzzzzzzz']);
    expect(missing.code).toBe(3);
  });

  test('login keeps one token per actor; --as picks one, the default is used otherwise', async () => {
    const env = {LECTIO_URL: '', LECTIO_TOKEN: ''};
    const tutor = await lc.cli(['login', '--url', lc.url, '--token', lc.token('agent:tutor'), '--json'], {env});
    expect(tutor.json.actor).toBe('agent:tutor');
    await lc.cli(['login', '--url', lc.url, '--token', lc.token('agent:builder'), '--json'], {env});
    const who = await lc.cli(['agents', '--json'], {env});
    expect(who.code).toBe(0);
    const asBuilder = await lc.cli(['subject', 'add', 'X', '--json', '--as', 'agent:builder'], {env});
    expect(asBuilder.json.error).toContain("the learner's to do");
    const nobody = await lc.cli(['subjects', '--json', '--as', 'agent:nobody'], {env});
    expect(nobody.code).toBe(2);
    expect(nobody.json.error).toContain('no token for agent:nobody');
    const file = JSON.parse(await Bun.file(`${lc.dir}/client.json`).text());
    expect(file).toMatchObject({default: 'agent:tutor', tokens: {'agent:tutor': lc.token('agent:tutor'), 'agent:builder': lc.token('agent:builder')}});
  });
});
