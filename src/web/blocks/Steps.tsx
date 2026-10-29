/**
 * The `steps` block (M18): a process one frame at a time, at the learner's pace. Every frame is
 * drawn up front and stacked in one place, so the page doesn't jump as they step; only the
 * current one shows. The caption says what changed. A frame with an `ask` turns Next into
 * "Show me": guess, then see. It plays on its own only when the learner presses play, never
 * past an ask, and never under reduced motion.
 *
 * Each step the learner takes is an interaction, and reaching the last frame completes it.
 */
import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import type {BlockView} from '../api.ts';
import {Markdown} from '../markdown.tsx';
import {useReportActivity} from './activity.ts';
import {MermaidFigure} from './Diagram.tsx';
import {assetUrl, Figure} from './Figure.tsx';

interface Frame {
  asset?: string;
  mermaid?: string;
  md?: string;
  caption: string;
  ask: string | null;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function FrameView({frame, alt}: {frame: Frame; alt: string}) {
  if (typeof frame.asset === 'string') return <Figure src={assetUrl(frame.asset)} alt={alt} />;
  if (typeof frame.mermaid === 'string') return <MermaidFigure source={frame.mermaid} alt={alt} />;
  return (
    <div className="figure-paper steps-text">
      <Markdown text={frame.md ?? ''} />
    </div>
  );
}

export function StepsBlock({block}: {block: BlockView}) {
  const frames = (block.body['frames'] as Frame[] | undefined) ?? [];
  const alt = String(block.body['alt'] ?? '');
  const autoplay = typeof block.body['autoplay_ms'] === 'number' ? block.body['autoplay_ms'] : null;
  const report = useReportActivity();
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const completed = useRef(false);
  const last = frames.length - 1;
  const current = frames[at];

  const goTo = (next: number, byLearner = true) => {
    const to = Math.max(0, Math.min(last, next));
    if (to === at) return;
    setAt(to);
    const reachedEnd = to === last && !completed.current;
    if (reachedEnd) completed.current = true;
    if (byLearner || reachedEnd) report(block.id, {interactions: byLearner ? 1 : 0, completed: reachedEnd});
  };

  useEffect(() => {
    if (!playing || autoplay === null) return;
    if (at >= last || current?.ask != null) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => goTo(at + 1, false), autoplay);
    return () => clearTimeout(timer);
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') goTo(at + 1);
    else if (e.key === 'ArrowLeft') goTo(at - 1);
    else return;
    e.preventDefault();
  };

  if (current === undefined) return <p className="muted">{alt}</p>;
  return (
    <div className="steps" role="group" aria-roledescription="step-through" aria-label={alt} onKeyDown={onKey}>
      <div className="steps-stage">
        {frames.map((frame, i) => (
          <div key={i} className={`steps-frame${i === at ? ' current' : ''}`} inert={i !== at} aria-hidden={i !== at}>
            <FrameView frame={frame} alt={`Step ${i + 1} of ${frames.length}: ${frame.caption}`} />
          </div>
        ))}
      </div>
      <p className="steps-caption" aria-live="polite">
        <span className="steps-count">
          {at + 1} / {frames.length}
        </span>{' '}
        {current.caption}
      </p>
      {current.ask !== null && (
        <p className="steps-ask">
          <strong>Guess first:</strong> {current.ask}
        </p>
      )}
      <div className="steps-controls">
        <button type="button" onClick={() => goTo(at - 1)} disabled={at === 0} aria-label="Back a step">
          ‹ Back
        </button>
        <div className="steps-dots">
          {frames.map((_, i) => (
            <button key={i} type="button" className={i === at ? 'on' : ''} aria-label={`Step ${i + 1}`} aria-current={i === at ? 'step' : undefined} onClick={() => goTo(i)} />
          ))}
        </div>
        {autoplay !== null && !reducedMotion() && (
          <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'} aria-pressed={playing}>
            {playing ? '❚❚' : '▶'}
          </button>
        )}
        <button type="button" className="primary" onClick={() => goTo(at + 1)} disabled={at === last}>
          {current.ask !== null ? 'Show me' : 'Next ›'}
        </button>
      </div>
    </div>
  );
}
