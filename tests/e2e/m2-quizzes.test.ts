/**
 * M2: questions, quizzes, grading, the learner's actions and reactions, the no-stacking
 * rule, and what an agent token may not do.
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

async function lessonAndQuiz() {
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const lesson = await submitLesson(lc, subject, run);
  const inline = lesson.json.question_ids.q1 as string;
  const quiz = await submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id, inline));
  expect(quiz.code).toBe(0);
  return {subject, run, lessonId: lesson.json.lesson.id as string, inline, quizId: quiz.json.quiz.id as string, questionIds: quiz.json.question_ids as string[]};
}

describe('inline checks and finishing a lesson', () => {
  test('an inline check is answered in place, opens the lesson, and records what was picked', async () => {
    const {lessonId, inline} = await lessonAndQuiz();
    const wrong = await answerQ(lc, {question: inline, lesson: lessonId, answer: 'a', shown_order: ['c', 'a', 'b'], confidence: 'think', hints_used: 1});
    expect(wrong.ok).toBe(true);
    expect(wrong.attempt).toMatchObject({context: 'lesson', attempt_no: 1, score: 0, misconception: 'move-is-shallow-copy', shown_order: ['c', 'a', 'b'], confidence: 'think', hints_used: 1, counts_for_memory: false});
    expect(wrong.outcome).toMatchObject({why: 'That would mean two owners, and a double free.', key: {answer: 'b'}, explanation: expect.stringContaining('moves ownership')});
    const again = await answerQ(lc, {question: inline, lesson: lessonId, answer: 'b'});
    expect(again.attempt).toMatchObject({attempt_no: 2, score: 1});
    expect((await lc.j(['lesson', 'show', lessonId])).json.lesson.state).toBe('open');
  });

  test('finishing introduces the new concepts and records the rating', async () => {
    const {lessonId} = await lessonAndQuiz();
    const done = await lc.j(['finish', lessonId, '--rate', 'clear']);
    expect(done.json).toMatchObject({introduced: ['ownership'], lesson: {state: 'finished'}});
    const subject = await lc.j(['subject', 'show', 'Rust ownership']);
    expect(subject.json.concepts.find((c: {key: string}) => c.key === 'ownership')).toMatchObject({status: 'introduced', introduced: lc.clock.now});
    const feedback = await lc.j(['agents']);
    expect(feedback.code).toBe(0);
    expect((await lc.j(['finish', lessonId])).json.already).toBe(true);
    expect((await lc.j(['finish', lessonId, '--rate', 'meh'])).code).toBe(2);
  });
});

describe('no stacking', () => {
  test('a second lesson is refused while one is unfinished, and allowed once it is', async () => {
    const subject = await rustSubject(lc);
    const first = await submitLesson(lc, subject, await startRun(lc));
    lc.advance({days: 1});
    const run = await startRun(lc);
    const due = await lc.j(['due'], TUTOR);
    expect(due.json).toMatchObject({due: false, waiting: [{why: 'unfinished_lesson'}]});
    const refused = await submitLesson(lc, subject, run, ownershipLesson({title: 'Moves', concepts: [{key: 'moves', role: 'new'}]}));
    expect(refused.code).toBe(1);
    expect(refused.json).toMatchObject({why: 'unfinished_lesson'});
    expect(refused.json.error).toContain('earlier lesson is still unfinished');

    await lc.j(['finish', first.json.lesson.id]);
    expect((await lc.j(['due'], TUTOR)).json.subjects).toEqual([{id: subject, title: 'Rust ownership', why: 'ready', reasons: ['ready']}]);
    const second = await submitLesson(lc, subject, run, ownershipLesson({title: 'Moves', concepts: [{key: 'moves', role: 'new'}]}));
    expect(second.code).toBe(0);
    expect(second.json.lesson.day).toBe('2026-09-13');
  });

  test('a week away comes back to one lesson waiting', async () => {
    const subject = await rustSubject(lc);
    await submitLesson(lc, subject, await startRun(lc));
    for (let day = 0; day < 7; day++) {
      lc.advance({days: 1});
      const run = (await lc.j(['run', 'start'], TUTOR)).json.run.id;
      await submitLesson(lc, subject, run, ownershipLesson({title: `Day ${day}`, concepts: []}));
    }
    expect((await lc.j(['lessons'])).json.lessons).toHaveLength(1);
  });

  test('before the ready hour and on unscheduled days nothing is written', async () => {
    const subject = await rustSubject(lc, ['--days', 'weekdays']);
    const run = await startRun(lc);
    const saturday = await submitLesson(lc, subject, run);
    expect(saturday.json).toMatchObject({code: 1, why: 'not_scheduled_today'});
    lc.clock.now = '2026-09-14T09:00:00Z'; // Monday, 04:00 in Chicago
    const early = await submitLesson(lc, subject, (await lc.j(['run', 'start'], TUTOR)).json.run.id);
    expect(early.json).toMatchObject({code: 1, why: 'before_ready_hour'});
    expect((await lc.j(['today'])).json.subjects[0].waiting.message).toBe('Your lesson arrives after 05:00.');
  });
});

describe('quizzes', () => {
  test('a quiz with new items opens only once its lesson is finished', async () => {
    const {quizId, lessonId, questionIds} = await lessonAndQuiz();
    const detail = (await lc.j(['quiz', 'show', quizId])).json;
    expect(detail.quiz.blocked).toContain('Opens once you finish the lesson');
    expect(JSON.stringify(detail.quiz.items)).not.toContain('"accept"');
    const early = await answerQ(lc, {question: questionIds[0], quiz: quizId, answer: 'owner'});
    expect(early).toMatchObject({ok: false, code: 1});
    await lc.j(['finish', lessonId]);
    const ok = await answerQ(lc, {question: questionIds[0], quiz: quizId, answer: 'Owner.', confidence: 'sure'});
    expect(ok.attempt).toMatchObject({context: 'quiz', role: 'new', score: 1, graded_by: 'app'});
    expect(ok.quiz).toMatchObject({state: 'open', progress: {total: 4, answered: 1}});
  });

  test('re-submitting a day returns the quiz that is there', async () => {
    const {subject, run, quizId, lessonId} = await lessonAndQuiz();
    const again = await submitQuiz(lc, subject, run, ownershipQuiz(lessonId));
    expect(again.json).toMatchObject({existing: true, quiz: {id: quizId}});
  });

  test('a newer daily quiz supersedes an earlier one only while it is unstarted', async () => {
    const {subject, quizId, lessonId, questionIds} = await lessonAndQuiz();
    await lc.j(['finish', lessonId]);
    lc.advance({days: 1});
    const review = {rationale: 'Reviews only.', items: [{role: 'review', existing: questionIds[1]}]};
    const second = await submitQuiz(lc, subject, await startRun(lc), review);
    expect(second.json.superseded).toEqual([quizId]);
    expect((await lc.j(['today'])).json.subjects[0].quizzes.map((q: {id: string}) => q.id)).toEqual([second.json.quiz.id]);

    // Now start the second one, and a third does not supersede it.
    await answerQ(lc, {question: questionIds[1], quiz: second.json.quiz.id, answer: 'scope'});
    lc.advance({days: 1});
    const third = await submitQuiz(lc, subject, (await lc.j(['run', 'start'], TUTOR)).json.run.id, review);
    expect(third.json.superseded).toEqual([]);
    expect((await fetch(`${lc.url}/api/quizzes/${second.json.quiz.id}`, {headers: {authorization: `Bearer ${lc.token('you')}`}}).then(r => r.json())).quiz.state).toBe('finished');
  });

  test('quiz items are checked: existing questions of this subject, not twice, variants of real ones', async () => {
    const {subject, lessonId, inline} = await lessonAndQuiz();
    await lc.j(['finish', lessonId]);
    lc.advance({days: 1});
    const run = (await lc.j(['run', 'start'], TUTOR)).json.run.id;
    const fresh = (ownershipQuiz(lessonId).items[0] as {question: Record<string, unknown>}).question;
    const probe = await submitQuiz(lc, subject, run, {items: [{role: 'probe', existing: inline}]});
    expect(probe.json.errors.map((e: {path: string}) => e.path)).toEqual(['items[0].role']);
    const bad = await submitQuiz(lc, subject, run, {
      items: [
        {role: 'review', existing: inline},
        {role: 'review', existing: inline},
        {role: 'review', existing: 'zzzzzzzzzzzz'},
        {role: 'review', question: {...fresh, variant_of: 'nope'}},
      ],
    });
    expect(bad.code).toBe(2);
    expect(bad.json.errors.map((e: {path: string}) => e.path)).toEqual(['items[1].existing', 'items[2].existing', 'items[3].question.variant_of']);
    const variant = await submitQuiz(lc, subject, run, {items: [{role: 'review', question: {...fresh, variant_of: inline}}]});
    expect(variant.code).toBe(0);
  });

  test('a placement quiz is all probes, which never count toward memory', async () => {
    const subject = await rustSubject(lc);
    const run = await startRun(lc);
    const probe = (ownershipQuiz('x').items[1] as {question: object}).question;
    const placement = await submitQuiz(lc, subject, run, {rationale: 'Finding your level.', items: [{role: 'probe', question: probe}]}, 'placement');
    expect(placement.json.quiz.kind).toBe('placement');
    const attempt = await answerQ(lc, {question: placement.json.question_ids[0], quiz: placement.json.quiz.id, answer: 'scope'});
    expect(attempt.attempt).toMatchObject({role: 'probe', counts_for_memory: false, score: 1});
    expect(attempt.quiz.state).toBe('finished');
  });
});

describe('self-grades, disputes, reactions', () => {
  test('a free response waits for a self-grade, then the quiz can finish', async () => {
    const {quizId, lessonId, questionIds, inline} = await lessonAndQuiz();
    await lc.j(['finish', lessonId]);
    await answerQ(lc, {question: questionIds[0], quiz: quizId, answer: 'owner'});
    await answerQ(lc, {question: questionIds[1], quiz: quizId, answer: 'scope'});
    await answerQ(lc, {question: inline, quiz: quizId, answer: 'b'});
    const free = await answerQ(lc, {question: questionIds[2], quiz: quizId, answer: 'One owner, so the compiler knows when to drop.'});
    expect(free.outcome).toMatchObject({score: null, needs_self_grade: true, key: {model_answer: expect.any(String), rubric: ['one owner', 'drop at end of scope']}});
    expect(free.quiz.state).toBe('open');
    const graded = await fetch(`${lc.url}/api/attempts/${free.attempt.id}/self-grade`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'}, body: JSON.stringify({grade: 'partly'})}).then(r => r.json());
    expect(graded.attempt).toMatchObject({score: 0.5, graded_by: 'self'});
    expect(graded.quiz.state).toBe('finished');
    // The tutor re-grades; both are kept.
    const regrade = await lc.j(['grade', free.attempt.id, '--score', '1', '--note', 'Names both points.'], TUTOR);
    expect(regrade.json.attempt).toMatchObject({score: 0.5, agent_score: 1, agent_note: 'Names both points.'});
  });

  test('a typed miss can be disputed: it becomes right and flags the question', async () => {
    const {quizId, lessonId, questionIds} = await lessonAndQuiz();
    await lc.j(['finish', lessonId]);
    const miss = await answerQ(lc, {question: questionIds[0], quiz: quizId, answer: 'the dropper'});
    expect(miss.outcome).toMatchObject({score: 0, disputable: true});
    const disputed = await lc.j(['dispute', miss.attempt.id, '--note', 'Rust calls it that too']);
    expect(disputed.json.attempt).toMatchObject({score: 1, graded_by: 'disputed'});
    expect((await lc.j(['due'], TUTOR)).json.subjects[0].reasons).toContain('needs_fix');
    const mc = await answerQ(lc, {question: questionIds[1], quiz: quizId, answer: 'gc'});
    expect((await lc.j(['dispute', mc.attempt.id])).code).toBe(2);
  });

  test('reactions are validated per target, asks need a question, and the tutor replies', async () => {
    const {lessonId, inline} = await lessonAndQuiz();
    const detail = await lc.j(['lesson', 'show', lessonId]);
    const blockId = detail.json.lesson.blocks[0].id;
    expect((await lc.j(['rate', 'block', blockId, 'helpful'])).code).toBe(0);
    expect((await lc.j(['rate', 'block', blockId, 'too_easy'])).code).toBe(2);
    expect((await lc.j(['rate', 'question', inline, 'ambiguous', '--note', 'b and c both fit'])).code).toBe(0);
    expect((await lc.j(['rate', 'subject', 'Rust ownership', 'more_examples'])).code).toBe(0);
    const ask = await lc.j(['ask', blockId, 'Does this apply to integers too?']);
    expect(ask.json.feedback).toMatchObject({target: 'block', kind: 'ask', note: 'Does this apply to integers too?'});
    expect((await lc.j(['ask', blockId])).code).toBe(2);
    const due = await lc.j(['due'], TUTOR);
    expect(due.json.subjects[0].reasons).toEqual(['needs_fix', 'needs_reply']);
    const reply = await lc.j(['reply', ask.json.feedback.id, '--body', 'Integers are Copy, so assignment copies them. Lesson 3 covers it.'], TUTOR);
    expect(reply.json.feedback).toMatchObject({resolved: 'answered'});
    const today = await lc.j(['today']);
    expect(today.json.replies[0].reply).toContain('Copy');
  });

  test('skipping a lesson takes a reason, and skips its quiz', async () => {
    const {lessonId, quizId} = await lessonAndQuiz();
    expect((await lc.j(['skip', lessonId])).code).toBe(2);
    const skipped = await lc.j(['skip', lessonId, '--reason', 'know_it']);
    expect(skipped.json).toMatchObject({lesson: {state: 'skipped'}, quizzes_skipped: [quizId]});
    expect((await lc.j(['finish', lessonId])).code).toBe(1);
  });
});

describe('what an agent token cannot do', () => {
  test('every learner-only command is refused for an agent with exit 2, and says whose it is', async () => {
    const {lessonId, quizId, questionIds, subject} = await lessonAndQuiz();
    const attempt = await answerQ(lc, {question: questionIds[0], quiz: quizId, answer: 'x'}).catch(() => undefined);
    void attempt;
    const commands: string[][] = [
      ['subject', 'add', 'Chess'],
      ['subject', 'edit', subject, '--minutes', '30'],
      ['subject', 'pause', subject],
      ['subject', 'archive', subject],
      ['finish', lessonId],
      ['skip', lessonId, '--reason', 'not_now'],
      ['rate', 'lesson', lessonId, 'clear'],
      ['ask', lessonId, 'why?'],
      ['dispute', 'zzzzzzzzzzzz'],
      ['settings', 'set', 'quiz_max_questions', '50'],
    ];
    for (const agent of ['agent:tutor', 'agent:builder']) {
      for (const argv of commands) {
        const result = await lc.j(argv, {as: agent, stdin: 'x'});
        expect({argv, agent, code: result.code, refused: result.json.refused}).toEqual({argv, agent, code: 2, refused: true});
        expect(result.json.error).toContain("is the learner's to do");
      }
    }
    // An agent can't answer, by any route.
    const direct = await fetch(`${lc.url}/api/attempts`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('agent:tutor')}`, 'content-type': 'application/json'}, body: JSON.stringify({question: questionIds[0], quiz: quizId, answer: 'owner', confidence: 'sure'})});
    expect(direct.status).toBe(403);
    for (const path of ['/api/feedback', `/api/lessons/${lessonId}/open`, `/api/quizzes/${quizId}/open`, '/api/practice', `/api/lessons/${lessonId}/activity`]) {
      const response = await fetch(`${lc.url}${path}`, {method: 'POST', headers: {authorization: `Bearer ${lc.token('agent:tutor')}`, 'content-type': 'application/json'}, body: '{}'});
      expect({path, status: response.status}).toEqual({path, status: 403});
    }
  });

  test('the builder can read everything but write no lessons, quizzes, notes, grades or replies', async () => {
    const {subject, lessonId} = await lessonAndQuiz();
    const BUILDER = {as: 'agent:builder'};
    expect((await lc.j(['lesson', 'show', lessonId], BUILDER)).code).toBe(0);
    expect((await lc.j(['context'], BUILDER)).code).toBe(0);
    for (const argv of [
      ['lesson', 'submit', subject, '--stdin'],
      ['quiz', 'submit', subject, '--stdin'],
      ['notes', 'set', '--stdin', '--note', 'x'],
      ['plan', 'set', subject, '--stdin', '--note', 'x'],
      ['concepts', 'upsert', subject, '--stdin'],
      ['run', 'start'],
      ['reply', 'zzzzzzzzzzzz', '--body', 'x'],
      ['grade', 'zzzzzzzzzzzz', '--score', '1', '--note', 'x'],
    ]) {
      const result = await lc.j(argv, {...BUILDER, stdin: '{}'});
      expect({argv, code: result.code, refused: result.json.refused}).toEqual({argv, code: 2, refused: true});
    }
  });
});

describe('the terminal quiz', () => {
  test('a quiz driven through piped stdin records attempts with confidence, hints and order', async () => {
    const {lessonId, inline} = await lessonAndQuiz();
    await lc.j(['finish', lessonId]);
    const result = await lc.cli(['quiz'], {
      lines: [
        'h', // a hint on the short-text question
        'Owner',
        's',
        '9', // out of range, asked again
        '1', // garbage collector: wrong
        't',
        'Each value has one owner, so drops are known at compile time.',
        'g',
        'g', // self-grade: got it
        '2',
        's',
      ],
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hint: It "owns" it.');
    expect(result.stdout).toContain('✓ right');
    expect(result.stdout).toContain('✗ not quite. The answer: When its owner goes out of scope');
    expect(result.stdout).toContain('why not that one: Rust has no garbage collector.');
    expect(result.stdout).toContain('model answer: Because each value has exactly one owner');
    expect(result.stdout).toMatch(/done: \d+%/);

    const attempts = lc.db.query("SELECT a.confidence, a.hints_used, a.score, a.misconception, a.shown_order, a.role FROM attempts a WHERE a.context = 'quiz' ORDER BY a.at, a.rowid").all() as Array<Record<string, unknown>>;
    expect(attempts).toEqual([
      {confidence: 'sure', hints_used: 1, score: 1, misconception: null, shown_order: null, role: 'new'},
      {confidence: 'think', hints_used: 0, score: 0, misconception: 'rust-has-gc', shown_order: null, role: 'new'},
      {confidence: 'guess', hints_used: 0, score: 1, misconception: null, shown_order: null, role: 'new'},
      {confidence: 'sure', hints_used: 0, score: 1, misconception: null, shown_order: '["a","b","c"]', role: 'review'},
    ]);
    expect(inline).toBeDefined();
    const today = await lc.j(['today']);
    expect(today.json.subjects[0].quizzes[0].state).toBe('finished');
  });

  test('stopping part way keeps the answers so far', async () => {
    const {lessonId} = await lessonAndQuiz();
    await lc.j(['finish', lessonId]);
    const result = await lc.cli(['quiz'], {lines: ['owner', 's']});
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('your answers so far are saved');
    const resumed = await lc.cli(['quiz'], {lines: []});
    expect(resumed.stdout).toContain('[2/4]');
  });
});
