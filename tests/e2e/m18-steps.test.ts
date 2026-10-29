/**
 * M18: step-throughs. A lesson can teach a process in frames the learner steps through; a
 * broken mermaid frame is refused at its path; the steps taken and reaching the end land in
 * the block's stats, and from there in the media measure.
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
const OWNS = 'flowchart TD\n  s1["s1 owns the buffer"]\n  class s1 focus';
const MOVED = 'flowchart TD\n  s1 -->|let s2 = s1| s2["s2 owns the buffer"]\n  class s1 muted\n  class s2 focus';
const steps = (frames: unknown[]) => ({type: 'steps', approach: 'step_through', concepts: ['ownership'], body: {frames, alt: 's1 owns the buffer; after the move s2 does, and s1 owns nothing'}});

test('a step-through is kept, printed frame by frame, and refused at the frame that is broken', async () => {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const broken = ownershipLesson();
  broken.blocks = [...broken.blocks, steps([{mermaid: OWNS, caption: 'Before'}, {mermaid: 'flowchart TD\n  s1 -->', caption: 'After'}])] as never;
  const refused = await submitLesson(lc, subject, run, broken);
  expect(refused.code).toBe(2);
  expect(refused.json.errors).toEqual([{path: 'blocks[4].body.frames[1].mermaid', message: expect.stringContaining("doesn't parse as mermaid")}]);

  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, steps([{mermaid: OWNS, caption: 's1 owns it.', ask: 'After let s2 = s1, who owns it?'}, {mermaid: MOVED, caption: 's2 owns it; s1 owns nothing.'}])] as never;
  const submitted = await submitLesson(lc, subject, run, lesson);
  expect(submitted.code).toBe(0);
  expect(submitted.json.warnings).toEqual([]);
  const block = (await lc.j(['lesson', 'show', submitted.json.lesson.id])).json.lesson.blocks[4];
  expect(block).toMatchObject({type: 'steps', body: {frames: [{mermaid: OWNS, ask: 'After let s2 = s1, who owns it?'}, {mermaid: MOVED, ask: null}], autoplay_ms: null}});
  expect(block.text).toBe('[Step-through: s1 owns the buffer; after the move s2 does, and s1 owns nothing]\n1. s1 owns it. (guess: After let s2 = s1, who owns it?)\n2. s2 owns it; s1 owns nothing.');
});

test('steps taken and the end reached land in the block, and in the media measure', async () => {
  const subject = await rustSubject(lc);
  const lesson = ownershipLesson();
  lesson.blocks = [...lesson.blocks, steps([{mermaid: OWNS, caption: 'Before'}, {mermaid: MOVED, caption: 'After'}])] as never;
  const submitted = await submitLesson(lc, subject, await startRun(lc), lesson);
  const id = submitted.json.lesson.id as string;
  const block = (await lc.j(['lesson', 'show', id], TUTOR)).json.lesson.blocks[4];

  const post = (body: unknown) => fetch(`${lc.url}/api/lessons/${id}/activity`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  expect((await post({active_seconds: 20, blocks: [{id: block.id, seen_seconds: 20, interactions: 2}]})).status).toBe(200);
  // A batch with steps and no reading time still counts: the page sends one when only a step was taken.
  expect((await post({active_seconds: 0, blocks: [{id: block.id, seen_seconds: 0, interactions: 1, completed: true}]})).status).toBe(200);
  expect((await lc.j(['lesson', 'show', id], TUTOR)).json.lesson.blocks[4]).toMatchObject({seen_seconds: 20, interactions: 3, completed: true});

  await lc.j(['finish', id]);
  const media = (await lc.j(['context'], TUTOR)).json.subjects[0].measures.media as Array<{type: string; blocks: number; completion: {rate: number; n: number} | null}>;
  expect(media.find(m => m.type === 'steps')).toMatchObject({blocks: 1, completion: {rate: 1, n: 1}});
  // The media ladder says it is here.
  const tools = (await lc.j(['tools'])).json.media as Array<{type: string; lectio: string}>;
  expect(tools.find(m => m.type === 'steps')!.lectio).toBe('available');
});
