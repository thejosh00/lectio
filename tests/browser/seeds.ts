/** What a browser test starts from. Generic content only: nothing personal belongs in fixtures. */
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ownershipLesson, ownershipQuiz, rustSubject, startRun, submitLesson, submitQuiz} from '../helpers/fixtures.ts';
import type {Instance} from '../helpers/instance.ts';

const TUTOR = {as: 'agent:tutor'};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const LONG_LINE = `let value = ${'some_function_with_a_long_name('.repeat(6)}1${')'.repeat(6)};`;
// Real lessons fence code inside text and prompts too, and on a phone that once pushed the whole page sideways.
const FENCE = `\`\`\`python\n${LONG_LINE}\n\`\`\``;
// A wide formula scrolls in its own box, and KaTeX's hidden copy for screen readers has to stay in there with it.
const WIDE_MATH = `$$A = \\begin{pmatrix} ${Array.from({length: 12}, (_, i) => `a_{${i}}`).join(' & ')} \\\\ ${Array.from({length: 12}, (_, i) => `b_{${i}}`).join(' & ')} \\end{pmatrix}$$`;
const LONG_WORD = `https://example.com/${'a-very-long-path-segment/'.repeat(8)}`;
const WIDE_TABLE = `| ${Array.from({length: 9}, (_, i) => `Column number ${i}`).join(' | ')} |\n|${' --- |'.repeat(9)}\n| ${Array.from({length: 9}, () => 'a value that takes room').join(' | ')} |`;
const DIAGRAM = 'flowchart TD\n  engine[Engine] --> gearbox[Transmission] --> shaft[Driveshaft]\n  shaft --> diff[Differential] --> wheels[Wheels]';
const WIDE_DIAGRAM = `flowchart LR\n  ${Array.from({length: 9}, (_, i) => `n${i}[Long step name ${i}]`).join(' --> ')}`;
const ANIMATION = `<canvas id="c" width="340" height="200"></canvas>
<script>
  const g = document.getElementById('c').getContext('2d');
  lectio.animate(t => {
    g.fillStyle = lectio.theme.paper; g.fillRect(0, 0, 340, 200);
    g.fillStyle = lectio.theme.focus; g.fillRect(20 + t * 30, 80, 40, 40);
  }, {duration: 1});
</script>`;
const WIDGET_QUESTION = `<button id="go">Set it</button>
<script>document.getElementById('go').onclick = () => lectio.answer({value: {threshold: 120}, score: 1});</script>`;

const common = {aim: 'understand', difficulty: 2, concepts: ['ownership'], explanation: 'One owner at a time.'};

/** A question of every type lectio can ask, each answered through the page by `answer` in quiz.pw.ts. */
export const everyQuestion = [
  {...common, explanation: `One owner at a time.\n\n${FENCE}`, type: 'multiple_choice', prompt: `Pick the owner rule for this.\n\n${FENCE}`, body: {choices: [{id: 'one', md: 'One owner'}, {id: 'two', md: 'Two owners', misconception: 'many-owners', why: 'Two would free twice.'}], answer: 'one', shuffle: false}},
  {...common, type: 'multi_select', prompt: 'Which of these own their data?', body: {choices: [{id: 'string', md: '`String`'}, {id: 'vec', md: '`Vec<u8>`'}, {id: 'ref', md: '`&str`', misconception: 'refs-own', why: 'It borrows.'}], answer: ['string', 'vec'], shuffle: false}},
  {...common, type: 'numeric', prompt: 'How many owners can a value have?', body: {answer: 1, tolerance: 0}},
  {...common, type: 'short_text', prompt: `What frees the value? \`${LONG_LINE}\``, body: {accept: ['owner', 'the owner']}},
  {...common, type: 'cloze', prompt: 'Fill in the blank.', body: {text: 'A value has one {{who}} at a time.', blanks: {who: {accept: ['owner']}}}},
  {...common, type: 'ordering', prompt: 'Put these in order.', body: {items: [{id: 'a', md: 'Allocate'}, {id: 'b', md: 'Move'}, {id: 'c', md: 'Drop'}], answer: ['a', 'b', 'c']}},
  {...common, type: 'matching', prompt: 'Match each to what it does.', body: {left: [{id: 'l1', md: 'Move'}, {id: 'l2', md: 'Borrow'}], right: [{id: 'r1', md: 'Takes ownership'}, {id: 'r2', md: 'Takes a reference'}], answer: {l1: 'r1', l2: 'r2'}}},
  {...common, type: 'free_response', prompt: 'Why is there no garbage collector?', body: {model_answer: 'The compiler knows where each owner ends.', rubric: ['one owner', 'drop at end of scope']}},
  {...common, type: 'widget', aim: 'apply', difficulty: 3, prompt: 'Use the widget.', body: {html: WIDGET_QUESTION, height: 200, alt: 'a button that sets a threshold'}},
];

