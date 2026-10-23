/**
 * Improvements: changes to lectio itself, grouped by whose turn it is — yours (a decision,
 * an answer to the builder, a build to ship), the tutor's (checking a change it asked for
 * once it runs), the builder's — then what shipped, with the tutor's verdicts beside the
 * retention trend.
 */
import {useState} from 'react';
import {weekOf} from '../core/measures.ts';
import {awaitsTutorReview} from '../core/proposals.ts';
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
  priority: string;
  status: string;
  proposed_by: string;
  branch: string | null;
  commit_sha: string | null;
  shipped_at: string | null;
  accepted_at: string | null;
  outcome: string | null;
  outcome_note: string | null;
  added: string;
  changed: string;
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
      <span className="small-text muted">
        from {who(p.proposed_by)}, {ago(p.added)}
      </span>
    </div>
  );
}

function Decide({p, onDone}: {p: Proposal; onDone: () => void}) {
  const act = useAct();
  const [priority, setPriority] = useState('normal');
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
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => void act(p.number, 'approve', {priority}, `Approved #${p.number}. The builder picks it up next.`).then(ok => ok && onDone())}
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

function ShipCommand({p}: {p: Proposal}) {
  const {toast} = useShared();
  const command = `git merge ${p.branch ?? ''} && lectio service restart`;
  return (
    <>
      <p className="small-text muted" style={{marginBottom: 4}}>
        Ship it like any other change: merge it in the lectio checkout and restart. Once it's running, lectio marks it shipped and your tutor checks it on its next run.
      </p>
      <div className="row">
        <pre className="hint-box ship-command">{command}</pre>
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
      <p className="small-text muted" style={{margin: '4px 0 0'}}>
        Branch <code>{p.branch}</code> at <code>{p.commit_sha?.slice(0, 12)}</code>.
      </p>
    </>
  );
}

function RequestChanges({p, onDone}: {p: Proposal; onDone: () => void}) {
  const act = useAct();
  const [note, setNote] = useState<string | null>(null);
  return note === null ? (
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
  );
}

function Handback({comments}: {comments: Comment[]}) {
  const handback = comments.filter(c => c.kind === 'handback').at(-1);
  if (handback === undefined) return null;
  return (
    <details className="more handback">
      <summary>What the builder did</summary>
      <Markdown text={handback.body} />
    </details>
  );
}

/** Built and handed back: yours to ship. */
function Ship({p, comments, onDone}: {p: Proposal; comments: Comment[]; onDone: () => void}) {
  return (
    <div className="card">
      <Head p={p} />
      <Handback comments={comments} />
      <ShipCommand p={p} />
      <RequestChanges p={p} onDone={onDone} />
    </div>
  );
}

/** Shipped, and the tutor asked for it: it checks it on its next run. */
function TutorChecking({p, comments}: {p: Proposal; comments: Comment[]}) {
  return (
    <div className="card">
      <Head p={p} />
      <p className="small-text" style={{margin: '6px 0 0'}}>
        Shipped {ago(p.shipped_at)}. On its next run your tutor tries it, then accepts it or asks the builder for another change. Nothing for you to do.
      </p>
      <Handback comments={comments} />
    </div>
  );
}

/** Approved, building, or sent back: the builder's turn. */
function Building({p, comments}: {p: Proposal; comments: Comment[]}) {
  const sentBack = p.status === 'changes_requested' ? comments.filter(c => c.kind === 'review').at(-1) : undefined;
  return (
    <div className="card">
      <Head p={p} />
      <p className="small-text muted" style={{margin: '6px 0 0'}}>
        {p.status === 'approved' ? `Approved (${p.priority}); waiting for the builder.` : p.status === 'building' ? 'The builder is working on it.' : 'Sent back to the builder for changes.'}
      </p>
      {sentBack !== undefined && (
        <div className="reply">
          <div className="from">{sentBack.actor === 'you' ? 'You asked' : 'Your tutor asked'}</div>
          <Markdown text={sentBack.body} />
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
  const ship = by('in_review');
  const checking = data.proposals.filter(awaitsTutorReview);
  const building = by('approved', 'building', 'changes_requested');
  const shipped = by('shipped');
  const done = shipped.filter(p => !awaitsTutorReview(p));
  const closed = by('declined', 'deferred', 'withdrawn');
  const weeks = progress.data?.progress.retention_by_week ?? [];
  return (
    <div>
      <h2 className="page">Improving lectio</h2>
      <p className="muted small-text">
        Your tutor proposes changes when lectio gets in the way of teaching you. You decide, the builder builds, you ship it, and your tutor checks it works and later says whether it helped.
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
      {ship.length > 0 && <div className="section">Ready to ship</div>}
      {ship.map(p => (
        <WithComments key={p.id} p={p}>
          {comments => <Ship p={p} comments={comments} onDone={reload} />}
        </WithComments>
      ))}
      {checking.length > 0 && <div className="section">With your tutor</div>}
      {checking.map(p => (
        <WithComments key={p.id} p={p}>
          {comments => <TutorChecking p={p} comments={comments} />}
        </WithComments>
      ))}
      {building.length > 0 && <div className="section">With the builder</div>}
      {building.map(p => (
        <WithComments key={p.id} p={p}>
          {comments => <Building p={p} comments={comments} />}
        </WithComments>
      ))}
      {done.length > 0 && (
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
          {done.map(p => (
            <div key={p.id} className="card">
              <Head p={p} />
              <p className="small-text" style={{margin: '6px 0 0'}}>
                {p.outcome === null ? (
                  <span className="muted">
                    Shipped {ago(p.shipped_at)}
                    {p.accepted_at === null ? '' : `; your tutor checked it ${ago(p.accepted_at)}`}. It says whether it helped once it has used it for a while.
                  </span>
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
      {progress.data !== undefined && progress.data.progress.retention.n > 0 && done.length === 0 && <p className="small-text muted">Retention so far: {pct(progress.data.progress.retention.rate)}.</p>}
    </div>
  );
}
