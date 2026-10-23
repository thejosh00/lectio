/**
 * M7: proposals round the loop — filed, decided, built, reviewed, shipped, judged — and
 * who may do what at each step.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {startRun} from '../helpers/fixtures.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';

let lc: Instance;
beforeEach(async () => {
  lc = await startInstance();
});
afterEach(async () => {
  await lc.stop();
});

const TUTOR = {as: 'agent:tutor'};
const BUILDER = {as: 'agent:builder'};

const flashcards = (over: Record<string, unknown> = {}) => ({
  title: 'A flashcard block for vocabulary drills',
  area: 'block_type',
  problem: 'Vocabulary taught as markdown tables is retained at 48% against 79% for everything else.',
  change: 'A flashcard block: prompt, recall before reveal, self-rating.',
  success: 'Retention of vocabulary concepts rises toward the overall rate.',
  evidence: [{kind: 'measure', note: 'retention 0.48 (n=40) vs 0.79'}],
  ...over,
});

async function file(as: {as: string} | Record<string, never>, proposal: unknown, extra: string[] = []) {
  return lc.j(['proposal', 'add', '--file', lc.file('p.json', proposal), ...extra], as);
}

describe('the lifecycle', () => {
  test('filed by the tutor, approved by you, built by the builder, shipped, judged', async () => {
    const run = await startRun(lc);
    const filed = await file(TUTOR, flashcards(), ['--run', run]);
    expect(filed.code).toBe(0);
    expect(filed.json.proposal).toMatchObject({number: 1, status: 'open', proposed_by: 'agent:tutor', run_id: run, support: 1});
    expect(filed.json.caps).toEqual({this_run_left: 1, open_left: 7});
    expect((await lc.j(['today'])).json.improvements).toBe(1);

    expect((await lc.j(['proposals', 'due'], BUILDER)).json).toMatchObject({due: false});
    const approved = await lc.j(['proposal', 'approve', '1', '--priority', 'high', '--note', 'Yes: vocabulary is half my Spanish.']);
    expect(approved.json.proposal).toMatchObject({status: 'approved', priority: 'high'});
    expect((await lc.j(['proposals', 'due'], BUILDER)).json).toMatchObject({due: true, why: ['approved'], next: 1});

    expect((await lc.j(['proposal', 'claim', '1'], BUILDER)).json.proposal.status).toBe('building');
    const asked = await lc.j(['proposal', 'ask', '1', 'Self-rating 1–3 or 1–4?'], BUILDER);
    expect(asked.json.proposal.status).toBe('needs_info');
    expect((await lc.j(['today'])).json.improvements).toBe(1);
    const answered = await lc.j(['proposal', 'answer', '1', 'Three: again, hard, good.']);
    expect(answered.json.proposal.status).toBe('approved');
    expect((await lc.j(['proposals', 'due'], BUILDER)).json).toMatchObject({due: true, why: ['question_answered'], next: 1});
    await lc.j(['proposal', 'claim', '1'], BUILDER);
    const handback = lc.file('handback.md', '## What changed\nA flashcard block.\n\n## Protected paths touched\nnone\n');
    const submitted = await lc.j(['proposal', 'submit', '1', '--branch', 'lectio/p1-flashcard-block', '--commit', 'abc1234def', '--note-file', handback], BUILDER);
    expect(submitted.json.proposal).toMatchObject({status: 'in_review', branch: 'lectio/p1-flashcard-block', commit_sha: 'abc1234def'});

    const changes = await lc.j(['proposal', 'request-changes', '1', '--note', 'The card is too small on a phone.']);
    expect(changes.json.proposal.status).toBe('changes_requested');
    expect((await lc.j(['proposals', 'due'], BUILDER)).json).toMatchObject({due: true, why: ['changes_requested']});
    await lc.j(['proposal', 'claim', '1'], BUILDER);
    await lc.j(['proposal', 'submit', '1', '--branch', 'lectio/p1-flashcard-block', '--commit', 'abc1234ffff', '--note-file', handback], BUILDER);
    const shipped = await lc.j(['proposal', 'shipped', '1']);
    expect(shipped.json.proposal).toMatchObject({status: 'shipped', shipped_at: lc.clock.now});

    // The tutor sees it shipped, then judges it once it has used it.
    lc.advance({days: 1});
    const context = (await lc.j(['context'], TUTOR)).json;
    expect(context.shipped_since_last_run.map((p: {number: number}) => p.number)).toEqual([1]);
    expect(context.awaiting_outcome[0]).toMatchObject({number: 1, overdue: false});
    lc.advance({days: 14});
    expect((await lc.j(['context'], TUTOR)).json.awaiting_outcome[0].overdue).toBe(true);
    const outcome = await lc.j(['proposal', 'outcome', '1', 'helped', '--note', 'Vocabulary retention 48% → 71% over 30 reviews.'], TUTOR);
    expect(outcome.json.proposal).toMatchObject({outcome: 'helped', status: 'shipped'});
    const shown = await lc.j(['proposal', 'show', '1']);
    expect(shown.json.proposal.comments.map((c: {kind: string}) => c.kind)).toEqual(['decision', 'question', 'answer', 'handback', 'review', 'handback', 'outcome']);
  });

  test('declining and deferring need a reason; the tutor withdraws only its own, while open', async () => {
    const run = await startRun(lc);
    await file(TUTOR, flashcards(), ['--run', run]);
    expect((await lc.j(['proposal', 'decline', '1'])).code).toBe(2);
    expect((await lc.j(['proposal', 'defer', '1', '--note', 'After the exam.'])).json.proposal.status).toBe('deferred');
    await file({}, flashcards({title: 'Mine'}), ['--open']);
    expect((await lc.j(['proposal', 'withdraw', '2', '--note', 'x'], TUTOR)).json.error).toContain("its proposer's (you)");
    expect((await lc.j(['proposal', 'withdraw', '1', '--note', 'Superseded by #2.'], TUTOR)).json.proposal.status).toBe('withdrawn');
    expect((await lc.j(['proposal', 'approve', '1'])).code).toBe(1);
  });

  test('yours are approved on filing unless --open; the builder files about building', async () => {
    expect((await file({}, flashcards())).json.proposal).toMatchObject({status: 'approved', proposed_by: 'you'});
    expect((await file({}, flashcards({title: 'Later'}), ['--open'])).json.proposal.status).toBe('open');
    expect((await file(BUILDER, flashcards({title: 'Split routes/lessons.ts', area: 'other'}))).json.proposal).toMatchObject({status: 'open', proposed_by: 'agent:builder'});
  });

  test('a duplicate is refused in favour of support, which adds evidence', async () => {
    const run = await startRun(lc);
    await file(TUTOR, flashcards(), ['--run', run]);
    const dup = await file(TUTOR, flashcards({title: 'a flashcard block for VOCABULARY drills'}), ['--run', run]);
    expect(dup.json).toMatchObject({code: 1, number: 1});
    const supported = await lc.j(['proposal', 'support', '1', '--evidence', '[{"kind":"measure","note":"still 50%"}]', '--note', 'Hit it again with Spanish verbs.', '--run', run], TUTOR);
    expect(supported.json.proposal).toMatchObject({support: 2, evidence: [{kind: 'measure'}, {kind: 'measure', note: 'still 50%'}]});
    const badEvidence = await lc.j(['proposal', 'support', '1', '--evidence', '[{"kind":"lesson","id":"zzzzzzzzzzzz","note":"x"}]', '--note', 'x', '--run', run], TUTOR);
    expect(badEvidence.code).toBe(2);
  });
});

describe('the tutor sees what shipped for it', () => {
  const handback = () => lc.file('handback.md', '## What changed\nA flashcard block.\n\n## For the tutor\n`{"type": "flashcard", …}`\n');
  async function shipped(commit = 'abc1234def'): Promise<void> {
    await lc.j(['proposal', 'claim', '1'], BUILDER);
    await lc.j(['proposal', 'submit', '1', '--branch', 'lectio/p1-flashcard-block', '--commit', commit, '--note-file', handback()], BUILDER);
    await lc.j(['proposal', 'shipped', '1']);
  }
  async function filed(): Promise<void> {
    const run = await startRun(lc);
    await file(TUTOR, flashcards(), ['--run', run]);
    await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'x'], TUTOR);
    await lc.j(['proposal', 'approve', '1']);
  }

  test('a build in review is yours to ship; once it runs, it wakes the tutor to check it', async () => {
    await filed();
    await lc.j(['proposal', 'claim', '1'], BUILDER);
    await lc.j(['proposal', 'submit', '1', '--branch', 'lectio/p1-flashcard-block', '--commit', 'abc1234def', '--note-file', handback()], BUILDER);
    expect((await lc.j(['due'], TUTOR)).json).toMatchObject({due: false, reviews: []});
    expect((await lc.j(['today'])).json.improvements).toBe(1);
    expect((await lc.cli(['proposals'])).stdout).toContain('ready to ship');
    expect((await lc.j(['proposal', 'review', '1', 'accept', '--note', 'x'], TUTOR)).json).toMatchObject({code: 1, error: expect.stringContaining("hasn't shipped yet")});

    await lc.j(['proposal', 'shipped', '1']);
    expect((await lc.j(['due'], TUTOR)).json).toMatchObject({due: true, subjects: [], reviews: [{number: 1, status: 'shipped'}]});
    const context = (await lc.j(['context'], TUTOR)).json;
    expect(context.to_review).toEqual([expect.objectContaining({number: 1, status: 'shipped', success: flashcards().success, branch: 'lectio/p1-flashcard-block', handback: expect.stringContaining('For the tutor')})]);
    expect((await lc.j(['today'])).json.improvements).toBe(0);
    expect((await lc.cli(['proposals'])).stdout).toContain('shipped, tutor checking');

    expect((await lc.j(['proposal', 'review', '1', 'accept'], TUTOR)).code).toBe(2);
    const accepted = await lc.j(['proposal', 'review', '1', 'accept', '--note', 'Recall before reveal, as asked.'], TUTOR);
    expect(accepted.json.proposal).toMatchObject({status: 'shipped', accepted_at: lc.clock.now});
    expect(accepted.json.proposal.comments.at(-1)).toMatchObject({kind: 'accept', actor: 'agent:tutor', body: 'Recall before reveal, as asked.'});
    expect((await lc.j(['due'], TUTOR)).json).toMatchObject({due: false, reviews: []});
    expect((await lc.j(['context'], TUTOR)).json.to_review).toEqual([]);
    expect((await lc.j(['proposal', 'review', '1', 'accept', '--note', 'again'], TUTOR)).json).toMatchObject({code: 1, error: expect.stringContaining('accepted it already')});
    // Its outcome is still the tutor's to give, once it has used it.
    expect((await lc.j(['context'], TUTOR)).json.awaiting_outcome.map((p: {number: number}) => p.number)).toEqual([1]);
  });

  test("if it doesn't work, the tutor asks for another change, and checks the next one when it ships", async () => {
    await filed();
    await shipped();
    const again = await lc.j(['proposal', 'review', '1', 'changes', '--note', 'It reveals on tap: no recall step first.'], TUTOR);
    expect(again.json.proposal.status).toBe('changes_requested');
    expect(again.json.proposal.comments.at(-1)).toMatchObject({kind: 'review', actor: 'agent:tutor'});
    expect((await lc.j(['proposals', 'due'], BUILDER)).json).toMatchObject({due: true, why: ['changes_requested'], next: 1});
    expect((await lc.j(['due'], TUTOR)).json.due).toBe(false);
    await shipped('abc1234eeee');
    expect((await lc.j(['due'], TUTOR)).json.reviews).toEqual([{number: 1, title: flashcards().title, status: 'shipped'}]);
    expect((await lc.j(['proposal', 'review', '1', 'accept', '--note', 'Asks first now.'], TUTOR)).json.proposal).toMatchObject({status: 'shipped', accepted_at: lc.clock.now});
    await lc.j(['proposal', 'outcome', '1', 'helped', '--note', 'x'], TUTOR);
    expect((await lc.j(['proposal', 'review', '1', 'changes', '--note', 'x'], TUTOR)).code).toBe(1);
  });

  test("yours and the builder's are yours to judge; the tutor checks only its own", async () => {
    await file({}, flashcards());
    await shipped();
    expect((await lc.j(['due'], TUTOR)).json.reviews).toEqual([]);
    const refused = await lc.j(['proposal', 'review', '1', 'accept', '--note', 'x'], TUTOR);
    expect(refused.json).toMatchObject({code: 2, refused: true, error: expect.stringContaining("its proposer's (you)")});
    for (const as of [{}, BUILDER]) expect((await lc.j(['proposal', 'review', '1', 'accept', '--note', 'x'], as)).json.refused).toBe(true);
  });
});

describe('who may do what', () => {
  test('only you approve, decline, defer, request changes, answer, or mark shipped', async () => {
    await file({}, flashcards(), ['--open']);
    for (const as of [TUTOR, BUILDER]) {
      for (const argv of [
        ['proposal', 'approve', '1'],
        ['proposal', 'decline', '1', '--note', 'x'],
        ['proposal', 'defer', '1', '--note', 'x'],
        ['proposal', 'request-changes', '1', '--note', 'x'],
        ['proposal', 'answer', '1', 'x'],
        ['proposal', 'shipped', '1'],
      ]) {
        const result = await lc.j(argv, as);
        expect({argv, as: as.as, code: result.code, refused: result.json.refused}).toEqual({argv, as: as.as, code: 2, refused: true});
      }
    }
  });

  test('only the builder claims, asks and submits; only the tutor judges outcomes', async () => {
    await file({}, flashcards());
    for (const as of [{}, TUTOR]) {
      for (const argv of [['proposal', 'claim', '1'], ['proposal', 'ask', '1', 'x'], ['proposal', 'submit', '1', '--branch', 'lectio/p1-x', '--commit', 'abcdef1', '--note-file', lc.file('h.md', 'x')]]) {
        const result = await lc.j(argv, as);
        expect({argv, code: result.code, refused: result.json.refused}).toEqual({argv, code: 2, refused: true});
      }
    }
    expect((await lc.j(['proposal', 'outcome', '1', 'helped', '--note', 'x'], BUILDER)).json.refused).toBe(true);
    expect((await lc.j(['proposal', 'outcome', '1', 'helped', '--note', 'x'])).json.refused).toBe(true);
  });
});

describe('the caps', () => {
  test('a third proposal in one run is refused, and a ninth open one', async () => {
    let run = await startRun(lc);
    expect((await file(TUTOR, flashcards({title: 'One'}), ['--run', run])).code).toBe(0);
    expect((await file(TUTOR, flashcards({title: 'Two'}), ['--run', run])).code).toBe(0);
    const third = await file(TUTOR, flashcards({title: 'Three'}), ['--run', run]);
    expect(third.json).toMatchObject({code: 1, cap: 'proposals_per_run'});
    const filed = ['One', 'Two'];
    for (let i = 3; filed.length < 8; i++) {
      await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'x'], TUTOR);
      run = await startRun(lc);
      for (let k = 0; k < 2 && filed.length < 8; k++) {
        const title = `P${i}-${k}`;
        expect((await file(TUTOR, flashcards({title}), ['--run', run])).code).toBe(0);
        filed.push(title);
      }
    }
    await lc.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'x'], TUTOR);
    run = await startRun(lc);
    const ninth = await file(TUTOR, flashcards({title: 'Nine'}), ['--run', run]);
    expect(ninth.json).toMatchObject({code: 1, cap: 'proposals_open_max'});
    // Approved ones don't count against it.
    await lc.j(['proposal', 'approve', '1']);
    expect((await file(TUTOR, flashcards({title: 'Nine'}), ['--run', run])).code).toBe(0);
  });

  test('one build in flight at a time', async () => {
    await file({}, flashcards({title: 'A'}));
    await file({}, flashcards({title: 'B'}));
    expect((await lc.j(['proposal', 'claim', '1'], BUILDER)).code).toBe(0);
    expect((await lc.j(['proposals', 'due'], BUILDER)).json.due).toBe(false);
    const second = await lc.j(['proposal', 'claim', '2'], BUILDER);
    expect(second.json).toMatchObject({code: 1, cap: 'build_wip_max'});
  });
});
