/**
 * The tutor's side, in the open: what it did each run and why, what it believes about
 * how you learn (which you can correct), and what it has tried, with how that turned out.
 */
import type {Run} from './api.ts';
import {Markdown} from './markdown.tsx';
import {NotesPanel} from './Notes.tsx';
import {ago, useLoad} from './state.ts';

interface Hypothesis {
  id: string;
  subject: string;
  day: string;
  title: string;
  hypothesis: string;
  verdict: string | null;
}

export function TutorView() {
  const runs = useLoad<{runs: Run[]}>('/api/runs?limit=30');
  const hypotheses = useLoad<{hypotheses: Hypothesis[]}>('/api/hypotheses');
  return (
    <div>
      <h2 className="page">Your tutor</h2>
      <div className="section">How you learn</div>
      <div className="card">
        <NotesPanel empty="Your tutor writes down what works for you once it has seen you learn for a while." />
      </div>

      <div className="section">What it is trying</div>
      {(hypotheses.data?.hypotheses ?? []).length === 0 ? (
        <p className="muted small-text">Nothing yet. When your tutor tries a different way of teaching on purpose, it says so here, and later says how it went.</p>
      ) : (
        <div className="card">
          <ul className="list">
            {hypotheses.data!.hypotheses.map(h => (
              <li key={h.id}>
                <a href={`#/lesson/${h.id}`}>{h.title}</a> <span className="small-text muted">· {h.subject} · {h.day}</span>
                <div className="small-text">{h.hypothesis}</div>
                <div className="small-text">{h.verdict === null ? <span className="pill">waiting for reviews</span> : <><span className="pill tutor">verdict</span> {h.verdict}</>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="section">Runs</div>
      <div className="row" style={{marginBottom: 8}}>
        <a className="button small" href="#/improvements">
          Improvements to lectio →
        </a>
      </div>
      {(runs.data?.runs ?? []).length === 0 ? (
        <p className="muted small-text">Your tutor hasn't run yet.</p>
      ) : (
        <div className="card">
          {runs.data!.runs.map(r => {
            const made = Object.entries(r.made)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${n} ${n === 1 ? k.replace(/zes$/, 'z').replace(/s$/, '') : k}`)
              .join(' · ');
            return (
              <div key={r.id} className="run">
                <div className="row">
                  <span className={`pill ${r.outcome ?? 'open'}`}>{r.outcome ?? 'running'}</span>
                  {r.retro && <span className="pill tutor">weekly look back</span>}
                  <span className="small-text muted">{ago(r.started)}</span>
                </div>
                {made && <div className="small-text muted">{made}</div>}
                {r.summary && <Markdown text={r.summary} className="small-text" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
