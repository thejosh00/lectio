/**
 * Improvements: changes to lectio itself, grouped by what they need from you — a
 * decision, an answer to the builder, a review — then what's in progress and what
 * shipped, with the tutor's verdicts beside the retention trend.
 */
import {useState} from 'react';
import {weekOf} from '../core/measures.ts';
import {enc, post, type Progress} from './api.ts';
import {Chart} from './Charts.tsx';
import {Markdown} from './markdown.tsx';
import {ago, pct, useLoad, useShared} from './state.ts';

interface Comment {
  id: string;
  actor: string;
  kind: string;
  body: string;
  at: string;
}

interface Proposal {
  id: string;
  number: number;
  title: string;
  area: string;
  problem: string;
  change: string;
  success: string;
  evidence: Array<{kind: string; id: string | null; note: string}>;
  support: number;
  protected: boolean;
  acknowledged: boolean;
  priority: string;
  status: string;
  proposed_by: string;
  branch: string | null;
  commit_sha: string | null;
  shipped_at: string | null;
  outcome: string | null;
  outcome_note: string | null;
  added: string;
}

const who = (actor: string) => (actor === 'you' ? 'you' : actor === 'agent:builder' ? 'the builder' : 'your tutor');
const OUTCOME: Record<string, string> = {helped: 'Helped', no_difference: 'No difference', got_in_the_way: 'Got in the way', unused: 'Never needed'};

