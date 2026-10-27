/**
 * #5: the time each arm of a two-arm experiment really got. `measures.experiments` gives
 * each arm the median seconds seen on its own blocks and the median active seconds of its
 * lessons, over the finished lessons with reading time; `recent_lessons` gives a finished
 * two-arm lesson its `assigned_arm`, and nothing before it is finished.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {ownershipLesson, rustSubject, startRun, submitLesson} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};

function experimentLesson(role: string): Record<string, any> {
  return ownershipLesson({
    concepts: [{key: 'ownership', role}],
    experiment: {name: 'worked_vs_problem_first', arms: {a: 'a worked trace, then the rule', b: 'a problem to try first, then the rule'}},
    blocks: [
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], body: {md: 'SHARED: every value has one owner.'}},
      {type: 'markdown', approach: 'worked_example', concepts: ['ownership'], arm: 'a', body: {md: 'WORKED-TRACE: let s1 = …; let s2 = s1; s1 is gone.'}},
      {type: 'markdown', approach: 'problem_first', concepts: ['ownership'], arm: 'b', body: {md: 'PROBLEM-FIRST: predict what printing s1 does after the move.'}},
      {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q1'}},
    ],
  });
}

const activity = (lesson: string, body: unknown) =>
  fetch(`${lc.url}/api/lessons/${lesson}/activity`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});

const context = async () => {
  const json = (await lc.j(['context'], TUTOR)).json;
  return json.subjects[0] as {recent_lessons: Array<{id: string; assigned_arm: string | null}>; measures: {experiments: Array<Record<'a' | 'b', Record<string, unknown>>>}};
};

test('each arm gets its median seen and active seconds over its timed lessons, and each finished two-arm lesson its arm', async () => {
  const subject = await rustSubject(lc);
  // Arm a's own blocks are read for 30 s, b's for 60 s; the whole lesson for 100 s more than that.
  const seenFor = {a: 30, b: 60};
  const arms: Record<string, 'a' | 'b'> = {};
  for (let day = 0; day < 6; day++) {
    const submitted = await submitLesson(lc, subject, await startRun(lc), experimentLesson(day === 0 ? 'new' : 'deepen'));
    expect(submitted.code).toBe(0);
    const id = submitted.json.lesson.id as string;
    // Before it is finished the context does not say which arm it shows.
    expect((await context()).recent_lessons.find(l => l.id === id)!.assigned_arm).toBeNull();
    const arm = (lc.db.query('SELECT arm FROM lesson_arms WHERE lesson_id = ?').get(id) as {arm: 'a' | 'b'}).arm;
    arms[id] = arm;
    const blocks = (await lc.j(['lesson', 'show', id], TUTOR)).json.lesson.blocks as Array<{id: string; arm: string | null}>;
    const own = blocks.find(b => b.arm === arm)!;
    const unshown = blocks.find(b => b.arm !== null && b.arm !== arm)!;
    // The last lesson is finished unread: it counts as a lesson, not as a timed one.
    if (day < 5) expect((await activity(id, {active_seconds: seenFor[arm] + 100, blocks: [{id: own.id, seen_seconds: seenFor[arm]}, {id: unshown.id, seen_seconds: 500}]})).status).toBe(200);
    await lc.j(['finish', id]);
    lc.advance({days: 1});
  }

  const after = await context();
  expect(after.recent_lessons.map(l => l.id).sort()).toEqual(Object.keys(arms).sort());
  for (const l of after.recent_lessons) expect(l.assigned_arm).toBe(arms[l.id]!);
  const [experiment] = after.measures.experiments;
  const ids = Object.keys(arms);
  for (const arm of ['a', 'b'] as const) {
    const mine = ids.filter(id => arms[id] === arm);
    const timed = mine.filter(id => id !== ids[5]);
    expect(experiment![arm]).toMatchObject({
      lessons: mine.length,
      timed_lessons: timed.length,
      median_seen_seconds: timed.length === 0 ? null : seenFor[arm],
      median_active_seconds: timed.length === 0 ? null : seenFor[arm] + 100,
    });
  }
});

test('a lesson without an experiment has a null assigned_arm', async () => {
  const subject = await rustSubject(lc);
  const submitted = await submitLesson(lc, subject, await startRun(lc));
  await lc.j(['finish', submitted.json.lesson.id]);
  const recent = (await context()).recent_lessons;
  expect(recent).toHaveLength(1);
  expect(recent[0]).toMatchObject({id: submitted.json.lesson.id, assigned_arm: null});
});
