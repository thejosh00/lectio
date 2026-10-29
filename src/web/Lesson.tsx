/**
 * The lesson reader: blocks top to bottom, inline checks answered in place, one-tap
 * reactions on every block, and a rating at the end.
 *
 * Active time is measured per block — on screen, tab visible, input within the last
 * minute — and sent in batches, so the tutor knows which blocks were read and for how
 * long, not just that the page was open.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {FEEDBACK_LABELS, LESSON_RATINGS, SKIP_REASONS} from '../core/feedbackKinds.ts';
import {enc, post, type BlockView, type Feedback, type LessonDetail} from './api.ts';
import {ActivityContext, type ReportActivity} from './blocks/activity.ts';
import {Block} from './blocks/index.tsx';
import {Markdown} from './markdown.tsx';
import {dayLabel, go, useLoad, useShared} from './state.ts';

const IDLE_MS = 60_000;
const FLUSH_MS = 15_000;

interface BlockActivity {
  seen_seconds: number;
  interactions: number;
  completed: boolean;
}

const noActivity = (): BlockActivity => ({seen_seconds: 0, interactions: 0, completed: false});

/**
 * Reading time per block, and what was done with it (a step taken, the end reached), sent to
 * the server in batches and on leaving the page. Returns how a block reports what it did.
 */
function useActivity(lessonId: string, enabled: boolean, onSeen: (index: number) => void): ReportActivity {
  const visible = useRef(new Set<string>());
  const lastInput = useRef(Date.now());
  const pending = useRef({seconds: 0, blocks: new Map<string, BlockActivity>()});
  const report = useCallback<ReportActivity>((id, what) => {
    const block = pending.current.blocks.get(id) ?? noActivity();
    pending.current.blocks.set(id, {...block, interactions: block.interactions + (what.interactions ?? 0), completed: block.completed || what.completed === true});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // On screen means 40% of the block showing, or most of the screen for a block taller than it.
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset['blockId']!;
          const share = Math.min(0.4, (0.6 * window.innerHeight) / Math.max(1, entry.boundingClientRect.height));
          if (entry.isIntersecting && entry.intersectionRatio >= share - 0.001) {
            visible.current.add(id);
            onSeen(Number((entry.target as HTMLElement).dataset['index']));
          } else visible.current.delete(id);
        }
      },
      {threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.4]},
    );
    for (const el of document.querySelectorAll('[data-block-id]')) observer.observe(el);
    const touch = () => (lastInput.current = Date.now());
    const events = ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    for (const e of events) window.addEventListener(e, touch, {passive: true});
    const payload = () => {
      const {seconds, blocks} = pending.current;
      if (seconds === 0 && ![...blocks.values()].some(b => b.interactions > 0 || b.completed)) return undefined;
      pending.current = {seconds: 0, blocks: new Map()};
      return JSON.stringify({
        active_seconds: seconds,
        blocks: [...blocks].map(([id, b]) => ({id, seen_seconds: b.seen_seconds, ...(b.interactions > 0 ? {interactions: b.interactions} : {}), ...(b.completed ? {completed: true} : {})})),
      });
    };
    const flush = () => {
      const body = payload();
      if (body !== undefined) void fetch(`/api/lessons/${enc(lessonId)}/activity`, {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body, keepalive: true});
    };
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastInput.current > IDLE_MS) return;
      pending.current.seconds++;
      for (const id of visible.current) {
        const block = pending.current.blocks.get(id) ?? noActivity();
        pending.current.blocks.set(id, {...block, seen_seconds: block.seen_seconds + 1});
      }
    }, 1000);
    const flusher = setInterval(flush, FLUSH_MS);
    const onHide = () => {
      const body = payload();
      if (body !== undefined) navigator.sendBeacon(`/api/lessons/${enc(lessonId)}/activity`, new Blob([body], {type: 'application/json'}));
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && onHide());
    return () => {
      observer.disconnect();
      for (const e of events) window.removeEventListener(e, touch);
      window.removeEventListener('pagehide', onHide);
      clearInterval(tick);
      clearInterval(flusher);
      flush();
    };
  }, [lessonId, enabled]);
  return report;
}