function useAct() {
  const {toast} = useShared();
  return async (n: number, action: string, body: Record<string, unknown>, done: string) => {
    try {
      await post(`/api/proposals/${n}/${action}`, body);
      toast(done);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
}

function Detail({p}: {p: Proposal}) {
  return (
    <div className="small-text stack" style={{gap: 6, marginTop: 6}}>
      <div>
        <strong>The problem: </strong>
        <Markdown text={p.problem} inline />
      </div>
      <div>
        <strong>The change: </strong>
        <Markdown text={p.change} inline />
      </div>
      <div>
        <strong>How we'll know: </strong>
        <Markdown text={p.success} inline />
      </div>
      {p.evidence.length > 0 && (
        <details className="more">
          <summary>
            Evidence ({p.evidence.length}){p.support > 1 ? ` · hit ${p.support} times` : ''}
          </summary>
          <ul className="list">
            {p.evidence.map((e, i) => (
              <li key={i}>
                <span className="pill">{e.kind}</span> {e.kind === 'lesson' && e.id !== null ? <a href={`#/lesson/${e.id}`}>{e.note}</a> : e.note}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Head({p}: {p: Proposal}) {
  return (
    <div className="card-title">
      <h3>
        #{p.number} {p.title}
      </h3>
      <span className="pill">{p.area.replace(/_/g, ' ')}</span>
      {p.protected && <span className="pill danger">protected</span>}
      <span className="small-text muted">
        from {who(p.proposed_by)}, {ago(p.added)}
      </span>
    </div>
  );
}

function Decide({p, onDone}: {p: Proposal; onDone: () => void}) {
  const act = useAct();
  const [priority, setPriority] = useState('normal');
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [declining, setDeclining] = useState<'decline' | 'defer' | null>(null);
  return (
    <div className="card">
      <Head p={p} />
      <Detail p={p} />
      {declining === null ? (
        <>
          <div className="row" style={{marginTop: 10}}>
            <span className="small-text muted">Priority</span>
            {['high', 'normal', 'low'].map(level => (
              <button key={level} type="button" className={`chip small ${priority === level ? 'on' : ''}`} onClick={() => setPriority(level)}>
                {level}
              </button>
            ))}
          </div>
          {p.protected && (
            <label className="row small-text" style={{marginTop: 8}}>
              <input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} style={{width: 'auto', minHeight: 0}} />
              I know this changes lectio's own rules ({p.area.replace(/_/g, ' ')}).
            </label>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={p.protected && !confirm}
              onClick={() => void act(p.number, 'approve', {priority, protected: p.protected && confirm}, `Approved #${p.number}. The builder picks it up next.`).then(ok => ok && onDone())}
            >
              Approve
            </button>
            <button type="button" onClick={() => setDeclining('defer')}>
              Later
            </button>
            <button type="button" onClick={() => setDeclining('decline')}>
              Decline
            </button>
          </div>
        </>
      ) : (
        <div className="stack" style={{marginTop: 10}}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder={declining === 'decline' ? 'Why not? Your tutor learns from this.' : 'Why not now?'} />
          <div className="row">
            <button type="button" className="primary" disabled={note.trim() === ''} onClick={() => void act(p.number, declining, {note}, declining === 'decline' ? 'Declined.' : 'Deferred.').then(ok => ok && onDone())}>
              {declining === 'decline' ? 'Decline' : 'Defer'}
            </button>
            <button type="button" className="ghost" onClick={() => setDeclining(null)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Answer({p, comments, onDone}: {p: Proposal; comments: Comment[]; onDone: () => void}) {
  const act = useAct();
  const [text, setText] = useState('');
  const question = comments.filter(c => c.kind === 'question').at(-1);
  return (
    <div className="card">
      <Head p={p} />
      {question !== undefined && (
        <div className="reply">
          <div className="from">The builder asks</div>
          <Markdown text={question.body} />
        </div>
      )}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Your answer" />
      <div className="actions">
        <button type="button" className="primary" disabled={text.trim() === ''} onClick={() => void act(p.number, 'answer', {answer: text}, 'Answered; back in the queue.').then(ok => ok && onDone())}>
          Answer
        </button>
      </div>
    </div>
  );
}

function Review({p, comments, onDone}: {p: Proposal; comments: Comment[]; onDone: () => void}) {
  const act = useAct();
  const {toast} = useShared();
  const [note, setNote] = useState<string | null>(null);
  const handback = comments.filter(c => c.kind === 'handback').at(-1);
  const command = `scripts/ship.sh ${p.branch ?? ''}`;
  return (
    <div className="card">
      <Head p={p} />
      {handback !== undefined && (
        <details className="more" open>
          <summary>The builder's hand-back</summary>
          <Markdown text={handback.body} />
        </details>
      )}
      <p className="small-text muted" style={{marginBottom: 4}}>
        Branch <code>{p.branch}</code> at <code>{p.commit_sha?.slice(0, 12)}</code>. To ship it, from the lectio checkout:
      </p>
      <div className="row">
        <pre className="hint-box" style={{flex: 1, margin: 0, overflowX: 'auto'}}>{command}</pre>
        <button
          type="button"
          className="small"
          onClick={() =>
            void navigator.clipboard?.writeText(command).then(
              () => toast('Copied.'),
              () => toast(command),
            )
          }
        >
          Copy
        </button>
      </div>
      {note === null ? (
        <div className="actions">
          <button type="button" onClick={() => setNote('')}>
            Request changes
          </button>
        </div>
      ) : (
        <div className="stack" style={{marginTop: 10}}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="What should change?" />
          <div className="row">
            <button type="button" className="primary" disabled={note.trim() === ''} onClick={() => void act(p.number, 'request-changes', {note}, 'Sent back to the builder.').then(ok => ok && onDone())}>
              Send back
            </button>
            <button type="button" className="ghost" onClick={() => setNote(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Each proposal with its conversation, for the groups that need it. */
function WithComments({p, children}: {p: Proposal; children: (comments: Comment[]) => React.ReactNode}) {
  const {data} = useLoad<{proposal: Proposal & {comments: Comment[]}}>(`/api/proposals/${enc(String(p.number))}`);
  return <>{children(data?.proposal.comments ?? [])}</>;
}

export function ImprovementsView() {
  const {data, reload} = useLoad<{proposals: Proposal[]}>('/api/proposals');
  const progress = useLoad<{progress: Progress}>('/api/progress');
  if (data === undefined) return <p className="loading">…</p>;
  const by = (...statuses: string[]) => data.proposals.filter(p => statuses.includes(p.status));
  const decide = by('open');
  const questions = by('needs_info');
  const review = by('in_review');
  const progressing = by('approved', 'building', 'changes_requested');
  const shipped = by('shipped');
  const closed = by('declined', 'deferred', 'withdrawn');
  const weeks = progress.data?.progress.retention_by_week ?? [];
  return (
    <div>
      <h2 className="page">Improving lectio</h2>
      <p className="muted small-text">
        Your tutor proposes changes when lectio gets in the way of teaching you. You decide, the builder builds, you ship, and your tutor says whether it helped.
      </p>
      {data.proposals.length === 0 && <p className="empty">No proposals yet.</p>}
      {decide.length > 0 && <div className="section">To decide</div>}
      {decide.map(p => (
        <Decide key={p.id} p={p} onDone={reload} />
      ))}
      {questions.length > 0 && <div className="section">The builder has a question</div>}
      {questions.map(p => (
        <WithComments key={p.id} p={p}>
          {comments => <Answer p={p} comments={comments} onDone={reload} />}
        </WithComments>
      ))}
      {review.length > 0 && <div className="section">Ready to review</div>}
      {review.map(p => (
        <WithComments key={p.id} p={p}>
          {comments => <Review p={p} comments={comments} onDone={reload} />}
        </WithComments>
      ))}
      {progressing.length > 0 && <div className="section">In progress</div>}
      {progressing.map(p => (
        <div key={p.id} className="card">
          <Head p={p} />
          <p className="small-text muted" style={{margin: '6px 0 0'}}>
            {p.status === 'approved' ? `Approved (${p.priority}); waiting for the builder.` : p.status === 'building' ? 'The builder is working on it.' : 'Sent back for changes.'}
          </p>
        </div>
      ))}
      {shipped.length > 0 && (
        <>
          <div className="section">Shipped</div>
          {weeks.length > 0 && (
            <div className="card chart-card">
              <h3>Retention by week</h3>
              <p className="sub">Lines mark when a change shipped. Is the loop earning its keep?</p>
              <Chart
                ariaLabel="retention by week, with ship dates"
                points={weeks.map(w => ({x: w.week, y: w.rate, note: `${w.n} reviews`}))}
                max={1}
                format={y => `${Math.round(y * 100)}%`}
                marks={shipped.filter(p => p.shipped_at !== null).map(p => ({x: weekOf(p.shipped_at!.slice(0, 10)), label: `#${p.number}`}))}
              />
            </div>
          )}
          {shipped.map(p => (
            <div key={p.id} className="card">
              <Head p={p} />
              <p className="small-text" style={{margin: '6px 0 0'}}>
                {p.outcome === null ? (
                  <span className="muted">Shipped {ago(p.shipped_at)}; your tutor judges it once it has used it.</span>
                ) : (
                  <>
                    <span className={`pill ${p.outcome === 'helped' ? 'ok' : p.outcome === 'got_in_the_way' ? 'danger' : ''}`}>{OUTCOME[p.outcome] ?? p.outcome}</span> {p.outcome_note}
                  </>
                )}
              </p>
            </div>
          ))}
        </>
      )}
      {closed.length > 0 && (
        <details className="more" style={{marginTop: 16}}>
          <summary>Declined, deferred and withdrawn ({closed.length})</summary>
          {closed.map(p => (
            <div key={p.id} className="card" style={{marginTop: 8}}>
              <Head p={p} />
              <p className="small-text muted" style={{margin: '4px 0 0'}}>
                {p.status}
              </p>
            </div>
          ))}
        </details>
      )}
      {progress.data !== undefined && progress.data.progress.retention.n > 0 && shipped.length === 0 && <p className="small-text muted">Retention so far: {pct(progress.data.progress.retention.rate)}.</p>}
    </div>
  );
}
