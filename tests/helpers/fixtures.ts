/**
 * Generic fixture content: a "Rust ownership" subject and the lessons and quizzes a
 * tutor might write for it. Nothing personal belongs in fixtures.
 */
import type {Instance} from './instance.ts';

export const RUST_CONCEPTS = [
  {key: 'stack-vs-heap', title: 'Stack and heap', summary: 'Where values live, and what that costs', prereqs: [], position: 1},
  {key: 'ownership', title: 'Ownership', summary: 'Every value has exactly one owner', prereqs: ['stack-vs-heap'], position: 2},
  {key: 'moves', title: 'Moves', summary: 'Assignment moves ownership', prereqs: ['ownership'], position: 3},
  {key: 'borrowing', title: 'Borrowing', summary: 'References without taking ownership', prereqs: ['ownership'], position: 4},
];

export function ownershipLesson(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Ownership: who frees the memory',
    objectives: ['Explain why Rust needs no garbage collector', 'Predict where a value is dropped'],
    estimated_minutes: 4,
    rationale: 'Stack and heap are solid. Ownership is next, and the rest of the language leans on it.',
    sources: [{title: 'The Rust Book, ch. 4.1', url: 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html'}],
    concepts: [{key: 'ownership', role: 'new'}],
    blocks: [
      {type: 'markdown', approach: 'explanation', concepts: ['ownership'], body: {md: 'Every value has exactly one **owner**. When the owner goes out of scope, the value is dropped.'}},
      {type: 'code', approach: 'worked_example', concepts: ['ownership'], body: {lang: 'rust', source: 'let s1 = String::from("hi");\nlet s2 = s1;\nprintln!("{}", s2);', output: 'hi'}},
      {type: 'question', approach: 'retrieval', concepts: ['ownership'], body: {ref: 'q1'}},
      {type: 'callout', approach: 'misconception', concepts: ['ownership'], body: {kind: 'pitfall', md: '`let s2 = s1` does not copy the heap data.'}},
    ],
    questions: [
      {
        ref: 'q1',
        type: 'multiple_choice',
        aim: 'understand',
        difficulty: 2,
        concepts: ['ownership'],
        prompt: 'After `let s2 = s1;`, what happens if you use `s1`?',
        body: {
          choices: [
            {id: 'a', md: 'It compiles; both point to the same buffer', misconception: 'move-is-shallow-copy', why: 'That would mean two owners, and a double free.'},
            {id: 'b', md: 'A compile error: `s1` was moved'},
            {id: 'c', md: 'It compiles; `s1` is a deep copy', misconception: 'move-is-deep-copy', why: 'Deep copies need `.clone()`.'},
          ],
          answer: 'b',
        },
        explanation: 'Assignment moves ownership; only one owner may free the buffer.',
        hints: ['How many owners can a value have?'],
      },
    ],
    ...overrides,
  };
}

/** Add the Rust subject with its syllabus. Returns its id. */
export async function rustSubject(lc: Instance, extra: string[] = []): Promise<string> {
  const added = await lc.j(['subject', 'add', 'Rust ownership', '--goal', 'read and change Rust services', '--minutes', '15', ...extra]);
  if (added.code !== 0) throw new Error(`subject add failed: ${added.stdout}`);
  const id = added.json.subject.id as string;
  const upsert = await lc.j(['concepts', 'upsert', id, '--file', lc.file('concepts.json', RUST_CONCEPTS)], {as: 'agent:tutor'});
  if (upsert.code !== 0) throw new Error(`concepts upsert failed: ${upsert.stdout}`);
  return id;
}

export async function startRun(lc: Instance): Promise<string> {
  const started = await lc.j(['run', 'start'], {as: 'agent:tutor'});
  if (started.code !== 0) throw new Error(`run start failed: ${started.stdout}`);
  return started.json.run.id as string;
}

export async function submitLesson(lc: Instance, subject: string, run: string, lesson: unknown = ownershipLesson()) {
  return lc.j(['lesson', 'submit', subject, '--day', lc.ctx().today(), '--run', run, '--file', lc.file('lesson.json', lesson)], {as: 'agent:tutor'});
}

/** Today's quiz on the ownership lesson: a new question of each kind, plus a review of the inline check. */
export function ownershipQuiz(lessonId: string, inlineQuestionId?: string) {
  const items: unknown[] = [
    {
      role: 'new',
      question: {
        type: 'short_text',
        aim: 'recall',
        difficulty: 1,
        concepts: ['ownership'],
        prompt: 'What is the variable responsible for freeing a value called?',
        body: {accept: ['owner', 'the owner']},
        explanation: 'The owner frees the value when it goes out of scope.',
        hints: ['It "owns" it.'],
      },
    },
    {
      role: 'new',
      question: {
        type: 'multiple_choice',
        aim: 'apply',
        difficulty: 3,
        concepts: ['ownership'],
        prompt: 'When is a `String` freed?',
        body: {
          choices: [
            {id: 'gc', md: 'When the garbage collector runs', misconception: 'rust-has-gc', why: 'Rust has no garbage collector.'},
            {id: 'scope', md: 'When its owner goes out of scope'},
            {id: 'never', md: 'Never; you call free()', misconception: 'manual-free', why: 'Drop is automatic.'},
          ],
          answer: 'scope',
          shuffle: false,
        },
        explanation: 'Values are dropped when their owner goes out of scope.',
      },
    },
    {
      role: 'new',
      question: {
        type: 'free_response',
        aim: 'transfer',
        difficulty: 4,
        concepts: ['ownership'],
        prompt: 'Why can Rust free memory without a garbage collector?',
        body: {model_answer: 'Because each value has exactly one owner, the compiler knows where to drop it.', rubric: ['one owner', 'drop at end of scope']},
        explanation: 'Single ownership makes the drop point static.',
      },
    },
  ];
  if (inlineQuestionId !== undefined) items.push({role: 'review', existing: inlineQuestionId});
  return {lesson: lessonId, rationale: 'Ownership is new today.', items};
}

export async function submitQuiz(lc: Instance, subject: string, run: string, quiz: unknown, kind = 'daily') {
  return lc.j(['quiz', 'submit', subject, '--day', lc.ctx().today(), '--run', run, '--kind', kind, '--file', lc.file('quiz.json', quiz)], {as: 'agent:tutor'});
}

/** Answer through the API as the learner, the way the web app does. */
export async function answerQ(lc: Instance, body: Record<string, unknown>) {
  const response = await fetch(`${lc.url}/api/attempts`, {
    method: 'POST',
    headers: {authorization: `Bearer ${lc.token('you')}`, 'content-type': 'application/json'},
    body: JSON.stringify({confidence: 'sure', seconds: 12, ...body}),
  });
  return (await response.json()) as any;
}
