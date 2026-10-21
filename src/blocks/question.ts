import {Node, result} from '../core/validate.ts';
import type {BlockType} from './types.ts';

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
  estimateSeconds: () => SECONDS_PER_QUESTION,
  tracks: ['seen'],
};
