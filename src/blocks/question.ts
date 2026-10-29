import {Node, result} from '../core/validate.ts';
import {diagramElements} from './diagram.ts';
import type {Figure} from './picture.ts';
import {SECONDS_PER_LABEL, SECONDS_TO_LOOK, type BlockType} from './types.ts';

/**
 * An inline check. In a submission the body names a question defined alongside the
 * lesson (`{"ref": "q1"}`); once stored it also carries the question's id.
 */
export interface QuestionBlockBody {
  ref: string;
  question_id?: string;
}

/** About 45 seconds to answer a question. */
export const SECONDS_PER_QUESTION = 45;

/** A widget question is worked, not just answered (M22). */
export const SECONDS_PER_WIDGET_QUESTION = 75;

/** A question's time: about 45 s to answer (a widget's, 75), and a look at the picture it asks about (M19). */
export function questionSeconds(question: {type?: string; figure: Figure | null}, assetLabels: ReadonlyMap<string, number>): number {
  const base = question.type === 'widget' ? SECONDS_PER_WIDGET_QUESTION : SECONDS_PER_QUESTION;
  const figure = question.figure;
  if (figure === null) return base;
  const parts = 'asset' in figure ? (assetLabels.get(figure.asset) ?? 0) : diagramElements(figure.mermaid);
  return base + SECONDS_TO_LOOK + parts * SECONDS_PER_LABEL;
}

export const questionBlock: BlockType<QuestionBlockBody> = {
  type: 'question',
  milestone: 'M2',
  shape: '{ref}: a question defined in the same submission',
  renders: 'an inline check, answered in place',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['ref']);
    const ref = node.get('ref').string({max: 64});
    if (ref !== undefined && !ctx.questionRefs.has(ref)) {
      node.get('ref').fail(`no question with ref "${ref}" in this submission's "questions"`);
    }
    return result(node.issues, o && ref !== undefined ? {ref} : undefined);
  },
  plainText: body => `[Check: ${body.ref}]`,
  estimateSeconds: (body, ctx) => ctx.questionSeconds?.get(body.ref) ?? SECONDS_PER_QUESTION,
  timed: `${SECONDS_PER_QUESTION} s, and a look at its figure as for a picture`,
  tracks: ['seen'],
};
