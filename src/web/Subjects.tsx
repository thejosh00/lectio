/**
 * Subjects: what you want to learn and what you want from it. Each shows its syllabus
 * with how well you remember each idea, and the tutor's plan for it.
 */
import {useState} from 'react';
import {FEEDBACK_KINDS, FEEDBACK_LABELS} from '../core/feedbackKinds.ts';
import {api, enc, post, type Concept, type Memory, type Subject} from './api.ts';
import {NotesPanel} from './Notes.tsx';
import {go, pct, useLoad, useShared} from './state.ts';

const LEVELS: Array<[string, string]> = [
  ['new', 'New to it'],
  ['some', 'Know some'],
  ['solid', 'Solid already'],
];

interface Draft {
  title: string;
  goal: string;
  level: string;
  minutes_per_day: number;
  days: string;
  note: string;
}

function SubjectForm({initial, submitLabel, onSubmit, onCancel}: {initial: Draft; submitLabel: string; onSubmit: (d: Draft) => Promise<void>; onCancel?: () => void}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({...d, [key]: value}));
  return (
    <form
      className="stack"
      onSubmit={e => {
        e.preventDefault();
        setBusy(true);
        void onSubmit(draft).finally(() => setBusy(false));
      }}
    >
      <label className="field">
        What do you want to learn?
        <input value={draft.title} onChange={e => set('title', e.target.value)} placeholder="Rust, music theory, the AWS exam…" required />
      </label>
      <label className="field">
        What do you want to get out of it?
        <textarea value={draft.goal} onChange={e => set('goal', e.target.value)} rows={2} placeholder="Read and change our Rust services" />
      </label>
      <div className="field">
        Where are you starting?
        <div className="chips">
          {LEVELS.map(([value, label]) => (
            <button key={value} type="button" className={`chip ${draft.level === value ? 'on' : ''}`} onClick={() => set('level', value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          Minutes a day
          <input type="number" min={5} max={240} value={draft.minutes_per_day} onChange={e => set('minutes_per_day', Number(e.target.value))} />
        </label>
        <label className="field">
          Days
          <select value={['daily', 'weekdays', 'weekends'].includes(draft.days) ? draft.days : 'custom'} onChange={e => set('days', e.target.value === 'custom' ? 'mon,wed,fri' : e.target.value)}>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekends">Weekends</option>
            <option value="custom">Some days…</option>
          </select>
        </label>
      </div>
      {!['daily', 'weekdays', 'weekends'].includes(draft.days) && (
        <label className="field">
          Which days (e.g. mon,wed,fri)
          <input value={draft.days} onChange={e => set('days', e.target.value)} />
        </label>
      )}
      <label className="field">
        Anything else? (optional)
        <textarea value={draft.note} onChange={e => set('note', e.target.value)} rows={2} placeholder="Working through a book; I like code examples" />
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={busy || draft.title.trim() === ''}>
          {submitLabel}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function NewSubjectView() {
  const {toast} = useShared();
  return (
    <div>
      <h2 className="page">Add a subject</h2>
      <div className="card">
        <SubjectForm
          initial={{title: '', goal: '', level: 'new', minutes_per_day: 15, days: 'daily', note: ''}}
          submitLabel="Add it"
          onSubmit={async draft => {
            try {
              const result = await post<{subject: Subject}>('/api/subjects', draft);
              toast('Added. Your tutor plans it on its next run.');
              go(`#/subject/${result.subject.id}`);
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      </div>
    </div>
  );
}

export function SubjectsView() {
  const {data} = useLoad<{subjects: Subject[]}>('/api/subjects?all=true');
  if (data === undefined) return <p className="loading">…</p>;
  const live = data.subjects.filter(s => s.status !== 'archived');
  const archived = data.subjects.filter(s => s.status === 'archived');
  return (
    <div>
      <div className="row">
        <h2 className="page">Subjects</h2>
        <span className="spacer" />
        <a className="button small primary" href="#/subjects/new">
          Add
        </a>
      </div>
      {live.length === 0 && <p className="empty">Nothing yet. Add something you want to learn.</p>}
      {live.map(s => (
        <a key={s.id} href={`#/subject/${s.id}`} className="card" style={{display: 'block', textDecoration: 'none'}}>
          <div className="card-title">
            <h3>{s.title}</h3>
            {s.status !== 'active' && <span className="pill warn">{s.status}</span>}
          </div>
          {s.goal && <p className="meta">{s.goal}</p>}
          <p className="meta">
            {s.minutes_per_day} min · {s.days}
          </p>
        </a>
      ))}
      {archived.length > 0 && (
        <details className="more" style={{marginTop: 16}}>
          <summary>Archived ({archived.length})</summary>
          {archived.map(s => (
            <a key={s.id} href={`#/subject/${s.id}`} className="card" style={{display: 'block', textDecoration: 'none', marginTop: 8}}>
              {s.title}
            </a>
          ))}
        </details>
      )}
    </div>
  );
}

function SubjectReactions({subject}: {subject: Subject}) {
  const {toast} = useShared();
  const [comment, setComment] = useState<string | null>(null);
  const send = async (kind: string, note = '') => {
    try {
      await post('/api/feedback', {target: 'subject', target_id: subject.id, kind, note});
      toast('Noted. Your tutor reads it on its next run.');
      setComment(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <div className="chips">
        {FEEDBACK_KINDS.subject
          .filter(k => k !== 'comment')
          .map(kind => (
            <button key={kind} type="button" className="chip small" onClick={() => void send(kind)}>
              {FEEDBACK_LABELS[kind]}
            </button>
          ))}
        <button type="button" className="chip small" onClick={() => setComment(comment === null ? '' : null)}>
          Something else…
        </button>
      </div>
      {comment !== null && (
        <div className="row" style={{marginTop: 8}}>
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Tell your tutor" style={{flex: 1}} />
          <button type="button" className="primary" disabled={comment.trim() === ''} onClick={() => void send('comment', comment)}>
            Send
          </button>
        </div>
      )}
    </>
  );
}

type ConceptWithMemory = Concept & {memory: Memory | null};

export function SubjectView({id}: {id: string}) {
  const {toast} = useShared();
  const {data, error, reload} = useLoad<{subject: Subject; concepts: ConceptWithMemory[]}>(`/api/subjects/${enc(id)}`);
  const [editing, setEditing] = useState(false);
  if (error !== undefined) return <p className="error">{error}</p>;
  if (data === undefined) return <p className="loading">…</p>;
  const {subject, concepts} = data;
  const setStatus = async (status: string) => {
    try {
      await post(`/api/subjects/${enc(subject.id)}/status`, {status});
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const shown = concepts.filter(c => c.status !== 'retired');
  return (
    <div>
      <a href="#/subjects" className="small-text muted" style={{textDecoration: 'none'}}>
        ← Subjects
      </a>
      <div className="card-title" style={{marginTop: 6}}>
        <h2 className="page" style={{marginBottom: 4}}>
          {subject.title}
        </h2>
        {subject.status !== 'active' && <span className="pill warn">{subject.status}</span>}
      </div>
      {editing ? (
        <div className="card">
          <SubjectForm
            initial={{title: subject.title, goal: subject.goal, level: subject.level, minutes_per_day: subject.minutes_per_day, days: subject.days, note: subject.note}}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async draft => {
              try {
                await api('PATCH', `/api/subjects/${enc(subject.id)}`, draft);
                setEditing(false);
                reload();
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        </div>
      ) : (
        <>
          {subject.goal && <p>{subject.goal}</p>}
          <p className="meta">
            {LEVELS.find(([v]) => v === subject.level)?.[1]} · {subject.minutes_per_day} min a day · {subject.days}
            {subject.note && ` · ${subject.note}`}
          </p>
          <div className="row" style={{marginTop: 10}}>
            <button type="button" className="small" onClick={() => setEditing(true)}>
              Edit
            </button>
            {subject.status === 'active' && (
              <button type="button" className="small" onClick={() => void setStatus('paused')}>
                Pause
              </button>
            )}
            {subject.status !== 'active' && (
              <button type="button" className="small" onClick={() => void setStatus('active')}>
                Resume
              </button>
            )}
            {subject.status !== 'archived' && (
              <button type="button" className="small ghost" onClick={() => void setStatus('archived')}>
                Archive
              </button>
            )}
          </div>
        </>
      )}

      <div className="section">Syllabus</div>
      {shown.length === 0 ? (
        <p className="muted">Your tutor writes the syllabus on its next run.</p>
      ) : (
        <ul className="syllabus">
          {shown.map(c => (
            <li key={c.id}>
              <div>
                <span className="title">{c.title}</span> <span className={`pill ${c.status}`}>{c.status === 'known' ? 'already known' : c.status}</span>
                {c.summary && <div className="small-text muted">{c.summary}</div>}
              </div>
              <div className="small-text muted" style={{textAlign: 'right'}}>
                {c.memory !== null && (
                  <>
                    recall {pct(c.memory.recall_now)}
                    <br />
                    {c.memory.is_due ? 'due now' : `next ${c.memory.due}`}
                  </>
                )}
              </div>
              {c.memory !== null && (
                <div className={`bar ${c.memory.recall_now < 0.8 ? 'low' : ''}`} aria-label={`recall ${pct(c.memory.recall_now)}`}>
                  <span style={{width: `${Math.round(c.memory.recall_now * 100)}%`}} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="section">Your tutor's plan</div>
      <div className="card">
        <NotesPanel subject={subject.id} empty="No plan yet: your tutor writes one with the syllabus." />
      </div>

      <div className="section">Tell your tutor</div>
      <SubjectReactions subject={subject} />
    </div>
  );
}
