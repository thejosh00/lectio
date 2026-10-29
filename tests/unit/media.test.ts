/** M16: the media ladder, the tools check, and the media measure. */
import {describe, expect, test} from 'bun:test';
import {run} from '../../src/cli.ts';
import {mediaStatus} from '../../src/core/media.ts';
import {mediaOutcomes, type AttemptFact, type BlockFact, type ExperimentOutcome} from '../../src/core/measures.ts';
import {toolsReport} from '../../src/local/tools.ts';

describe('the media ladder', () => {
  test('cheapest first; built or planned in lectio; ready only when built and makeable here', () => {
    const none = mediaStatus(new Set());
    expect(none.map(m => m.type)).toEqual(['image', 'diagram', 'steps', 'widget', 'audio', 'video']);
    expect(none.find(m => m.type === 'image')).toMatchObject({lectio: 'available', ready: true, missing: []});
    expect(none.find(m => m.type === 'widget')).toMatchObject({lectio: 'planned', milestone: 'M9', missing: [['chrome']], ready: false});
    expect(none.find(m => m.type === 'audio')).toMatchObject({lectio: 'not_planned', milestone: null});
    expect(mediaStatus(new Set(['ffmpeg'])).find(m => m.type === 'video')!.missing).toEqual([['manim', 'chrome']]);
    expect(mediaStatus(new Set(['ffmpeg', 'chrome'])).find(m => m.type === 'video')!.missing).toEqual([]);
  });

  test('the tools check finds Chrome at its macOS place or on the PATH, and the rest on the PATH', () => {
    const report = toolsReport({which: c => (c === 'say' || c === 'chromium' ? `/usr/bin/${c}` : null), exists: () => false, env: {}});
    expect(report.tools.filter(t => t.found).map(t => [t.name, t.path])).toEqual([
      ['chrome', '/usr/bin/chromium'],
      ['say', '/usr/bin/say'],
    ]);
    expect(report.media.find(m => m.type === 'audio')!.missing).toEqual([]);
  });

  test('lectio tools runs on this machine without a server', async () => {
    const out: string[] = [];
    const code = await run({argv: ['tools', '--json'], out: l => out.push(l ?? ''), err: () => {}, env: {LECTIO_URL: 'http://127.0.0.1:1'}, tools: {which: () => null, exists: () => false, env: {}}});
    expect(code).toBe(0);
    const body = JSON.parse(out.join('\n'));
    expect(body.ok).toBe(true);
    expect(body.tools.every((t: {found: boolean}) => !t.found)).toBe(true);
  });
});

describe('the media measure', () => {
  let n = 0;
  const review = (concept: string, score: number): AttemptFact => ({
    id: `r${++n}`, question_id: 'q', question_type: 'short_text', aim: 'recall', concepts: [concept], context: 'quiz', role: 'review', attempt_no: 1, score,
    confidence: 'sure', hints_used: 0, seconds: 20, misconception: null, gap_hours: 48, counts_for_memory: true, void: false, day: '2026-09-20', at: '2026-09-20T12:00:00Z', answer: 'x',
  });
  const block = (type: string, over: Partial<BlockFact> = {}): BlockFact => ({approach: 'visual', type, seen_seconds: 30, completed: false, completable: false, helpful: 0, confusing: 0, ...over});
  const experiment = (difference: ExperimentOutcome['difference'], enough: boolean): ExperimentOutcome => ({
    name: 'diagram_vs_text', status: 'open', verdict: null, counts: 'new', enough, difference,
    a: {description: 'a', lessons: 1, concepts: 1, retention: {n: 10, rate: 0.5}, same_day_accuracy: {n: 0, rate: null}, median_seen_seconds: null, median_active_seconds: null, timed_lessons: 0},
    b: {description: 'b', lessons: 1, concepts: 1, retention: {n: 10, rate: 0.7}, same_day_accuracy: {n: 0, rate: null}, median_seen_seconds: null, median_active_seconds: null, timed_lessons: 0},
  });

  test('with and without, engagement, and inline checks left out', () => {
    const rows = mediaOutcomes(
      [{concept_id: 'c1', types: ['diagram', 'markdown']}, {concept_id: 'c2', types: ['markdown', 'question']}],
      [block('diagram', {helpful: 2}), block('markdown'), block('question')],
      [review('c1', 1), review('c1', 1), review('c2', 0)],
      20,
      [],
    );
    expect(rows.map(r => r.type)).toEqual(['diagram', 'markdown']);
    expect(rows[0]).toMatchObject({type: 'diagram', blocks: 1, with: {concepts: 1, n: 2, rate: 1}, without: {concepts: 1, n: 1, rate: 0}, helpful: 2, experiments: [], ready: false});
  });

  test('an experiment counts for a type used in one arm only, oriented with minus without; enough makes it ready', () => {
    const rows = mediaOutcomes([], [block('diagram'), block('markdown')], [], 20, [
      {outcome: experiment({retention: -0.2, low: -0.5, high: 0.1}, true), a_types: ['markdown'], b_types: ['diagram', 'markdown']},
    ]);
    // The diagram was in arm b: a − b = −0.2, so with the diagram it is +0.2.
    expect(rows.find(r => r.type === 'diagram')).toMatchObject({experiments: [{name: 'diagram_vs_text', difference: {retention: 0.2, low: -0.1, high: 0.5}, enough: true}], ready: true});
    // Markdown was in both arms: the experiment says nothing about it.
    expect(rows.find(r => r.type === 'markdown')!.experiments).toEqual([]);
  });
});
