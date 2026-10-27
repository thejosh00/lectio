/**
 * The agent contract is executable: every example command in `lectio agents` runs against
 * a real server and does what the document says. If the CLI or API changes shape, this
 * fails before the tutor does.
 */
import {afterEach, expect, test} from 'bun:test';
import {builderExamples, examinerExamples, tutorExamples, type Example} from '../../src/core/agentsDoc.ts';
import {contractOptions} from '../../src/db/contract.ts';
import {answerQ, ownershipLesson, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {shellWords} from '../helpers/shell.ts';

let lc: Instance | undefined;
afterEach(async () => {
  await lc?.stop();
  lc = undefined;
});

const TUTOR = {as: 'agent:tutor'};

/**
 * A day of history for the examples to work on: a lesson with a hypothesis, a quiz with a
 * free response, a disputed short answer, a block flagged wrong, an ask, a new subject, and
 * proposals at every stage the examples act on. Then the clock moves to the next morning.
 */
async function seed(instance: Instance): Promise<Record<string, string>> {
  const subject = await rustSubject(instance);
  const run = await startRun(instance);
  const lesson = await submitLesson(instance, subject, run, ownershipLesson({hypothesis: 'Worked example before the rule.'}));
  const lessonId = lesson.json.lesson.id as string;
  const inline = lesson.json.question_ids.q1 as string;
  const quiz = await submitQuiz(instance, subject, run, ownershipQuiz(lessonId, inline));
  const [shortText, mc, free] = quiz.json.question_ids as [string, string, string];
  const proposal = (title: string) => instance.file('p.json', {title, area: 'question_type', problem: 'p', change: 'c', success: 's', evidence: []});
  // Two of the tutor's proposals, shipped and waiting for it to check them.
  await instance.j(['proposal', 'add', '--file', proposal('Misconception tags on wrong numeric answers'), '--run', run], TUTOR);
  await instance.j(['proposal', 'add', '--file', proposal('A flashcard block for vocabulary'), '--run', run], TUTOR);
  await instance.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'Seeded.'], TUTOR);
  const build = async (n: string) => {
    await instance.j(['proposal', 'approve', n]);
    await instance.j(['proposal', 'claim', n], {as: 'agent:builder'});
    await instance.j(['proposal', 'submit', n, '--branch', `lectio/p${n}-x`, '--commit', 'abc1234', '--note-file', instance.file('h.md', 'x')], {as: 'agent:builder'});
  };
  for (const n of ['1', '2']) {
    await build(n);
    await instance.j(['proposal', 'shipped', n]);
  }

  await answerQ(instance, {question: inline, lesson: lessonId, answer: 'b'});
  await instance.j(['finish', lessonId]);
  const miss = await answerQ(instance, {question: shortText, quiz: quiz.json.quiz.id, answer: 'owning variable'});
  await instance.j(['dispute', miss.attempt.id]);
  await answerQ(instance, {question: mc, quiz: quiz.json.quiz.id, answer: 'scope'});
  const freeAttempt = await answerQ(instance, {question: free, quiz: quiz.json.quiz.id, answer: 'One owner.'});
  const blocks = (await instance.j(['lesson', 'show', lessonId])).json.lesson.blocks;
  const flag = await instance.j(['rate', 'block', blocks[0].id, 'wrong', '--note', "it's dropped at the closing brace"]);
  const ask = await instance.j(['ask', blocks[1].id, 'Does this apply to integers too?']);
  const music = await instance.j(['subject', 'add', 'Basic music intervals', '--goal', 'name intervals in a lead sheet']);
  const disputeRow = instance.db.query("SELECT id FROM feedback WHERE kind = 'dispute'").get() as {id: string};

  // Two proposals of the learner's: one shipped, waiting for an outcome; one approved, for the builder.
  await instance.j(['proposal', 'add', '--file', proposal('Cloze questions for definitions')]);
  await instance.j(['proposal', 'claim', '3'], {as: 'agent:builder'});
  await instance.j(['proposal', 'submit', '3', '--branch', 'lectio/p3-cloze', '--commit', 'abc1234', '--note-file', instance.file('h.md', 'x')], {as: 'agent:builder'});
  await instance.j(['proposal', 'shipped', '3']);
  await instance.j(['proposal', 'add', '--file', proposal('Show recall on the Today page')]);
  // The builder's examples name their token with --as, so it must be in client.json.
  await instance.cli(['login', '--url', instance.url, '--token', instance.token('agent:builder')]);

  instance.advance({days: 1});
  return {
    '<shipped-change>': '1',
    '<broken-change>': '2',
    '<shipped-proposal>': '3',
    '<approved-proposal>': '4',
    '<branch>': 'lectio/p4-show-recall-on-the-today',
    '<sha>': 'abc1234def5678',
    '<subject>': subject,
    '<new-subject>': music.json.subject.id,
    '<block>': blocks[0].id,
    '<flag>': flag.json.feedback.id,
    '<question>': shortText,
    '<dispute>': disputeRow.id,
    '<ask>': ask.json.feedback.id,
    '<attempt>': freeAttempt.attempt.id,
    '<lesson>': lessonId,
    '<review-question>': mc,
    '<stale-question>': inline,
    '<today>': instance.ctx().today(),
  };
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/<[a-z-]+>/g, placeholder => values[placeholder] ?? placeholder);
}

