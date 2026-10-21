/**
 * Lesson text: markdown with `$…$` / `$$…$$` math and highlighted fenced code.
 *
 * Raw HTML is disabled: the text is the tutor's, and it must not inject markup. What
 * reaches the page is markdown-it's escaped output plus KaTeX's and highlight.js's,
 * which escape their input too. KaTeX's stylesheet (and its fonts) load only once a
 * page actually shows math.
 */
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import MarkdownIt, {type StateBlock, type StateInline} from 'markdown-it';
import {useMemo} from 'react';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {displayMode, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml'});
}

export function highlight(code: string, lang: string): string {
  const language = lang.toLowerCase();
  if (language !== '' && hljs.getLanguage(language) !== undefined) return hljs.highlight(code, {language, ignoreIllegals: true}).value;
  return escapeHtml(code);
}

/** `$…$` inline (not `$5 and $10`), and `$$…$$` on one line. */
function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== '$') return false;
  const display = src[start + 1] === '$';
  const open = display ? 2 : 1;
  const close = display ? '$$' : '$';
  let end = start + open;
  for (;;) {
    end = src.indexOf(close, end);
    if (end === -1) return false;
    if (src[end - 1] !== '\\') break;
    end += 1;
  }
  const content = src.slice(start + open, end);
  if (content.trim() === '') return false;
  if (!display && (/^\s|\s$/.test(content) || /\d/.test(src[end + 1] ?? ''))) return false;
  if (!silent) {
    const token = state.push(display ? 'math_display' : 'math_inline', 'math', 0);
    token.content = content;
  }
  state.pos = end + close.length;
  return true;
}

/** A `$$` line, the formula, and a closing `$$` line. */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const first = state.src.slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]).trim();
  if (!first.startsWith('$$')) return false;
  if (first.length > 4 && first.endsWith('$$')) {
    if (silent) return true;
    const token = state.push('math_display', 'math', 0);
    token.content = first.slice(2, -2);
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }
  let line = startLine + 1;
  const lines: string[] = [first.slice(2)];
  let closed = false;
  for (; line < endLine; line++) {
    const text = state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]);
    if (text.trim().endsWith('$$')) {
      lines.push(text.trim().slice(0, -2));
      closed = true;
      break;
    }
    lines.push(text);
  }
  if (!closed) return false;
  if (silent) return true;
  const token = state.push('math_display', 'math', 0);
  token.content = lines.join('\n');
  token.map = [startLine, line + 1];
  state.line = line + 1;
  return true;
}

const md = new MarkdownIt({html: false, linkify: true, typographer: true, highlight: (code, lang) => highlight(code, lang)});
md.inline.ruler.before('escape', 'math_inline', mathInline);
md.block.ruler.before('fence', 'math_block', mathBlock, {alt: ['paragraph', 'reference', 'blockquote', 'list']});
md.renderer.rules['math_inline'] = (tokens, i) => renderMath(tokens[i]!.content, false);
md.renderer.rules['math_display'] = (tokens, i) => renderMath(tokens[i]!.content, true);
const defaultLink = md.renderer.rules['link_open'] ?? ((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
md.renderer.rules['link_open'] = (tokens, i, options, env, self) => {
  tokens[i]!.attrSet('target', '_blank');
  tokens[i]!.attrSet('rel', 'noopener noreferrer');
  return defaultLink(tokens, i, options, env, self);
};

let katexCss = false;
function ensureKatexCss(): void {
  if (katexCss || typeof document === 'undefined') return;
  katexCss = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/katex/katex.min.css';
  document.head.appendChild(link);
}

export function renderMarkdown(text: string, inline = false): string {
  const html = inline ? md.renderInline(text) : md.render(text);
  if (html.includes('class="katex')) ensureKatexCss();
  return html;
}

export function Markdown({text, inline, className}: {text: string; inline?: boolean; className?: string}) {
  const html = useMemo(() => renderMarkdown(text, inline), [text, inline]);
  return inline ? <span className={className} dangerouslySetInnerHTML={{__html: html}} /> : <div className={className ?? 'prose'} dangerouslySetInnerHTML={{__html: html}} />;
}
