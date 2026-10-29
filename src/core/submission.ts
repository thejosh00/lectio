/**
 * Validating what the tutor submits: a lesson (blocks plus the questions they use), a
 * quiz, a question on its own, a concepts list. All or nothing: every problem is
 * collected with its JSON path, so one refusal lists everything to fix.
 *
 * Pure. What the database knows (concept keys and statuses, assets, existing questions)
 * comes in as a `SubjectFacts`.
 */
import {APPROACH_PATTERN, blockType, blockTypeNames, PLANNED_BLOCK_TYPES} from '../blocks/index.ts';
import {readFigure, type Figure} from '../blocks/picture.ts';
import {questionSeconds} from '../blocks/question.ts';
import {questionType, questionTypeNames, PLANNED_QUESTION_TYPES} from '../questions/index.ts';
import {AIMS, CONCEPT_ROLES, DAILY_ROLES, type Aim, type ConceptRole, type ConceptStatus, type ItemRole, type QuizKind} from './types.ts';
import {Node, SLUG, byteLength, formatIssue, type Issue} from './validate.ts';

export interface SubjectFacts {
  /** key → status, for every concept in the subject. */
  concepts: ReadonlyMap<string, ConceptStatus>;
  assets: ReadonlySet<string>;
  /** Asset id → its labels, for a picture's time estimate; an asset not here has none. */
  assetLabels?: ReadonlyMap<string, number>;
  /** Mermaid sources checked before validation (`src/server/diagrams.ts`): source → error, or null. */
  diagrams?: ReadonlyMap<string, string | null>;
  limits: {lesson_max_blocks: number; lesson_max_bytes: number; widget_max_bytes: number; quiz_max_questions: number};
}

export class Invalid extends Error {
  constructor(
    readonly what: string,
    readonly issues: Issue[],
  ) {
    super(`the ${what} has ${issues.length === 1 ? 'a problem' : `${issues.length} problems`}: ${issues.map(formatIssue).join('; ')}`);
  }
}

// --- questions ---------------------------------------------------------------------

export interface QuestionInput {
  ref: string | null;
  type: string;
  aim: Aim;
  difficulty: number;
  concepts: string[];
  prompt: string;
  body: Record<string, unknown>;
  explanation: string;
  hints: string[];
  variant_of: string | null;
  /** A picture asked about, shown with the prompt (M19). */
  figure: Figure | null;
  /** A picture shown with the answer: the labelled diagram, the model sketch. */
  answer_figure: Figure | null;
}

const QUESTION_FIELDS = ['ref', 'type', 'aim', 'difficulty', 'concepts', 'prompt', 'figure', 'body', 'explanation', 'answer_figure', 'hints', 'variant_of'];

