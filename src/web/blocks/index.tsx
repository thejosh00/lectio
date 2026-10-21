/**
 * The web renderer for each block type, registered by name. A block type without a
 * renderer here shows its `alt` (every visual block has one) or a plain note, so a lesson
 * never breaks because the page is older than the server.
 */
import type {ComponentType} from 'react';
import {CALLOUT_LABELS, type CalloutKind} from '../../blocks/callout.ts';
import type {BlockView} from '../api.ts';
import {highlight, Markdown} from '../markdown.tsx';
import {QuestionCard, type Answered} from '../QuestionCard.tsx';

export interface BlockProps {
  block: BlockView;
  lessonId: string;
  onAnswered?: (result: Answered) => void;
}

function MarkdownBlock({block}: BlockProps) {
  return <Markdown text={String(block.body['md'] ?? '')} />;
}

function CalloutBlock({block}: BlockProps) {
  const kind = String(block.body['kind']) as CalloutKind;
  return (
    <aside className={`callout ${kind}`}>
      <div className="label">{CALLOUT_LABELS[kind] ?? kind}</div>
      <Markdown text={String(block.body['md'] ?? '')} />
    </aside>
  );
}

function CodeBlock({block}: BlockProps) {
  const lang = String(block.body['lang'] ?? '');
  const caption = block.body['caption'];
  const output = block.body['output'];
  return (
    <figure className="code-block" style={{margin: 0}}>
      {typeof caption === 'string' && <figcaption className="caption">{caption}</figcaption>}
      <pre>
        <code className={`hljs language-${lang}`} dangerouslySetInnerHTML={{__html: highlight(String(block.body['source'] ?? ''), lang)}} />
      </pre>
      {typeof output === 'string' && (
        <div className="output">
          <span className="muted">Output</span>
          <pre>{output}</pre>
        </div>
      )}
    </figure>
  );
}

function QuestionBlock({block, lessonId, onAnswered}: BlockProps) {
  if (block.question === undefined) return <p className="muted">(an inline check that is no longer available)</p>;
  return <QuestionCard question={block.question} answered={block.answered ?? null} where={{lesson: lessonId}} kicker="Check" {...(onAnswered === undefined ? {} : {onAnswered})} />;
}

export const BLOCK_RENDERERS: Record<string, ComponentType<BlockProps>> = {
  markdown: MarkdownBlock,
  callout: CalloutBlock,
  code: CodeBlock,
  question: QuestionBlock,
};

export function Block(props: BlockProps) {
  const Renderer = BLOCK_RENDERERS[props.block.type];
  if (Renderer !== undefined) return <Renderer {...props} />;
  const alt = props.block.body['alt'];
  return <p className="muted">{typeof alt === 'string' ? alt : `(a ${props.block.type} block this page can't show yet)`}</p>;
}
