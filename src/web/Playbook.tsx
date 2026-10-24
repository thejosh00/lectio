/**
 * How your tutor teaches: its playbook, which it rewrites as it learns what works for you
 * (M13). Every version is kept; each shows what changed and why, and you can put an
 * earlier one back. Your own lines are marked, and the tutor never contradicts them.
 */
import {useEffect, useState} from 'react';
import {lineDiff} from '../core/diff.ts';
import {api, post, type NoteVersion, type PlaybookView} from './api.ts';
import {Markdown} from './markdown.tsx';
import {ago, useLoad, useShared} from './state.ts';

function Changes({before, after}: {before: string; after: string}) {
  const lines = lineDiff(before, after).filter(l => l.op !== 'same' && l.line.trim() !== '');
  if (lines.length === 0) return <p className="small-text muted">No change in wording.</p>;
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div key={i} className={l.op}>
          <span aria-hidden>{l.op === 'add' ? '+' : '−'}</span> {l.line}
        </div>
      ))}
    </div>
  );
}

export function PlaybookPanel() {
  const {toast} = useShared();
  const {data, reload} = useLoad<{playbook: PlaybookView; history: NoteVersion[]}>('/api/playbook?history=true');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [open, setOpen] = useState<number>();
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (data !== undefined) void post('/api/playbook/seen').catch(() => {});
  }, [data?.playbook.version]);

  if (data === undefined) return <p className="loading">…</p>;
  const {playbook, history} = data;
  const save = async () => {
    try {
      await api('PUT', '/api/playbook', {body: text, note: why.trim() || 'edited by the learner'});
      setEditing(false);
      reload();
      toast('Saved. Your lines stay yours.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  const restore = async (version: number) => {
    try {
      await post('/api/playbook/revert', {version});
      reload();
      toast(`Put v${version} back.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  if (editing) {
    return (
      <div className="notes editor">
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
    );
  }
  if (playbook.version === 0) return <p className="muted small-text">Your tutor writes down how it teaches on its next run, then rewrites it as it learns what works for you.</p>;
  const previous = (v: NoteVersion) => history.find(h => h.version === v.version - 1)?.body ?? '';
  return (
    <div className="notes">
      <p className="small-text muted" style={{marginTop: 0}}>
        v{playbook.version} by {playbook.actor === 'you' ? 'you' : 'your tutor'} {ago(playbook.at!)}
        {playbook.note ? ` — ${playbook.note}` : ''}
      </p>
      {full ? <Markdown text={playbook.body} /> : null}
      {playbook.learner_lines.length > 0 && (
        <div className="small-text" style={{marginTop: 6}}>
          <div className="muted">Your own lines (your tutor never contradicts these):</div>
          {playbook.learner_lines.map((l, i) => (
            <div key={i} className="mine">
              {l}
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{marginTop: 8}}>
        <button type="button" className="small ghost" onClick={() => setFull(f => !f)}>
          {full ? 'Hide it' : 'Read it'}
        </button>
        <button
          type="button"
          className="small"
          onClick={() => {
            setText(playbook.body);
            setWhy('');
            setEditing(true);
          }}
        >
          Change it
        </button>
      </div>
      <ul className="list small-text" style={{marginTop: 10}}>
        {history.map(v => (
          <li key={v.version}>
            <button type="button" className="link" onClick={() => setOpen(open === v.version ? undefined : v.version)}>
              v{v.version}
            </button>{' '}
            {v.actor === 'you' ? 'you' : 'your tutor'}, {ago(v.at)}
            {v.restored_from !== null ? ` · put back v${v.restored_from}` : ''}
            {v.note ? ` — ${v.note}` : ''}
            {open === v.version && (
              <div style={{marginTop: 6}}>
                {v.version === 1 ? <p className="small-text muted">The first version.</p> : <Changes before={previous(v)} after={v.body} />}
                {v.version !== playbook.version && (
                  <button type="button" className="small" style={{marginTop: 6}} onClick={() => void restore(v.version)}>
                    Put v{v.version} back
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