/** What the examples' responses said that the test checks afterwards. */
const submitted: {arm_seconds?: unknown; asset_labels?: unknown} = {};

async function runExamples(instance: Instance, examples: Example[], values: Record<string, string>): Promise<void> {
  for (const example of examples) {
    let line = fill(example.line, values);
    if (example.file !== undefined) {
      const content = example.file.content;
      const path = instance.file(example.file.name, typeof content === 'string' ? fill(content, values) : fill(JSON.stringify(content), values));
      line = line.replace(` ${example.file.name}`, ` ${path}`);
    }
    expect(line).not.toMatch(/<[a-z-]+>/);
    const argv = shellWords(line);
    expect(argv[0]).toBe('lectio');
    const result = await instance.cli(argv.slice(1), {as: example.as ?? 'agent:tutor', ...(example.stdin === undefined ? {} : {stdin: example.stdin})});
    expect({line: example.line, code: result.code, out: result.code === (example.expect ?? 0) ? '' : result.stdout}).toEqual({line: example.line, code: example.expect ?? 0, out: ''});
    if (argv.includes('--json')) {
      expect(result.json?.ok).toBe(true);
      expect(result.stderr).toBe('');
    }
    if (argv[1] === 'run' && argv[2] === 'start') values['<run>'] = result.json.run.id;
    if (argv[1] === 'asset' && argv[2] === 'put') values['<asset>'] = result.json.asset.id;
    if (argv[1] === 'proposal' && argv[2] === 'add') values['<proposal>'] = String(result.json.proposal.number);
    if (argv[1] === 'lesson' && argv[2] === 'submit' && argv[3] === values['<subject>']) {
      values['<new-lesson>'] = result.json.lesson.id;
      submitted.arm_seconds = result.json.arm_seconds;
    }
    if (argv[1] === 'asset' && argv[2] === 'put') submitted.asset_labels = result.json.asset.labels;
  }
}

test('every example in the contract runs as documented', async () => {
  // Room for the change sent back and the builder's example at once.
  lc = await startInstance({settings: {build_wip_max: '2'}});
  const values = await seed(lc);
  const due = await lc.j(['due'], TUTOR);
  expect(due.json.subjects.map((s: {why: string}) => s.why)).toEqual(['needs_fix', 'needs_plan']);
  expect(due.json.reviews.map((r: {number: number; status: string}) => [r.number, r.status])).toEqual([
    [1, 'shipped'],
    [2, 'shipped'],
  ]);
  await runExamples(lc, tutorExamples(contractOptions(lc.ctx('agent:tutor'))), values);
  await runExamples(lc, builderExamples(), values);
  expect((await lc.j(['proposal', 'show', '1'])).json.proposal).toMatchObject({status: 'shipped', accepted_at: expect.any(String)});
  expect((await lc.j(['proposal', 'show', '2'])).json.proposal).toMatchObject({status: 'changes_requested', accepted_at: null});
  expect((await lc.j(['proposal', 'show', '4'])).json.proposal).toMatchObject({status: 'in_review', branch: 'lectio/p4-show-recall-on-the-today'});
  expect((await lc.j(['proposal', 'show', '5'])).json.proposal).toMatchObject({support: 2, proposed_by: 'agent:tutor'});
  expect((await lc.j(['proposal', 'show', '3'])).json.proposal.outcome).toBe('helped');

  // What the examples did, as the learner sees it.
  expect((await lc.j(['due'], TUTOR)).json).toMatchObject({due: false});
  const runs = (await lc.j(['runs'])).json.runs;
  expect(runs[0]).toMatchObject({outcome: 'ok', made: {lessons: 2, quizzes: 2, fixes: 2, replies: 1, grades: 1}});
  const today = (await lc.j(['today'])).json;
  expect(today.subjects.map((s: {lesson: {title: string}}) => s.lesson.title)).toEqual(['Moves: handing ownership over', 'Intervals: a map of the road ahead']);
  expect(today.replies).toHaveLength(3);
  // The lesson's image block shows the SVG the example stored.
  const moves = (await lc.j(['lesson', 'show', values['<new-lesson>']!])).json.lesson;
  const image = moves.blocks.find((b: {type: string}) => b.type === 'image');
  expect(image.body).toMatchObject({asset: values['<asset>'], caption: 'After the move: one owner, one buffer'});
  const served = await fetch(`${lc.url}/assets/${values['<asset>']}`, {headers: {authorization: `Bearer ${lc.token('you')}`}});
  expect(served.headers.get('content-type')).toBe('image/svg+xml');
  expect(await served.text()).toContain('"hi" (heap)');
  // The submit timed each arm (#4); the SVG's three labels count toward the shared image.
  expect(submitted.asset_labels).toBe(3);
  expect(submitted.arm_seconds).toMatchObject({longer: 'a', blocks: {a: [{position: 2, type: 'code'}], b: [{position: 1, type: 'markdown'}]}});
  // The placement probe's anticipated wrong answer records its tag.
  const probe = lc.db.query("SELECT i.quiz_id, i.question_id FROM quiz_items i JOIN questions q ON q.id = i.question_id WHERE q.type = 'numeric'").get() as {quiz_id: string; question_id: string};
  const counted = await answerQ(lc, {question: probe.question_id, quiz: probe.quiz_id, answer: 5});
  expect(counted.attempt).toMatchObject({score: 0, misconception: 'counts-notes-not-steps'});
  expect(counted.outcome.why).toContain('four steps');

  // The context the preflight example reads gives each arm its reading time, and a finished
  // two-arm lesson its assigned arm (#5).
  const learnerView = (await (await fetch(`${lc.url}/api/lessons/${values['<new-lesson>']}`, {headers: {authorization: `Bearer ${lc.token('you')}`}})).json()) as any;
  const shownIds = learnerView.lesson.blocks.map((b: {id: string}) => b.id);
  const seen = moves.blocks.find((b: {id: string; arm: string | null}) => b.arm !== null && shownIds.includes(b.id));
  await fetch(`${lc.url}/api/lessons/${values['<new-lesson>']}/activity`, {
    method: 'POST',
    headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'},
    body: JSON.stringify({active_seconds: 200, blocks: [{id: seen.id, seen_seconds: 40}]}),
  });
  await lc.j(['finish', values['<new-lesson>']!]);
  const context = (await lc.j(['context'], TUTOR)).json;
  const rust = context.subjects.find((s: {subject: {id: string}}) => s.subject.id === values['<subject>']);
  const recent = rust.recent_lessons.find((l: {id: string}) => l.id === values['<new-lesson>']);
  expect(recent.assigned_arm).toBe(seen.arm);
  expect(rust.recent_lessons.find((l: {id: string}) => l.id === values['<lesson>']).assigned_arm).toBeNull();
  const [experiment] = rust.measures.experiments;
  const other = seen.arm === 'a' ? 'b' : 'a';
  expect(experiment[seen.arm]).toMatchObject({median_seen_seconds: 40, median_active_seconds: 200, timed_lessons: 1});
  expect(experiment[other]).toMatchObject({median_seen_seconds: null, median_active_seconds: null, timed_lessons: 0});
});

