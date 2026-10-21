import {Node, result} from '../core/validate.ts';
import {readingSeconds, type BlockType} from './types.ts';

export interface CodeBody {
  lang: string;
  source: string;
  caption: string | null;
  output: string | null;
}

/** About four seconds to read a line of code. */
const SECONDS_PER_LINE = 4;

export const codeBlock: BlockType<CodeBody> = {
  type: 'code',
  milestone: 'M1',
  shape: '{lang, source, caption?, output?}',
  renders: 'highlighted code, with the expected output beneath',
  validate(body, ctx) {
    const node = Node.root(body, ctx.path);
    const o = node.object(['lang', 'source', 'caption', 'output']);
    const lang = node.get('lang').string({max: 24, pattern: /^[a-z0-9][a-z0-9+#._-]*$/i, patternMessage: 'must be a language name like rust, python or text'});
    const source = node.get('source').string();
    const caption = node.get('caption').optionalString({max: 500});
    const output = node.get('output').optionalString();
    return result(node.issues, o && lang && source !== undefined ? {lang: lang.toLowerCase(), source, caption: caption ?? null, output: output ?? null} : undefined);
  },
  plainText(body) {
    const lines = [...(body.caption === null ? [] : [body.caption]), '```' + body.lang, body.source.replace(/\n$/, ''), '```'];
    if (body.output !== null) lines.push('output:', body.output.replace(/\n$/, ''));
    return lines.join('\n');
  },
  estimateSeconds: body =>
    body.source.split('\n').filter(line => line.trim() !== '').length * SECONDS_PER_LINE +
    readingSeconds(body.caption ?? '') +
    (body.output === null ? 0 : body.output.split('\n').length * 2),
  tracks: ['seen'],
};