function conceptList(node: Node, facts: SubjectFacts, min: number): string[] {
  if (min === 0 && !node.present) return [];
  const keys: string[] = [];
  for (const item of node.array({min, max: 20}) ?? []) {
    const key = item.string({max: 64});
    if (key === undefined) continue;
    const status = facts.concepts.get(key);
    if (status === undefined) item.fail(`no concept "${key}" in this subject; upsert it first`);
    else if (status === 'retired') item.fail(`concept "${key}" is retired`);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** One question, as submitted with a lesson, in a quiz item, or to `question fix`. */
export function readQuestion(node: Node, facts: SubjectFacts, options: {needsRef: boolean}): QuestionInput | undefined {
  const o = node.object(QUESTION_FIELDS);
  if (o === undefined) return undefined;
  const ref = options.needsRef ? node.get('ref').string({max: 64, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: 'must be a short id like q1'}) : node.get('ref').optionalString({max: 64});
  const typeNode = node.get('type');
  const typeName = typeNode.string({max: 32});
  const type = typeName === undefined ? undefined : questionType(typeName);
  if (typeName !== undefined && type === undefined) {
    const planned = PLANNED_QUESTION_TYPES[typeName];
    typeNode.fail(planned === undefined ? `unknown question type "${typeName}"; one of ${questionTypeNames().join(', ')}` : `"${typeName}" questions arrive in ${planned}; not available yet`);
  }
  const aim = node.get('aim').oneOf(AIMS);
  const difficulty = node.get('difficulty').number({integer: true, min: 1, max: 5});
  const concepts = conceptList(node.get('concepts'), facts, 1);
  const prompt = node.get('prompt').string({max: 4000});
  const explanation = node.get('explanation').string({max: 4000});
  const hints = node.get('hints').present ? (node.get('hints').stringArray({max: 5, item: {max: 1000}}) ?? []) : [];
  const variantOf = node.get('variant_of').optionalString({max: 40});
  const pictures = {assets: facts.assets, diagrams: facts.diagrams ?? new Map()};
  const figure = node.get('figure').present ? readFigure(node.get('figure'), pictures) : null;
  const answerFigure = node.get('answer_figure').present ? readFigure(node.get('answer_figure'), pictures) : null;
  let body: Record<string, unknown> | undefined;
  if (type !== undefined) {
    const checked = type.validate(node.get('body').value, `${node.path === '' ? '' : `${node.path}.`}body`);
    if (checked.ok) body = checked.value as Record<string, unknown>;
    else node.issues.push(...checked.issues);
  }
  if (typeName === undefined || type === undefined || aim === undefined || difficulty === undefined || prompt === undefined || explanation === undefined || body === undefined) return undefined;
  if (options.needsRef && ref === undefined) return undefined;
  if (figure === undefined || answerFigure === undefined) return undefined;
  return {ref: ref ?? null, type: typeName, aim, difficulty, concepts, prompt, body, explanation, hints, variant_of: variantOf?.trim() || null, figure, answer_figure: answerFigure};
}

// --- lessons -----------------------------------------------------------------------

export interface BlockInput {
  type: string;
  approach: string;
  concepts: string[];
  body: Record<string, unknown>;
  estimate_seconds: number;
  /** In a two-arm lesson: the arm it belongs to; null when every learner sees it. */
  arm: 'a' | 'b' | null;
}

/** A two-arm lesson's experiment (M14): what is being compared, by name, and how each arm teaches. */
export interface ExperimentInput {
  name: string;
  arms: {a: string; b: string};
}

export interface LessonInput {
  title: string;
  objectives: string[];
  estimated_minutes: number;
  rationale: string;
  hypothesis: string | null;
  sources: Array<{title: string; url: string}>;
  concepts: Array<{key: string; role: ConceptRole}>;
  blocks: BlockInput[];
  questions: QuestionInput[];
  /** The blocks' own estimates added up — the shared blocks and the longer arm. */
  estimate_seconds: number;
  experiment: ExperimentInput | null;
}

const LESSON_FIELDS = ['title', 'objectives', 'estimated_minutes', 'rationale', 'hypothesis', 'sources', 'concepts', 'blocks', 'questions', 'experiment'];

/** What a learner reads of a two-arm lesson: the shared blocks and one arm. Only the longer arm counts toward the time. */
export function armEstimates(blocks: readonly Pick<BlockInput, 'arm' | 'estimate_seconds'>[]): {shared: number; a: number; b: number} {
  const sum = (arm: 'a' | 'b' | null) => blocks.filter(b => b.arm === arm).reduce((total, b) => total + b.estimate_seconds, 0);
  return {shared: sum(null), a: sum('a'), b: sum('b')};
}

export function readSources(node: Node): Array<{title: string; url: string}> {
  const out: Array<{title: string; url: string}> = [];
  for (const item of node.optionalArray({max: 30})) {
    item.object(['title', 'url']);
    const title = item.get('title').string({max: 300});
    const url = item.get('url').string({max: 2000, pattern: /^https?:\/\/\S+$/, patternMessage: 'must be an http(s) URL'});
    if (title !== undefined && url !== undefined) out.push({title, url});
  }
  return out;
}

export function readBlock(node: Node, facts: SubjectFacts, questionRefs: ReadonlySet<string>, options: {arms?: boolean; questionSeconds?: ReadonlyMap<string, number>} = {}): BlockInput | undefined {
  const o = node.object(options.arms === true ? ['type', 'approach', 'concepts', 'body', 'arm'] : ['type', 'approach', 'concepts', 'body']);
  if (o === undefined) return undefined;
  const arm = node.get('arm').present ? (node.get('arm').oneOf(['a', 'b'] as const) ?? null) : null;
  const typeNode = node.get('type');
  const typeName = typeNode.string({max: 32});
  const type = typeName === undefined ? undefined : blockType(typeName);
  if (typeName !== undefined && type === undefined) {
    const planned = PLANNED_BLOCK_TYPES[typeName];
    typeNode.fail(planned === undefined ? `unknown block type "${typeName}"; one of ${blockTypeNames().join(', ')}` : `"${typeName}" blocks arrive in ${planned}; not available yet`);
  }
  const approach = node.get('approach').string({max: 32, pattern: APPROACH_PATTERN, patternMessage: 'must be a lowercase slug of at most 32 characters, e.g. worked_example'});
  const concepts = conceptList(node.get('concepts'), facts, 0);
  if (type === undefined) return undefined;
  const checked = type.validate(node.get('body').value, {
    path: `${node.path}.body`,
    conceptKeys: new Set(facts.concepts.keys()),
    assets: facts.assets,
    questionRefs,
    diagrams: facts.diagrams ?? new Map(),
    limits: {widget_max_bytes: facts.limits.widget_max_bytes},
  });
  if (!checked.ok) {
    node.issues.push(...checked.issues);
    return undefined;
  }
  if (approach === undefined) return undefined;
  if (arm !== null && type.type === 'question') {
    node.get('arm').fail('an inline check is shared by both arms: a check in one arm only would be extra practice for that arm');
    return undefined;
  }
  return {type: type.type, approach, concepts, body: checked.value as Record<string, unknown>, estimate_seconds: type.estimateSeconds(checked.value, {assetLabels: facts.assetLabels ?? new Map(), ...(options.questionSeconds === undefined ? {} : {questionSeconds: options.questionSeconds})}), arm};
}

/** A whole lesson submission. `raw` is the JSON as sent, for the size limit. */
export function readLesson(value: unknown, facts: SubjectFacts, raw?: string): LessonInput {
  const node = Node.root(value);
  const size = byteLength(raw ?? JSON.stringify(value ?? null));
  if (size > facts.limits.lesson_max_bytes) node.fail(`the lesson is ${size} bytes; the most is ${facts.limits.lesson_max_bytes} (lesson_max_bytes)`);
  const o = node.object(LESSON_FIELDS);
  if (o === undefined) throw new Invalid('lesson', node.issues);

  const title = node.get('title').string({max: 200});
  const objectives = node.get('objectives').stringArray({min: 1, max: 8, item: {max: 300}});
  const minutes = node.get('estimated_minutes').number({integer: true, min: 1, max: 240});
  const rationale = node.get('rationale').string({max: 2000});
  const hypothesis = node.get('hypothesis').optionalString({max: 1000});
  const sources = readSources(node.get('sources'));

  const concepts: Array<{key: string; role: ConceptRole}> = [];
  const conceptsNode = node.get('concepts');
  const seenConcepts = new Set<string>();
  for (const item of conceptsNode.present ? (conceptsNode.array({max: 20}) ?? []) : []) {
    item.object(['key', 'role']);
    const key = item.get('key').string({max: 64});
    const role = item.get('role').oneOf(CONCEPT_ROLES);
    if (key === undefined || role === undefined) continue;
    const status = facts.concepts.get(key);
    if (status === undefined) item.get('key').fail(`no concept "${key}" in this subject; upsert it first`);
    else if (status === 'retired') item.get('key').fail(`concept "${key}" is retired`);
    else if (role === 'new' && status === 'introduced') item.get('role').fail(`"${key}" is already introduced; use deepen or review`);
    else if (role !== 'new' && status === 'planned') item.get('role').fail(`"${key}" hasn't been introduced yet, so it can only be new here`);
    if (seenConcepts.has(key)) item.get('key').fail(`"${key}" is listed twice`);
    seenConcepts.add(key);
    concepts.push({key, role});
  }

  const questionNodes = node.get('questions').optionalArray({max: 40});
  const questions: QuestionInput[] = [];
  const refs = new Set<string>();
  const refAt: Array<string | undefined> = [];
  for (const q of questionNodes) {
    const question = readQuestion(q, facts, {needsRef: true});
    // Known even when the rest of the question is wrong, so its block doesn't complain too.
    const ref = typeof q.get('ref').value === 'string' ? (q.get('ref').value as string) : undefined;
    refAt.push(ref);
    if (ref !== undefined && refs.has(ref)) q.get('ref').fail(`"${ref}" is used by more than one question`);
    if (ref !== undefined) refs.add(ref);
    if (question === undefined) continue;
    if (question.variant_of !== null) q.get('variant_of').fail('lesson questions are new; variants belong in a quiz');
    questions.push(question);
  }

  const secondsOf = new Map(questions.map(q => [q.ref!, questionSeconds(q, facts.assetLabels ?? new Map())]));
  const experiment = readExperiment(node.get('experiment'));
  const blockNodes = node.get('blocks').array({min: 1, max: facts.limits.lesson_max_blocks}) ?? [];
  const blocks: BlockInput[] = [];
  const usedRefs = new Set<string>();
  for (const b of blockNodes) {
    const block = readBlock(b, facts, refs, {arms: true, questionSeconds: secondsOf});
    if (block !== undefined && block.arm !== null && !node.get('experiment').present) b.get('arm').fail('arms belong to an experiment: name it in "experiment"');
    if (block === undefined) continue;
    if (block.type === 'question') {
      const ref = String(block.body['ref']);
      if (usedRefs.has(ref)) b.get('body').get('ref').fail(`question "${ref}" is used by more than one block`);
      usedRefs.add(ref);
    }
    blocks.push(block);
  }
  questionNodes.forEach((q, i) => {
    const ref = refAt[i];
    if (ref !== undefined && blockNodes.length > 0 && blocks.length === blockNodes.length && !usedRefs.has(ref)) q.get('ref').fail(`"${ref}" isn't used by any question block; put it in a block, or in the quiz instead`);
  });

  if (experiment !== undefined && blocks.length === blockNodes.length) {
    const concepts = (arm: 'a' | 'b') => [...new Set(blocks.filter(b => b.arm === arm).flatMap(b => b.concepts))].sort();
    for (const arm of ['a', 'b'] as const) if (!blocks.some(b => b.arm === arm)) node.get('blocks').fail(`arm ${arm} has no blocks: tag at least one block "arm": "${arm}"`);
    if (concepts('a').join(',') !== concepts('b').join(',')) {
      node.get('blocks').fail(`the arms teach different concepts (a: ${concepts('a').join(', ') || 'none'}; b: ${concepts('b').join(', ') || 'none'}): an experiment compares two ways of teaching the same ideas`);
    }
  }
  if (node.issues.length > 0) throw new Invalid('lesson', node.issues);
  const estimates = armEstimates(blocks);
  return {
    title: title!,
    objectives: objectives!,
    estimated_minutes: minutes!,
    rationale: rationale!,
    hypothesis: hypothesis?.trim() || null,
    sources,
    concepts,
    blocks,
    questions,
    estimate_seconds: estimates.shared + Math.max(estimates.a, estimates.b),
    experiment: experiment ?? null,
  };
}

/** `experiment: {name, arms: {a, b}}`: a slug naming what is compared, and a line on how each arm teaches. */
function readExperiment(node: Node): ExperimentInput | undefined {
  if (!node.present) return undefined;
  if (node.object(['name', 'arms']) === undefined) return undefined;
  const name = node.get('name').string({max: 32, pattern: APPROACH_PATTERN, patternMessage: 'must be a lowercase slug of at most 32 characters, e.g. worked_vs_problem_first'});
  const arms = node.get('arms');
  if (arms.object(['a', 'b']) === undefined) return undefined;
  const a = arms.get('a').string({max: 300});
  const b = arms.get('b').string({max: 300});
  return name === undefined || a === undefined || b === undefined ? undefined : {name, arms: {a, b}};
}

// --- quizzes -----------------------------------------------------------------------

/** `predicted`: the tutor's probability that the first try scores 1, or null if it gave none. */
export type QuizItemInput = ({role: ItemRole; question: QuestionInput; existing?: undefined} | {role: ItemRole; existing: string; question?: undefined}) & {predicted: number | null};

export interface QuizInput {
  lesson: string | null;
  rationale: string;
  items: QuizItemInput[];
}

export function readQuiz(value: unknown, facts: SubjectFacts, kind: QuizKind): QuizInput {
  const node = Node.root(value);
  const o = node.object(['lesson', 'rationale', 'items']);
  if (o === undefined) throw new Invalid('quiz', node.issues);
  const lesson = node.get('lesson').optionalString({max: 40});
  const rationale = node.get('rationale').optionalString({max: 2000}) ?? '';
  const itemNodes = node.get('items').array({min: 1, max: facts.limits.quiz_max_questions}) ?? [];
  const items: QuizItemInput[] = [];
  for (const item of itemNodes) {
    item.object(['role', 'question', 'existing', 'predict']);
    const role = item.get('role').oneOf(kind === 'placement' ? (['probe'] as const) : DAILY_ROLES);
    let predicted: number | null = null;
    if (kind === 'placement' && item.get('predict').present) item.get('predict').fail('probes are never scored, so there is nothing to predict');
    else predicted = item.get('predict').optionalNumber({min: 0, max: 1}) ?? null;
    const hasQuestion = item.get('question').present;
    const hasExisting = item.get('existing').present;
    if (hasQuestion === hasExisting) {
      item.fail('give either "question" (a new one) or "existing" (a question id), not both');
      continue;
    }
    if (hasExisting) {
      const existing = item.get('existing').string({max: 40});
      if (role !== undefined && existing !== undefined) items.push({role, existing, predicted});
    } else {
      const question = readQuestion(item.get('question'), facts, {needsRef: false});
      if (role !== undefined && question !== undefined) items.push({role, question, predicted});
    }
  }
  if (items.some(i => i.role === 'new') && (lesson === undefined || lesson.trim() === '')) node.get('lesson').fail('"new" items are on today\'s lesson: name it');
  if (node.issues.length > 0) throw new Invalid('quiz', node.issues);
  return {lesson: lesson?.trim() || null, rationale, items};
}

// --- checkups (M12) ------------------------------------------------------------------

export interface ExamInput {
  rationale: string;
  questions: QuestionInput[];
}

/**
 * What a checkup question can't be: graded by the learner (a checkup is measured by the
 * app), helped by hints, or a variant of another question. Used for a submission and for
 * the examiner's fixes alike.
 */
export function examQuestionProblems(question: QuestionInput, node: Node): void {
  if (questionType(question.type)?.gradedBy !== 'app') node.get('type').fail('a checkup is graded by the app: free responses and widgets belong in the tutor\'s quizzes');
  if (question.hints.length > 0) node.get('hints').fail('a checkup gives no hints');
  if (question.variant_of !== null) node.get('variant_of').fail('checkup questions are new, never variants');
}

/**
 * A checkup: `{rationale?, items: [{question}]}`. Every concept the app drew for it (`plan`,
 * by key) is asked about, and nothing else.
 */
export function readExam(value: unknown, facts: SubjectFacts, plan: readonly string[], max: number): ExamInput {
  const node = Node.root(value);
  const o = node.object(['rationale', 'items']);
  if (o === undefined) throw new Invalid('checkup', node.issues);
  const rationale = node.get('rationale').optionalString({max: 2000}) ?? '';
  const itemNodes = node.get('items').array({min: 1, max}) ?? [];
  const questions: QuestionInput[] = [];
  const covered = new Set<string>();
  for (const item of itemNodes) {
    if (item.object(['question']) === undefined) continue;
    const q = item.get('question');
    const question = readQuestion(q, facts, {needsRef: false});
    if (question === undefined) continue;
    examQuestionProblems(question, q);
    for (const key of question.concepts) {
      if (!plan.includes(key)) q.get('concepts').fail(`"${key}" isn't in this checkup; ask only about ${plan.join(', ')}`);
      covered.add(key);
    }
    questions.push(question);
  }
  const missing = plan.filter(key => !covered.has(key));
  if (itemNodes.length > 0 && missing.length > 0) node.get('items').fail(`nothing asks about ${missing.map(k => `"${k}"`).join(', ')}; every concept in the checkup needs a question`);
  if (node.issues.length > 0) throw new Invalid('checkup', node.issues);
  return {rationale, questions};
}

// --- concepts ----------------------------------------------------------------------

export interface ConceptInput {
  key: string;
  title: string;
  summary: string | undefined;
  prereqs: string[] | undefined;
  position: number | undefined;
  status: 'planned' | 'known' | 'retired' | undefined;
}

export const CONCEPT_KEY = SLUG;

/**
 * A concepts upsert. `existing` is the subject's current key → prereqs, for checking
 * that prerequisites exist and don't form a cycle.
 */
export function readConcepts(value: unknown, existing: ReadonlyMap<string, readonly string[]>): ConceptInput[] {
  const node = Node.root(value);
  const items = node.array({min: 1, max: 200});
  if (items === undefined) throw new Invalid('concepts list', node.issues);
  const out: ConceptInput[] = [];
  const keys = new Set<string>();
  for (const item of items) {
    item.object(['key', 'title', 'summary', 'prereqs', 'position', 'status']);
    const key = item.get('key').string({max: 64, pattern: CONCEPT_KEY, patternMessage: 'must be a lowercase slug like borrow-rules'});
    const title = item.get('title').string({max: 200});
    const summary = item.get('summary').optionalString({max: 1000});
    const prereqs = item.get('prereqs').present ? item.get('prereqs').stringArray({max: 20}) : undefined;
    const position = item.get('position').optionalNumber({integer: true, min: 0, max: 100_000});
    const status = item.get('status').present ? item.get('status').oneOf(['planned', 'known', 'retired'] as const) : undefined;
    if (key !== undefined && keys.has(key)) item.get('key').fail(`"${key}" is listed twice`);
    if (key !== undefined) keys.add(key);
    if (key !== undefined && title !== undefined) out.push({key, title, summary, prereqs, position, status});
  }
  // Prerequisites must exist (here or already) and must not form a cycle.
  const graph = new Map<string, readonly string[]>(existing);
  for (const c of out) graph.set(c.key, c.prereqs ?? existing.get(c.key) ?? []);
  out.forEach((c, i) => {
    for (const p of c.prereqs ?? []) {
      if (p === c.key) items[i]!.get('prereqs').fail(`"${c.key}" can't be its own prerequisite`);
      else if (!graph.has(p)) items[i]!.get('prereqs').fail(`no concept "${p}"; add it in this list or earlier`);
    }
  });
  const cycle = findCycle(graph);
  if (cycle !== undefined) node.fail(`prerequisites form a cycle: ${cycle.join(' → ')}`);
  if (node.issues.length > 0) throw new Invalid('concepts list', node.issues);
  return out;
}

export function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (key: string): string[] | undefined => {
    if (state.get(key) === 'done') return undefined;
    if (state.get(key) === 'visiting') return [...stack.slice(stack.indexOf(key)), key];
    state.set(key, 'visiting');
    stack.push(key);
    for (const p of graph.get(key) ?? []) {
      if (!graph.has(p) || p === key) continue;
      const found = visit(p);
      if (found !== undefined) return found;
    }
    stack.pop();
    state.set(key, 'done');
    return undefined;
  };
  for (const key of graph.keys()) {
    const found = visit(key);
    if (found !== undefined) return found;
  }
  return undefined;
}