test("the examiner's examples run as documented", async () => {
  lc = await startInstance({settings: {exam_min_age_days: '1'}});
  // Three concepts introduced a day ago: all three are drawn, in some order.
  const subject = await rustSubject(lc);
  const run = await startRun(lc);
  const keys = ['stack-vs-heap', 'ownership', 'moves'];
  const lesson = await submitLesson(lc, subject, run, ownershipLesson({concepts: keys.map(key => ({key, role: 'new'})), blocks: [{type: 'markdown', approach: 'explanation', concepts: keys, body: {md: 'x'}}], questions: []}));
  await lc.j(['finish', lesson.json.lesson.id]);
  await lc.cli(['login', '--url', lc.url, '--token', lc.token('agent:examiner')]);
  lc.advance({days: 1});
  await runExamples(lc, examinerExamples(), {'<subject>': subject});
  const today = (await lc.j(['today'])).json;
  expect(today.subjects[0].quizzes.map((q: {kind: string; progress: {total: number}}) => [q.kind, q.progress.total])).toEqual([['exam', 3]]);
  expect((await lc.j(['exam', 'due'], {as: 'agent:examiner'})).json.waiting[0].why).toBe('waiting_for_learner');
});

test('the document shows exactly those examples, the registries and the limits', async () => {
  lc = await startInstance({settings: {quiz_max_questions: '9'}});
  const result = await lc.j(['agents'], TUTOR);
  expect(result.code).toBe(0);
  const doc: string = result.json.document;
  for (const example of [...tutorExamples(contractOptions(lc.ctx('agent:tutor'))), ...builderExamples(), ...examinerExamples()]) expect(doc).toContain(example.line);
  for (const area of ['`block_type`', '`limits`', '`improvement_loop`']) expect(doc).toContain(area);
  for (const type of ['`markdown`', '`callout`', '`code`', '`question`', '`image`', '`multiple_choice`', '`cloze`', '`free_response`']) expect(doc).toContain(`| ${type} |`);
  expect(doc).toContain('| questions per quiz | 9 |');
  expect(doc).toContain('`worked_example`');
  expect(result.json.contract_version).toMatch(/^[0-9a-f]{12}$/);
  // Steps are numbered without gaps.
  const steps = [...doc.matchAll(/^(\d+)\. \*\*/gm)].map(m => Number(m[1]));
  expect(steps).toEqual(steps.map((_, i) => i + 1));
});

test('the contract version changes when the document does', async () => {
  lc = await startInstance();
  const before = (await lc.j(['agents'])).json.contract_version;
  await lc.j(['settings', 'set', 'quiz_max_questions', '20']);
  expect((await lc.j(['agents'])).json.contract_version).not.toBe(before);
});
