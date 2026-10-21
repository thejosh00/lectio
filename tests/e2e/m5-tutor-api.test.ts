/**
 * M5: the tutor's API — due, context, runs, notes with history, grading, replies,
 * verdicts, fixes and voiding, and the caps.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {answerQ, ownershipLesson, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};
const due = async () => (await lc.j(['due'], TUTOR)).json;

describe('due', () => {
  test('a new subject needs a plan; a planned one is ready; nothing is due once written', async () => {
    expect(await due()).toEqual({ok: true, due: false, subjects: [], waiting: []});
    const added = await lc.j(['subject', 'add', 'Rust ownership']);
    expect((await due()).subjects).toEqual([{id: added.json.subject.id, title: 'Rust ownership', why: 'needs_plan', reasons: ['needs_plan']}]);
    const id = await rustSubject(lc).catch(() => added.json.subject.id);
    await lc.j(['concepts', 'upsert', id, '--stdin'], {...TUTOR, stdin: JSON.stringify([{key: 'ownership', title: 'Ownership'}])});
    expect((await due()).subjects[0].why).toBe('ready');
    await submitLesson(lc, id, await startRun(lc), ownershipLesson({blocks: [{type: 'markdown', approach: 'explanation', concepts: [], body: {md: 'x'}}], questions: []}));
    expect(await due()).toMatchObject({due: false, waiting: [{why: 'unfinished_lesson'}]});
  });

  test('across the ready hour, days schedules and paused subjects', async () => {
    lc.clock.now = '2026-09-14T09:30:00Z'; // Monday 04:30 in Chicago
    const id = await rustSubject(lc, ['--days', 'mon,wed']);
    expect(await due()).toMatchObject({due: false, waiting: [{id, why: 'before_ready_hour'}]});
    lc.advance({hours: 1});
    expect((await due()).subjects[0]).toMatchObject({id, why: 'ready'});
    lc.advance({days: 1});
    expect(await due()).toMatchObject({due: false, waiting: [{why: 'not_scheduled_today', message: expect.stringContaining('next on 2026-09-16')}]});
    lc.advance({days: 1});
    expect((await due()).due).toBe(true);
    await lc.j(['subject', 'pause', id]);
    expect(await due()).toEqual({ok: true, due: false, subjects: [], waiting: []});
  });

  test('a pending flag or ask makes a subject due even when it is waiting', async () => {
    const id = await rustSubject(lc);
    const lesson = await submitLesson(lc, id, await startRun(lc));
    const blockId = (await lc.j(['lesson', 'show', lesson.json.lesson.id])).json.lesson.blocks[0].id;
    await lc.j(['rate', 'block', blockId, 'confusing']);
    expect((await due()).due).toBe(false);
    await lc.j(['rate', 'block', blockId, 'broken']);
    expect((await due()).subjects[0].reasons).toEqual(['needs_fix']);
    await lc.j(['ask', blockId, 'What is a drop?']);
    expect((await due()).subjects[0].reasons).toEqual(['needs_fix', 'needs_reply']);
  });
});

describe('runs', () => {
  test('one open run; a recent one resumes, a stale one is closed as failed; finish needs a summary', async () => {
    const first = await lc.j(['run', 'start'], TUTOR);
    expect(first.json.resumed).toBe(false);
    lc.advance({hours: 2});
    expect((await lc.j(['run', 'start'], TUTOR)).json).toMatchObject({resumed: true, run: {id: first.json.run.id}});
    expect((await lc.j(['run', 'finish', first.json.run.id, '--outcome', 'ok'], TUTOR)).code).toBe(2);
    expect((await lc.j(['run', 'finish', first.json.run.id, '--outcome', 'great', '--summary', 'x'], TUTOR)).code).toBe(2);
    lc.advance({hours: 13});
    const second = await lc.j(['run', 'start'], TUTOR);
    expect(second.json.resumed).toBe(false);
    const runs = (await lc.j(['runs'])).json.runs;
    expect(runs[1]).toMatchObject({outcome: 'failed', summary: 'abandoned: never finished'});
    const done = await lc.j(['run', 'finish', second.json.run.id, '--outcome', 'partial', '--made', '{"replies":2}', '--summary', 'Answered two asks.', '--retro'], TUTOR);
    expect(done.json.run).toMatchObject({outcome: 'partial', retro: true, made: {replies: 2, lessons: 0, quizzes: 0, questions: 0}});
    expect((await lc.j(['lesson', 'submit', 'x', '--run', second.json.run.id, '--stdin'], {...TUTOR, stdin: '{}'})).code).toBe(3);
  });
});

describe('notes and plans', () => {
  test('versions with history; the learner\'s own lines are marked; an agent must say why; capped', async () => {
    const id = await rustSubject(lc);
    expect((await lc.j(['notes', 'set', '--stdin'], {...TUTOR, stdin: 'x'})).code).toBe(2);
    await lc.j(['notes', 'set', '--stdin', '--note', 'first'], {...TUTOR, stdin: '- Likes worked examples\n- Reads fast\n'});
    await lc.j(['notes', 'edit', '--stdin', '--note', 'not true'], {stdin: '- Likes worked examples\n- I am slow with notation; go easy\n'});
    await lc.j(['notes', 'set', '--stdin', '--note', 'kept their line'], {...TUTOR, stdin: '- Likes worked examples (6 of 6)\n- I am slow with notation; go easy\n'});
    const notes = (await lc.j(['notes', '--history'], TUTOR)).json;
    expect(notes.notes).toMatchObject({version: 3, actor: 'agent:tutor', learner_lines: ['- I am slow with notation; go easy']});
    expect(notes.history.map((v: {actor: string}) => v.actor)).toEqual(['agent:tutor', 'you', 'agent:tutor']);
    // The same body is not a new version.
    expect((await lc.j(['notes', 'set', '--stdin', '--note', 'again'], {...TUTOR, stdin: '- Likes worked examples (6 of 6)\n- I am slow with notation; go easy\n'})).json.changed).toBe(false);
    // A subject plan is its own document.
    await lc.j(['plan', 'set', id, '--stdin', '--note', 'plan'], {...TUTOR, stdin: '## Plan\n- ownership next'});
    expect((await lc.j(['notes', '--subject', id])).json.notes).toMatchObject({version: 1, body: '## Plan\n- ownership next'});
    const big = 'x'.repeat(9000);
    const capped = await lc.j(['notes', 'set', '--stdin', '--note', 'big'], {...TUTOR, stdin: big});
    expect(capped.code).toBe(1);
    expect(capped.json.error).toContain('notes_max_bytes');
  });
});

describe('fixes, voiding and verdicts', () => {
  test('voiding a question\'s attempts changes retention and memory the way the rules say', async () => {
    const subject = await rustSubject(lc);
    const run = await startRun(lc);
    const lesson = await submitLesson(lc, subject, run, ownershipLesson({hypothesis: 'Code first.'}));
    const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id));
    const [shortText, mc] = quiz.json.question_ids as [string, string];
    await lc.j(['finish', lesson.json.lesson.id]);
    await answerQ(lc, {question: mc, quiz: quiz.json.quiz.id, answer: 'scope'});
    lc.advance({days: 3});
    const review = await submitQuiz(lc, subject, (await lc.j(['run', 'start'], TUTOR)).json.run.id, {items: [{role: 'review', existing: shortText}]});
    const wrong = await answerQ(lc, {question: shortText, quiz: review.json.quiz.id, answer: 'the owner'});
    expect(wrong.attempt.score).toBe(1);
    const before = (await lc.j(['progress', '--subject', subject])).json.progress.retention;
    expect(before).toEqual({n: 1, rate: 1});
    const memoryBefore = lc.db.query('SELECT reps FROM concept_memory').get() as {reps: number};
    expect(memoryBefore.reps).toBe(2);

    // The key was wrong: the review attempt is voided, and the record is as if it never happened.
    await lc.j(['rate', 'question', shortText, 'wrong_key', '--note', 'that is not what Rust calls it']);
    const flag = lc.db.query("SELECT id FROM feedback WHERE kind = 'wrong_key'").get() as {id: string};
    const fixed = await lc.j(['question', 'fix', shortText, '--stdin', '--void-attempts', '--resolve', flag.id, '--reply', 'Rewrote the prompt.'], {
      ...TUTOR,
      stdin: JSON.stringify({...(ownershipQuiz('x').items[0] as {question: object}).question, prompt: 'Which variable frees a value?'}),
    });
    expect(fixed.json).toMatchObject({voided: 1, changed: true, resolved: [flag.id], question: {version: 2}});
    expect((await lc.j(['progress', '--subject', subject])).json.progress.retention).toEqual({n: 0, rate: null});
    expect((lc.db.query('SELECT reps FROM concept_memory').get() as {reps: number}).reps).toBe(1);
    expect(lc.db.query('SELECT void, counts_for_memory FROM attempts WHERE question_id = ?').get(shortText)).toEqual({void: 1, counts_for_memory: 0});
    expect((await due()).subjects.some((s: {reasons: string[]}) => s.reasons.includes('needs_fix'))).toBe(false);

    // Resolving someone else's flag is refused.
    await lc.j(['rate', 'question', mc, 'ambiguous']);
    const other = lc.db.query("SELECT id FROM feedback WHERE kind = 'ambiguous'").get() as {id: string};
    expect((await lc.j(['question', 'fix', shortText, '--stdin', '--resolve', other.id, '--reply', 'x'], {...TUTOR, stdin: JSON.stringify((ownershipQuiz('x').items[0] as {question: object}).question)})).code).toBe(2);

    // The hypothesis gets a verdict.
    const verdict = await lc.j(['lesson', 'verdict', lesson.json.lesson.id, '--note', 'Too early to tell; one review.'], TUTOR);
    expect(verdict.json.lesson.verdict).toBe('Too early to tell; one review.');
  });

  test('a block is fixed in place, its errors cleared, its flags resolved with the reply', async () => {
    const subject = await rustSubject(lc);
    const lesson = await submitLesson(lc, subject, await startRun(lc));
    const block = (await lc.j(['lesson', 'show', lesson.json.lesson.id])).json.lesson.blocks[3];
    const flag = (await lc.j(['rate', 'block', block.id, 'wrong', '--note', 'it does copy for integers'])).json.feedback;
    const fixed = await lc.j(['block', 'fix', block.id, '--stdin', '--resolve', flag.id, '--reply', 'Said which types move.'], {
      ...TUTOR,
      stdin: JSON.stringify({type: 'callout', approach: 'misconception', concepts: ['ownership'], body: {kind: 'pitfall', md: 'For a `String`, `let s2 = s1` moves; integers are copied.'}}),
    });
    expect(fixed.json).toMatchObject({block: {version: 2, body: {kind: 'pitfall'}}, resolved: [flag.id]});
    const reply = (await lc.j(['today'])).json.replies[0];
    expect(reply).toMatchObject({kind: 'wrong', resolved: 'fixed', reply: 'Said which types move.'});
    const question = (await lc.j(['lesson', 'show', lesson.json.lesson.id])).json.lesson.blocks[2];
    expect((await lc.j(['block', 'fix', question.id, '--stdin'], {...TUTOR, stdin: '{}'})).json.error).toContain('question fix');
  });
});

describe('the context', () => {
  test('everything a run needs, in one call', async () => {
    const subject = await rustSubject(lc);
    const run = await startRun(lc);
    const lesson = await submitLesson(lc, subject, run, ownershipLesson({hypothesis: 'Code first.'}));
    const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id));
    await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'First lesson.'], TUTOR);
    await lc.j(['finish', lesson.json.lesson.id, '--rate', 'too_long']);
    const [, mc, free] = quiz.json.question_ids as [string, string, string];
    await answerQ(lc, {question: mc, quiz: quiz.json.quiz.id, answer: 'gc', confidence: 'sure'});
    await answerQ(lc, {question: free, quiz: quiz.json.quiz.id, answer: 'because'});
    lc.advance({days: 1});

    const context = (await lc.j(['context'], TUTOR)).json;
    expect(context).toMatchObject({today: '2026-09-13', due: {due: true}, open_run: null, retro_due: false, contract_changed: false});
    expect(context.settings).toMatchObject({lesson_ready_hour: 5, target_accuracy: 0.85, timezone: 'America/Chicago'});
    expect(context.recent_runs[0].summary).toBe('First lesson.');
    const s = context.subjects[0];
    expect(s.subject.id).toBe(subject);
    expect(s.concepts.find((c: {key: string}) => c.key === 'ownership')).toMatchObject({status: 'introduced', reps: 1, lapses: 0, due: '2026-09-13', is_due: true});
    expect(s.attempts_since_last_run).toHaveLength(2);
    expect(s.attempts_since_last_run[0]).toMatchObject({misconception: 'rust-has-gc', confidence: 'sure', taught_by: {ownership: expect.arrayContaining(['explanation', 'worked_example'])}});
    expect(s.measures.calibration.sure_but_wrong).toEqual([{concept_id: expect.any(String), key: 'ownership', count: 1}]);
    expect(s.measures.misconceptions[0]).toMatchObject({tag: 'rust-has-gc', count: 1, concept_keys: ['ownership']});
    expect(s.measures.hypotheses[0]).toMatchObject({hypothesis: 'Code first.', ready_for_verdict: false});
    expect(s.budget).toEqual({minutes_per_day: 15, lesson_minutes: 9, quiz_minutes: 6, quiz_questions: 8});
    expect(s.readiness).toEqual({ready: true});
    expect(context.regrade).toHaveLength(1);
    expect(context.feedback_since_last_run.map((f: {kind: string}) => f.kind)).toEqual(['too_long']);
  });
});