function BlockMenu({block, feedback}: {block: BlockView; feedback: Feedback[]}) {
  const {toast} = useShared();
  const [open, setOpen] = useState(false);
  const [writing, setWriting] = useState<'wrong' | 'broken' | 'ask' | null>(null);
  const [note, setNote] = useState('');
  const send = async (kind: string, text = '') => {
    try {
      if (kind === 'ask') await post('/api/ask', {ref: block.id, note: text});
      else await post('/api/feedback', {target: 'block', target_id: block.id, kind, note: text});
      toast(kind === 'ask' ? 'Asked — your tutor answers on its next run.' : kind === 'wrong' || kind === 'broken' ? 'Flagged — your tutor fixes it first thing.' : 'Noted.');
      setOpen(false);
      setWriting(null);
      setNote('');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const mine = feedback.filter(f => f.target === 'block' && f.target_id === block.id);
  return (
    <>
      <div className="block-menu">
        <button type="button" aria-label="react to this block" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          ⋯
        </button>
        {open && (
          <div className="menu" role="menu">
            {writing === null ? (
              <>
                <button type="button" onClick={() => void send('helpful')}>
                  👍 Helpful
                </button>
                <button type="button" onClick={() => void send('confusing')}>
                  🤔 Confusing
                </button>
                <button type="button" onClick={() => setWriting('wrong')}>
                  ⚠️ Wrong (a factual error)…
                </button>
                <button type="button" onClick={() => setWriting('broken')}>
                  🔧 Broken…
                </button>
                <button type="button" onClick={() => setWriting('ask')}>
                  💬 Ask the tutor…
                </button>
              </>
            ) : (
              <div className="stack" style={{padding: 4}}>
                <textarea
                  autoFocus
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={writing === 'ask' ? 'Your question' : writing === 'wrong' ? 'What is wrong? (optional)' : "What didn't work? (optional)"}
                />
                <div className="row">
                  <button type="button" className="small ghost" onClick={() => setWriting(null)}>
                    Back
                  </button>
                  <span className="spacer" />
                  <button type="button" className="small primary" disabled={writing === 'ask' && note.trim() === ''} onClick={() => void send(writing, note)}>
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {mine.length > 0 && (
        <div className="flagged">
          {mine.map(f => (
            <div key={f.id}>
              You said: {FEEDBACK_LABELS[f.kind] ?? f.kind}
              {f.note ? ` — “${f.note}”` : ''}
              {f.reply !== null && (
                <div className="reply">
                  <div className="from">Your tutor ({f.resolved})</div>
                  <Markdown text={f.reply} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SkipMenu({lesson}: {lesson: LessonDetail}) {
  const {toast} = useShared();
  const [open, setOpen] = useState(false);
  const labels: Record<string, string> = {know_it: 'I know this already', not_now: 'Not now', not_interested: 'Not interested'};
  const skip = async (reason: string) => {
    try {
      await post(`/api/lessons/${enc(lesson.id)}/skip`, {reason});
      toast('Skipped. Your tutor will take that into account.');
      go('#/');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  if (lesson.state === 'finished' || lesson.state === 'skipped') return null;
  return (
    <div style={{position: 'relative'}}>
      <button type="button" className="small ghost" onClick={() => setOpen(o => !o)}>
        Skip
      </button>
      {open && (
        <div className="menu" role="menu">
          {SKIP_REASONS.map(r => (
            <button key={r} type="button" onClick={() => void skip(r)}>
              {labels[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LessonEnd({lesson, onFinished}: {lesson: LessonDetail; onFinished: () => void}) {
  const {toast} = useShared();
  const [rating, setRating] = useState<string>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try {
      await post(`/api/lessons/${enc(lesson.id)}/finish`, {rate: rating, note});
      onFinished();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (lesson.state === 'skipped') return <p className="muted">You skipped this lesson.</p>;
  if (lesson.state === 'finished') {
    return (
      <div className="card lesson-end">
        <h3>Finished {lesson.finished !== null ? '✓' : ''}</h3>
        <div className="actions">
          {lesson.quiz !== null && lesson.quiz.state !== 'finished' && lesson.quiz.state !== 'skipped' && (
            <a className="button primary" href={`#/quiz/${lesson.quiz.id}`}>
              Start the quiz
            </a>
          )}
          <a className="button" href="#/">
            Back to today
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="card lesson-end">
      <h3>How was it?</h3>
      <div className="chips" style={{marginTop: 10}}>
        {LESSON_RATINGS.map(r => (
          <button key={r} type="button" className={`chip ${rating === r ? 'on' : ''}`} onClick={() => setRating(rating === r ? undefined : r)}>
            {FEEDBACK_LABELS[r]}
          </button>
        ))}
      </div>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Anything else? (optional)" style={{marginTop: 10}} />
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void finish()}>
          {lesson.quiz !== null ? 'Finish, then the quiz' : 'Finish'}
        </button>
      </div>
    </div>
  );
}

export function LessonView({id}: {id: string}) {
  const {who} = useShared();
  const {data, error, reload} = useLoad<{lesson: LessonDetail}>(`/api/lessons/${enc(id)}`);
  const [seen, setSeen] = useState(-1);
  const lesson = data?.lesson;
  const readable = lesson !== undefined && lesson.state !== 'skipped';

  useEffect(() => {
    if (lesson?.state === 'ready') void post(`/api/lessons/${enc(id)}/open`).catch(() => undefined);
  }, [lesson?.state, id]);
  const report = useActivity(id, readable && lesson.state !== 'finished', index => setSeen(s => Math.max(s, index)));

  if (error !== undefined) return <p className="error">{error}</p>;
  if (lesson === undefined) return <p className="loading">…</p>;
  const total = lesson.blocks.length;
  const progress = lesson.state === 'finished' ? 1 : total === 0 ? 0 : (seen + 1) / total;
  return (
    <article>
      <div className="reader-head">
        <div className="row">
          <a href="#/" className="small-text muted" style={{textDecoration: 'none'}}>
            ← {lesson.subject.title}
          </a>
          <span className="spacer" />
          <span className="small-text muted">{lesson.estimated_minutes} min</span>
          <SkipMenu lesson={lesson} />
        </div>
        <div className="progress" aria-label="progress">
          <span style={{width: `${Math.round(progress * 100)}%`}} />
        </div>
      </div>
      <p className="meta">{dayLabel(lesson.day, who.today)}</p>
      <h1 className="lesson-title">{lesson.title}</h1>
      <ul className="objectives">
        {lesson.objectives.map((o, i) => (
          <li key={i}>
            <Markdown text={o} inline />
          </li>
        ))}
      </ul>
      <details className="why" style={{marginTop: 10}}>
        <summary>Why this lesson</summary>
        <div className="tutor-voice" style={{marginTop: 6}}>
          <Markdown text={lesson.rationale} />
          {lesson.hypothesis !== null && (
            <p className="small-text" style={{margin: '6px 0 0'}}>
              <strong>Trying: </strong>
              {lesson.hypothesis}
              {lesson.verdict !== null && <> — <strong>turned out:</strong> {lesson.verdict}</>}
            </p>
          )}
        </div>
      </details>
      <ActivityContext.Provider value={report}>
        {lesson.blocks.map((block, index) => (
          <section key={block.id} className="block" data-block-id={block.id} data-index={index}>
            <Block block={block} lessonId={lesson.id} />
            {block.type !== 'question' && <BlockMenu block={block} feedback={lesson.feedback} />}
          </section>
        ))}
      </ActivityContext.Provider>
      {lesson.sources.length > 0 && (
        <>
          <div className="section">Sources</div>
          <ul className="sources">
            {lesson.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <LessonEnd
        lesson={lesson}
        onFinished={() => {
          if (lesson.quiz !== null) go(`#/quiz/${lesson.quiz.id}`);
          else reload();
        }}
      />
    </article>
  );
}
