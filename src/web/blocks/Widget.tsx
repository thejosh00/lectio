/**
 * The `widget` block (M21): the tutor's HTML in a sandboxed frame (`sandbox="allow-scripts"`,
 * served from `/w/<id>` under its own CSP sandbox), on the figure paper. The page listens only
 * to messages from that frame, in the bridge's shapes (src/core/widget.ts), and turns them into
 * the block's interactions, completion and errors.
 *
 * An animation is paced here, not in the widget: play, pause, step to the next moment, scrub,
 * replay, and the caption of the step it is in — the same for every animation, never autoplayed.
 * An interactive or a simulation has its goal above it. With `predict`, the learner guesses
 * before it starts.
 */
import {useEffect, useRef, useState} from 'react';
import {readBridgeMessage} from '../../core/widget.ts';
import type {BlockView} from '../api.ts';
import {useReportActivity} from './activity.ts';

interface Step {
  at: number;
  caption: string;
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

export function WidgetBlock({block}: {block: BlockView}) {
  const body = block.body;
  const kind = String(body['kind'] ?? 'interactive');
  const alt = String(body['alt'] ?? '');
  const caption = text(body['caption']);
  const goal = text(body['goal']);
  const predict = text(body['predict']);
  const steps = Array.isArray(body['steps']) ? (body['steps'] as Step[]) : [];
  const report = useReportActivity();
  const frame = useRef<HTMLIFrameElement>(null);
  const completed = useRef(false);
  const [height, setHeight] = useState(Number(body['height']) || 300);
  const [guessed, setGuessed] = useState(predict === null);
  const [duration, setDuration] = useState(typeof body['duration'] === 'number' ? body['duration'] : 0);
  const [time, setTime] = useState({t: 0, playing: false});
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const message = readBridgeMessage(event.data);
      if (message === undefined) return;
      switch (message.type) {
        case 'event':
          report(block.id, {interactions: 1});
          break;
        case 'done':
          if (!completed.current) report(block.id, {completed: true});
          completed.current = true;
          break;
        case 'resize':
          setHeight(Math.max(120, Math.min(1200, message.height)));
          break;
        case 'error':
          report(block.id, {errors: 1, last_error: `${message.message}${message.line > 0 ? ` (line ${message.line}:${message.column})` : ''}`});
          setBroken(true);
          break;
        case 'timeline':
          setDuration(message.duration);
          break;
        case 'time':
          setTime({t: message.t, playing: message.playing});
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [block.id, report]);

  const send = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({lectio: 1, ...message}, '*');
  const seek = (t: number) => {
    send({type: 'seek', t});
    setTime({t, playing: false});
  };
  const play = () => {
    if (time.t >= duration) seek(0);
    send({type: 'play'});
    setTime(now => ({...now, playing: true}));
    report(block.id, {interactions: 1});
  };
  const pause = () => send({type: 'pause'});
  const near = 0.05;
  const next = steps.find(step => step.at > time.t + near);
  const current = [...steps].reverse().find(step => step.at <= time.t + near);
  const ended = duration > 0 && time.t >= duration - near;

  return (
    <figure className="figure widget-block">
      {goal !== null && (
        <p className="widget-goal">
          <strong>Goal:</strong> {goal}
        </p>
      )}
      <div className="figure-paper widget-paper">
        <iframe ref={frame} src={`/w/${encodeURIComponent(block.id)}?v=${block.version}`} sandbox="allow-scripts" title={alt} style={{height}} loading="lazy" inert={!guessed} />
        {!guessed && (
          <div className="widget-predict">
            <p>
              <strong>Guess first:</strong> {predict}
            </p>
            <button type="button" className="primary" onClick={() => setGuessed(true)}>
              I've guessed
            </button>
          </div>
        )}
      </div>
      {kind === 'animation' && (
        <>
          <div className="widget-controls">
            {time.playing ? (
              <button type="button" onClick={pause} aria-label="Pause">
                ❚❚
              </button>
            ) : (
              <button type="button" onClick={play} disabled={!guessed} aria-label={ended ? 'Play again' : 'Play'}>
                {ended ? '↺' : '▶'}
              </button>
            )}
            {steps.length > 0 && (
              <button
                type="button"
                disabled={!guessed || next === undefined}
                onClick={() => {
                  if (next === undefined) return;
                  seek(next.at);
                  report(block.id, {interactions: 1});
                }}
              >
                Step ›
              </button>
            )}
            <input type="range" min={0} max={duration} step={0.05} value={Math.min(time.t, duration)} disabled={!guessed} onChange={e => seek(Number(e.target.value))} aria-label="Time" />
            <span className="widget-time">{time.t.toFixed(1)} s</span>
          </div>
          {steps.length > 0 && (
            <p className="steps-caption" aria-live="polite">
              {current?.caption ?? ' '}
            </p>
          )}
        </>
      )}
      {caption !== null && <figcaption className="caption">{caption}</figcaption>}
      {broken && <p className="small-text muted">Something in this went wrong, and your tutor will see it. What it shows: {alt}</p>}
    </figure>
  );
}
