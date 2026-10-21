/**
 * The tutor's working documents — how you learn, and its plan for a subject — which you
 * can read and correct. Every save is a new version; your own lines are marked, and the
 * tutor never contradicts them.
 */
import {useState} from 'react';
import {api, enc, type NoteVersion, type NoteView} from './api.ts';
import {Markdown} from './markdown.tsx';
import {ago, useLoad, useShared} from './state.ts';

export function NotesPanel({subject, empty}: {subject?: string; empty: string}) {
  const {toast} = useShared();
  const query = subject === undefined ? '' : `?subject=${enc(subject)}`;
  const {data, reload} = useLoad<{notes: NoteView}>(`/api/notes${query}`);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const history = useLoad<{history: NoteVersion[]}>(showHistory ? `/api/notes${query}${query ? '&' : '?'}history=true` : null);
  const [viewing, setViewing] = useState<NoteVersion>();

  if (data === undefined) return <p className="loading">…</p>;
  const notes = data.notes;
  const save = async () => {
    try {
      await api('PUT', '/api/notes', {subject, body: text, note: why.trim() || 'edited by the learner'});
      setEditing(false);
      reload();
      toast('Saved. Your lines stay yours.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="notes">
      {editing ? (
        <div className="editor">
          <textarea value={text} onChange={e => setText(e.target.value)} />
          <input value={why} onChange={e => setWhy(e.target.value)} placeholder="Why the change? (optional)" />
          <div className="row">
            <button type="button" className="primary" onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {notes.version === 0 ? <p className="muted">{empty}</p> : <Markdown text={notes.body} />}
          {notes.version > 0 && (
            <p className="small-text muted">
              v{notes.version} by {notes.actor === 'you' ? 'you' : 'your tutor'} {ago(notes.at)}
              {notes.note ? ` — ${notes.note}` : ''}
            </p>
          )}
          {notes.learner_lines.length > 0 && (
            <div className="small-text" style={{marginTop: 6}}>
              <div className="muted">Your own lines (your tutor never contradicts these):</div>
              {notes.learner_lines.map((l, i) => (
                <div key={i} className="mine">
                  {l}
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{marginTop: 8}}>
            <button
              type="button"
              className="small"
              onClick={() => {
                setText(notes.body);
                setWhy('');
                setEditing(true);
              }}
            >
              {notes.version === 0 ? 'Write' : 'Correct it'}
            </button>
            {notes.version > 1 && (
              <button type="button" className="small ghost" onClick={() => setShowHistory(h => !h)}>
                {showHistory ? 'Hide history' : 'History'}
              </button>
            )}
          </div>
          {showHistory && history.data !== undefined && (
            <ul className="list small-text" style={{marginTop: 8}}>
              {history.data.history.map(v => (
                <li key={v.version}>
                  <button type="button" className="link" onClick={() => setViewing(viewing?.version === v.version ? undefined : v)}>
                    v{v.version}
                  </button>{' '}
                  {v.actor === 'you' ? 'you' : 'tutor'}, {ago(v.at)}
                  {v.note ? ` — ${v.note}` : ''}
                  {viewing?.version === v.version && (
                    <div className="card" style={{marginTop: 6}}>
                      <Markdown text={v.body} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