/** A block of every type lectio can render, with the wide content that breaks a phone layout. */
export async function everyBlock(lc: Instance) {
  const pixel = join(lc.dir, 'pixel.png');
  writeFileSync(pixel, PNG);
  const asset = await lc.j(['asset', 'put', pixel], TUTOR);
  if (asset.code !== 0) throw new Error(`asset: ${asset.stdout}`);
  const on = {concepts: ['ownership']};
  return [
    {...on, type: 'markdown', approach: 'explanation', body: {md: `Every value has one **owner**: $e^{i\\pi} + 1 = 0$.\n\n$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} + \\frac{a_1 b_1 + a_2 b_2 + a_3 b_3 + a_4 b_4 + a_5 b_5}{c_1 d_1 + c_2 d_2 + c_3 d_3}$$\n\nA long link: ${LONG_WORD}\n\n${WIDE_TABLE}\n\n${FENCE}\n\nInline, too: \`${LONG_LINE}\`\n\n${WIDE_MATH}`}},
    {...on, type: 'callout', approach: 'misconception', body: {kind: 'pitfall', md: `\`let s2 = s1\` does not copy. ${LONG_WORD}\n\n${FENCE}`}},
    {...on, type: 'code', approach: 'worked_example', body: {lang: 'rust', source: LONG_LINE, output: LONG_LINE}},
    {...on, type: 'question', approach: 'retrieval', body: {ref: 'q1'}},
    {...on, type: 'image', approach: 'visual', body: {asset: asset.json.asset.id, alt: 'one pixel standing in for a photo', caption: 'A picture'}},
    {...on, type: 'diagram', approach: 'visual', body: {mermaid: DIAGRAM, alt: 'Power flows from the engine to the wheels.', caption: 'From engine to wheels'}},
    {...on, type: 'diagram', approach: 'visual', body: {mermaid: WIDE_DIAGRAM, alt: 'Nine steps in a long line.', caption: 'A wide one'}},
    {...on, type: 'steps', approach: 'step_through', body: {alt: 's1 owns the buffer, then s2 does', frames: [{mermaid: 'flowchart TD\n  s1["s1 owns the buffer"]', caption: 'Before the move.', ask: 'After the move, who owns it?'}, {mermaid: 'flowchart TD\n  s1 --> s2["s2 owns the buffer"]', caption: 'After the move.'}]}},
    {...on, type: 'widget', approach: 'animation', body: {kind: 'animation', html: ANIMATION, height: 220, alt: 'a square moves right', duration: 1, steps: [{at: 0, caption: 'It starts at the left.'}]}},
  ];
}

async function subjectAndRun(lc: Instance) {
  const subject = await rustSubject(lc);
  return {subject, run: await startRun(lc)};
}

async function ok<T extends {code: number; stdout: string}>(what: string, result: Promise<T>): Promise<T> {
  const done = await result;
  if (done.code !== 0) throw new Error(`${what}: ${done.stdout}`);
  return done;
}

let later: {subject: string; run: string} | undefined;

export const seeds: Record<string, (lc: Instance) => Promise<unknown>> = {
  empty: async () => ({}),

  /** The ordinary day: one lesson, one quiz. */
  async lesson(lc) {
    const {subject, run} = await subjectAndRun(lc);
    const lesson = await ok('lesson', submitLesson(lc, subject, run, ownershipLesson()));
    const quiz = await ok('quiz', submitQuiz(lc, subject, run, ownershipQuiz(lesson.json.lesson.id)));
    return {subject, lesson: lesson.json.lesson.id, quiz: quiz.json.quiz.id};
  },

  /** The subject now, its lesson later: for one that arrives while the page is open. */
  async 'lesson-later'(lc) {
    later = await subjectAndRun(lc);
    return later;
  },
  async 'lesson-now'(lc) {
    const {subject, run} = later!;
    return (await ok('lesson', submitLesson(lc, subject, run, ownershipLesson()))).json.lesson.id;
  },

  /** Everything at once, and everything wide. */
  async everything(lc) {
    const {subject, run} = await subjectAndRun(lc);
    const base = ownershipLesson();
    const lesson = await ok('lesson', submitLesson(lc, subject, run, {...base, title: 'Every kind of block, including counterrevolutionarily-long-unbreakable-compound-words', sources: [...base.sources, {title: 'The Rust Book, ch. 4.2', url: 'https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html'}], blocks: await everyBlock(lc), questions: base.questions.map(q => ({...q, prompt: `${q.prompt}\n\n${FENCE}`}))}));
    const quiz = await ok('quiz', submitQuiz(lc, subject, run, {
      lesson: lesson.json.lesson.id,
      rationale: 'One of each.',
      items: everyQuestion.map(question => ({role: 'new', question})),
    }));
    await ok('proposal', lc.j(['proposal', 'add', '--file', lc.file('p.json', {
      title: 'A flashcard block for vocabulary drills',
      area: 'block_type',
      problem: 'Vocabulary taught as markdown tables is retained at 48% against 79% for everything else.',
      change: 'A flashcard block: prompt, recall before reveal, self-rating.',
      success: 'Retention of vocabulary concepts rises toward the overall rate.',
      evidence: [{kind: 'measure', note: 'retention 0.48 (n=40) vs 0.79'}],
    }), '--run', run], TUTOR));
    return {subject, lesson: lesson.json.lesson.id, quiz: quiz.json.quiz.id};
  },
};
