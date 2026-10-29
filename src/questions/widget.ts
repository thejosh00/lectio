/**
 * A widget question (M22): the learner does something in a widget — sets the threshold, routes
 * the request, places the kernel — and the widget scores it, `lectio.answer({value, score})`.
 * It runs in the same sandbox as a widget block (src/core/widget.ts), served from
 * `/w/q/<question-id>`. The app trusts the score the widget reports, as it trusts the key the
 * tutor wrote for any other question; it counts for memory like any other.
 */
import {WIDGET_LIB_NAMES, type WidgetLib} from '../core/widget.ts';
import {Node, result} from '../core/validate.ts';
import {graded, type QuestionType} from './types.ts';

export interface WidgetQuestionBody {
  html: string;
  libs: WidgetLib[];
  height: number;
  alt: string;
}

export interface WidgetAnswer {
  /** What the learner did, as the widget describes it: shown back to them, and to the tutor. */
  value: unknown;
  score: number;
}

/** Room for the widget's own description of what the learner did. */
export const WIDGET_ANSWER_MAX = 2000;
/** The question's HTML; a block widget's size is a setting, a question's is fixed. */
export const WIDGET_QUESTION_MAX = 300_000;

export const widgetQuestion: QuestionType<WidgetQuestionBody, WidgetAnswer> = {
  type: 'widget',
  milestone: 'M22',
  gradedBy: 'widget',
  disputable: false,
  shape: `{html, libs?: [${WIDGET_LIB_NAMES.join('|')}], height (120–900), alt}: the widget calls lectio.answer({value, score}) when the learner commits, score 0–1`,
  answerShape: '{"value": <what they did>, "score": 0–1} — sent by the widget',
  validate(body, path) {
    const node = Node.root(body, path);
    const o = node.object(['html', 'libs', 'height', 'alt']);
    const html = node.get('html').string({max: WIDGET_QUESTION_MAX});
    const libs: WidgetLib[] = [];
    for (const lib of node.get('libs').optionalArray({max: WIDGET_LIB_NAMES.length})) {
      const name = lib.oneOf(WIDGET_LIB_NAMES);
      if (name !== undefined && !libs.includes(name)) libs.push(name);
    }
    const height = node.get('height').number({integer: true, min: 120, max: 900});
    const alt = node.get('alt').string({max: 2000});
    if (html !== undefined && !/lectio\.answer\s*\(/.test(html)) node.get('html').fail('never calls lectio.answer({value, score}), so the learner could never answer it');
    return result(node.issues, o && html !== undefined && height !== undefined && alt !== undefined ? {html, libs, height, alt} : undefined);
  },
  // The widget is served on its own; the page needs only how big it is and what it shows.
  learnerBody: body => ({height: body.height, alt: body.alt}),
  reveal: () => ({}),
  orderIds: () => null,
  readAnswer(answer, _body, path) {
    const node = Node.root(answer, path);
    const o = node.object(['value', 'score']);
    const score = node.get('score').number({min: 0, max: 1});
    const value = node.get('value').value;
    if (JSON.stringify(value ?? null).length > WIDGET_ANSWER_MAX) node.get('value').fail(`is more than ${WIDGET_ANSWER_MAX} characters as JSON`);
    return result(node.issues, o && score !== undefined ? {value: value ?? null, score} : undefined);
  },
  grade: (_body, answer) => graded(answer.score),
  plainText: () => '  (a widget: open it in the web app)',
  answerText: () => 'the widget checks it',
};
