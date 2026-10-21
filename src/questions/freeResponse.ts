/**
 * A free response: the learner writes an answer, sees the model answer and rubric, and
 * grades themselves (got it 1 · partly 0.5 · missed 0). The tutor re-grades it next run;
 * both grades are kept.
 */
import {Node, result} from '../core/validate.ts';
import {graded, type QuestionType} from './types.ts';

export interface FreeResponseBody {
  model_answer: string;
  rubric: string[];
}

export const SELF_GRADES = {got_it: 1, partly: 0.5, missed: 0} as const;

export const freeResponse: QuestionType<FreeResponseBody, string> = {
  type: 'free_response',
  milestone: 'M2',
  gradedBy: 'self',
  disputable: false,
  shape: '{model_answer: "markdown", rubric: ["a point a good answer makes", …]}',
  answerShape: '"<text>"',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['model_answer', 'rubric']);
    const model = node.get('model_answer').string({max: 4000});
    const rubric = node.get('rubric').stringArray({min: 1, max: 8, item: {max: 500}});
    return result(node.issues, o && model !== undefined && rubric ? {model_answer: model, rubric} : undefined);
  },
  learnerBody: () => ({}),
  reveal: body => ({model_answer: body.model_answer, rubric: body.rubric}),
  orderIds: () => null,
  readAnswer(answer, _body, path) {
    const node = Node.root(answer, path);
    return result(node.issues, node.string({max: 8000}));
  },
  grade: () => graded(null),
  plainText: () => '  (write your answer, then grade it against the model answer)',
  answerText: body => `${body.model_answer}\n  rubric: ${body.rubric.join('; ')}`,
};
