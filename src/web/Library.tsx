/**
 * The library: past lessons to re-read, the questions you've answered with your record
 * on each, and your asks with the tutor's replies.
 */
import {useState} from 'react';
import {FEEDBACK_LABELS} from '../core/feedbackKinds.ts';
import type {Feedback, Lesson, Subject} from './api.ts';
import {Markdown} from './markdown.tsx';
import {ago, pct, useLoad, useShared, dayLabel} from './state.ts';

interface BankQuestion {
  id: string;
  subject_id: string;
  type: string;
  prompt: string;
  explanation: string;
  status: string;
  stats: {attempts: number; first_try: {n: number; rate: number | null}};
}

function Lessons() {
  const {who} = useShared();
  const lessons = useLoad<{lessons: Lesson[]}>('/api/lessons?limit=200');
  const subjects = useLoad<{subjects: Subject[]}>('/api/subjects?all=true');
  const title = (id: string) => subjects.data?.subjects.find(s => s.id === id)?.title ?? '';
  const list = lessons.data?.lessons ?? [];
  if (list.length === 0) return <p className="empty">No lessons yet.</p>;
  return (
    <ul className="list">
      {list.map(l => (
        <li key={l.id}>
          <a href={`#/lesson/${l.id}`}>{l.title}</a>
          <div className="small-text muted">
            {title(l.subject_id)} · {dayLabel(l.day, who.today)} · {l.state}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Questions() {
  const bank = useLoad<{questions: BankQuestion[]}>('/api/questions?status=all');
  const [open, setOpen] = useState<string>();
  // Only what you've met: a question still waiting in a quiz keeps its answer to itself.
  const met = (bank.data?.questions ?? []).filter(q => q.stats.attempts > 0);
  if (met.length === 0) return <p className="empty">Questions you've answered show up here, with how you did on each.</p>;
  return (
    <ul className="list">
      {met.map(q => (
        <li key={q.id}>
          <button type="button" className="link" style={{textAlign: 'left', color: 'var(--text)', textDecoration: 'none'}} onClick={() => setOpen(open === q.id ? undefined : q.id)}>
            <Markdown text={q.prompt} inline />
          </button>
          <div className="small-text muted">
            first try right {pct(q.stats.first_try.rate)} of {q.stats.first_try.n} · {q.type.replace('_', ' ')}
            {q.status === 'retired' ? ' · retired' : ''}
          </div>
          {open === q.id && <Markdown text={q.explanation} className="prose small-text" />}
        </li>
      ))}
    </ul>
  );
}

function Asks() {
  const asks = useLoad<{feedback: Feedback[]}>('/api/feedback?kind=ask');
  const list = asks.data?.feedback ?? [];
  if (list.length === 0) return <p className="empty">Ask your tutor about any block or question with the ⋯ menu. Its answers collect here.</p>;
  return (
    <ul className="list">
      {list.map(f => (
        <li key={f.id}>
          <div>{f.note}</div>
          <div className="small-text muted">
            on a {f.target} · {ago(f.at)}
          </div>
          {f.reply === null ? <div className="small-text muted">waiting for your tutor's next run</div> : (
            <div className="reply">
              <div className="from">Your tutor · {FEEDBACK_LABELS[f.resolved ?? ''] ?? f.resolved}</div>
              <Markdown text={f.reply} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function LibraryView() {
  const [tab, setTab] = useState<'lessons' | 'questions' | 'asks'>('lessons');
  return (
    <div>
      <h2 className="page">Library</h2>
      <div className="seg">
        {(['lessons', 'questions', 'asks'] as const).map(t => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'lessons' ? 'Lessons' : t === 'questions' ? 'Questions' : 'Your asks'}
          </button>
        ))}
      </div>
      <div className="card">
        {tab === 'lessons' && <Lessons />}
        {tab === 'questions' && <Questions />}
        {tab === 'asks' && <Asks />}
      </div>
    </div>
  );
}
