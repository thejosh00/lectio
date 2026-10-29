/**
 * One question, answered in place: in a lesson (an inline check) or in a quiz.
 *
 * Confidence is the submit button: once an answer is entered, Sure · Think so · Guessing
 * each submit it — one tap to answer and to say how sure, before anything is revealed.
 * Then the reveal: right or wrong, the answer, the explanation, why the chosen distractor
 * was wrong, and one-tap reactions to the question.
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import {FEEDBACK_KINDS, FEEDBACK_LABELS} from '../core/feedbackKinds.ts';
import {ApiError, enc, post, type LearnerQuestion, type Outcome, type QuizProgress} from './api.ts';
import {Markdown} from './markdown.tsx';
import {pct, shuffle, useShared} from './state.ts';

type Part = {id: string; md: string};

export interface Answered {
  outcome: Outcome;
  quiz: {id: string; state: string; progress: QuizProgress} | null;
}

interface Props {
  question: LearnerQuestion;
  answered: Outcome | null;
  where: {lesson: string} | {quiz: string};
  kicker?: string;
  /** A question in an unfinished checkup: the tutor can't see it yet, so there is no asking it. */
  checkup?: boolean;
  onAnswered?: (result: Answered) => void;
}

/** Time actually spent: only while the page is visible. */
function useActiveSeconds(): () => number {
  const started = useRef(performance.now());
  const hidden = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = performance.now();
      else if (hiddenAt.current !== null) {
        hidden.current += performance.now() - hiddenAt.current;
        hiddenAt.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return () => Math.round((performance.now() - started.current - hidden.current) / 1000);
}

function orderFor(q: LearnerQuestion): string[] | null {
  const ids = (key: string) => (q.body[key] as Part[]).map(p => p.id);
  switch (q.type) {
    case 'multiple_choice':
    case 'multi_select':
      return q.body['shuffle'] === false ? ids('choices') : shuffle(ids('choices'));
    case 'ordering':
      return shuffle(ids('items'));
    case 'matching':
      return shuffle(ids('right'));
    default:
      return null;
  }
}

/** Whether a draft is complete enough to submit. */
function ready(q: LearnerQuestion, draft: unknown): boolean {
  switch (q.type) {
    case 'multiple_choice':
      return typeof draft === 'string';
    case 'multi_select':
      return Array.isArray(draft);
    case 'ordering':
      return Array.isArray(draft);
    case 'matching':
      return typeof draft === 'object' && draft !== null && (q.body['left'] as Part[]).every(l => typeof (draft as Record<string, string>)[l.id] === 'string');
    case 'cloze':
      return typeof draft === 'object' && draft !== null && Object.values(draft as Record<string, string>).some(v => v.trim() !== '');
    default:
      return typeof draft === 'string' && draft.trim() !== '';
  }
}

function initialDraft(q: LearnerQuestion, order: string[] | null): unknown {
  if (q.type === 'ordering') return order;
  if (q.type === 'multi_select') return [];
  if (q.type === 'matching') return {};
  if (q.type === 'cloze') return Object.fromEntries((q.body['blanks'] as string[]).map(k => [k, '']));
  return undefined;
}

/** Right or wrong in a mark and in words, never only in a border's colour. */
function Mark({right}: {right: boolean | undefined}) {
  return (
    <span className={`result-mark ${right ? 'right' : 'wrong'}`} role="img" aria-label={right ? 'right' : 'wrong'}>
      {right ? '✓' : '✗'}
    </span>
  );
}

function Inputs({q, order, draft, setDraft, outcome}: {q: LearnerQuestion; order: string[] | null; draft: unknown; setDraft: (d: unknown) => void; outcome: Outcome | null}) {
  const locked = outcome !== null;
  const parts = (key: string): Part[] => {
    const all = q.body[key] as Part[];
    return order === null ? all : order.map(id => all.find(p => p.id === id)!).filter(Boolean);
  };
  switch (q.type) {
    case 'multiple_choice':
    case 'multi_select': {
      const multi = q.type === 'multi_select';
      const picked = (id: string) => (multi ? ((draft as string[] | undefined) ?? []).includes(id) : draft === id);
      const key = outcome?.key['answer'];
      const right = (id: string) => (Array.isArray(key) ? key.includes(id) : key === id);
      return (
        <div className="options" role={multi ? 'group' : 'radiogroup'}>
          {multi && !locked && <div className="small-text muted">Pick all that apply.</div>}
          {parts('choices').map(c => {
            const cls = locked ? (right(c.id) ? 'right' : picked(c.id) ? 'wrong' : '') : picked(c.id) ? 'picked' : '';
            return (
              <button
                key={c.id}
                type="button"
                className={`option ${cls}`}
                disabled={locked}
                aria-pressed={picked(c.id)}
                onClick={() => {
                  if (!multi) setDraft(c.id);
                  else {
                    const now = (draft as string[] | undefined) ?? [];
                    setDraft(now.includes(c.id) ? now.filter(x => x !== c.id) : [...now, c.id]);
                  }
                }}
              >
                <span className="mark">{locked ? (right(c.id) ? '✓' : picked(c.id) ? '✗' : '') : picked(c.id) ? '●' : '○'}</span>
                <Markdown text={c.md} />
              </button>
            );
          })}
        </div>
      );
    }
    case 'numeric':
    case 'short_text':
      return (
        <div className="row" style={{marginTop: 10}}>
          <input
            value={(draft as string | undefined) ?? ''}
            onChange={e => setDraft(e.target.value)}
            disabled={locked}
            inputMode={q.type === 'numeric' ? 'decimal' : 'text'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={q.type === 'numeric' ? 'A number' : 'Your answer'}
            aria-label="your answer"
            style={{flex: 1}}
          />
          {q.type === 'numeric' && typeof q.body['unit'] === 'string' && <span className="muted">{String(q.body['unit'])}</span>}
        </div>
      );
    case 'cloze': {
      const text = String(q.body['text']);
      const pieces = text.split(/(\{\{[A-Za-z0-9_-]+\}\})/);
      const values = (draft as Record<string, string> | undefined) ?? {};
      return (
        <div className="cloze" style={{marginTop: 8}}>
          {pieces.map((piece, i) => {
            const blank = /^\{\{([A-Za-z0-9_-]+)\}\}$/.exec(piece)?.[1];
            if (blank === undefined) return <Markdown key={i} text={piece} inline />;
            const result = outcome?.detail?.[blank];
            const input = (
              <input
                key={i}
                value={values[blank] ?? ''}
                disabled={locked}
                onChange={e => setDraft({...values, [blank]: e.target.value})}
                aria-label={`blank ${blank}${result === undefined ? '' : result ? ', right' : ', wrong'}`}
                autoCapitalize="off"
                autoComplete="off"
                style={result === undefined ? undefined : {borderColor: result ? 'var(--ok)' : 'var(--wrong)'}}
              />
            );
            return result === undefined ? (
              input
            ) : (
              <span key={i} className="marked">
                {input}
                <Mark right={result} />
              </span>
            );
          })}
        </div>
      );
    }
    case 'ordering': {
      const items = q.body['items'] as Part[];
      const current = (draft as string[] | undefined) ?? order ?? [];
      const move = (i: number, by: number) => {
        const next = [...current];
        const [item] = next.splice(i, 1);
        next.splice(i + by, 0, item!);
        setDraft(next);
      };
      return (
        <div className="options">
          {current.map((id, i) => (
            <div key={id} className="order-item" style={outcome?.detail?.[id] === undefined ? undefined : {borderColor: outcome.detail[id] ? 'var(--ok)' : 'var(--wrong)'}}>
              <span className="muted">{i + 1}</span>
              {outcome?.detail?.[id] !== undefined && <Mark right={outcome.detail[id]} />}
              <Markdown text={items.find(it => it.id === id)!.md} />
              {!locked && (
                <>
                  <button type="button" aria-label="move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" aria-label="move down" disabled={i === current.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      );
    }
    case 'matching': {
      const values = (draft as Record<string, string> | undefined) ?? {};
      return (
        <div className="options">
          {(q.body['left'] as Part[]).map(l => (
            <label key={l.id} className="match-row">
              <Markdown text={l.md} />
              <select
                value={values[l.id] ?? ''}
                disabled={locked}
                onChange={e => setDraft({...values, [l.id]: e.target.value})}
                style={outcome?.detail?.[l.id] === undefined ? undefined : {borderColor: outcome.detail[l.id] ? 'var(--ok)' : 'var(--wrong)'}}
              >
                <option value="">Choose…</option>
                {parts('right').map(r => (
                  <option key={r.id} value={r.id}>
                    {r.md}
                  </option>
                ))}
              </select>
              {outcome?.detail?.[l.id] !== undefined && <Mark right={outcome.detail[l.id]} />}
            </label>
          ))}
        </div>
      );
    }
    case 'free_response':
      return (
        <textarea
          value={(draft as string | undefined) ?? ''}
          onChange={e => setDraft(e.target.value)}
          disabled={locked}
          rows={4}
          placeholder="Your answer, in your own words"
          aria-label="your answer"
          style={{marginTop: 10}}
        />
      );
    default:
      return <p className="muted">This kind of question ({q.type}) can't be answered here yet.</p>;
  }
}

function QuestionReactions({question, checkup = false}: {question: LearnerQuestion; checkup?: boolean}) {
  const {toast} = useShared();
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const react = async (kind: string, note = '') => {
    try {
      await post('/api/feedback', {target: 'question', target_id: question.id, kind, note});
      setSent(s => [...s, kind]);
      toast(kind === 'ask' ? 'Asked — your tutor answers on its next run.' : 'Noted.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div style={{marginTop: 12}}>
      <div className="chips">
        {FEEDBACK_KINDS.question
          .filter(k => k !== 'ask')
          .map(kind => (
            <button key={kind} type="button" className={`chip small ${sent.includes(kind) ? 'on' : ''}`} disabled={sent.includes(kind)} onClick={() => void react(kind)}>
              {FEEDBACK_LABELS[kind] ?? kind}
            </button>
          ))}
        {!checkup && (
          <button type="button" className="chip small" onClick={() => setAsking(a => !a)}>
            Ask…
          </button>
        )}
      </div>
      {checkup && <p className="small-text muted">A checkup from the examiner: your tutor sees it once you finish, and you can ask about it then.</p>}
      {asking && (
        <div className="row" style={{marginTop: 8}}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Your question for the tutor" style={{flex: 1}} />
          <button
            type="button"
            className="primary"
            disabled={text.trim() === ''}
            onClick={() => {
              void react('ask', text);
              setAsking(false);
              setText('');
            }}
          >
            Ask
          </button>
        </div>
      )}
    </div>
  );
}

export function QuestionCard({question, answered, where, kicker, checkup = false, onAnswered}: Props) {
  const {toast} = useShared();
  const order = useMemo(() => orderFor(question), [question.id]);
  const [draft, setDraft] = useState<unknown>(() => initialDraft(question, order));
  const [hints, setHints] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(answered);
  const [busy, setBusy] = useState(false);
  const seconds = useActiveSeconds();

  useEffect(() => setOutcome(answered), [answered?.attempt_id, answered?.score, answered?.graded_by]);

  const submit = async (confidence: 'sure' | 'think' | 'guess') => {
    setBusy(true);
    try {
      const result = await post<Answered>('/api/attempts', {question: question.id, ...where, answer: draft, shown_order: order ?? undefined, confidence, hints_used: hints, seconds: seconds()});
      setOutcome(result.outcome);
      onAnswered?.(result);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selfGrade = async (grade: string) => {
    if (outcome === null) return;
    try {
      const result = await post<Answered>(`/api/attempts/${enc(outcome.attempt_id)}/self-grade`, {grade});
      setOutcome(result.outcome);
      onAnswered?.(result);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const dispute = async () => {
    if (outcome === null) return;
    try {
      const result = await post<Answered>(`/api/attempts/${enc(outcome.attempt_id)}/dispute`, {});
      setOutcome(result.outcome);
      onAnswered?.(result);
      toast('Counted as right, and flagged for your tutor.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const verdict = outcome?.score === null || outcome === null ? null : outcome.score >= 1 ? 'right' : outcome.score > 0 ? 'partly' : 'wrong';
  return (
    <div className="question">
      {kicker !== undefined && <div className="kicker">{kicker}</div>}
      <Markdown className="prompt" text={question.prompt} />
      <Inputs q={question} order={order} draft={draft} setDraft={setDraft} outcome={outcome} />
      {outcome === null && (
        <>
          {hints > 0 && (
            <div className="hints">
              {question.hints.slice(0, hints).map((h, i) => (
                <Markdown key={i} text={`**Hint:** ${h}`} />
              ))}
            </div>
          )}
          <div className="confidence">
            <div className="row">
              <div className="label">{ready(question, draft) ? 'How sure are you? Tap to answer.' : 'Answer, then say how sure you are.'}</div>
              <span className="spacer" />
              {hints < question.hints.length && (
                <button type="button" className="small ghost" onClick={() => setHints(h => h + 1)}>
                  Hint
                </button>
              )}
            </div>
            <div className="buttons">
              <button type="button" className="sure" disabled={busy || !ready(question, draft)} onClick={() => void submit('sure')}>
                Sure
              </button>
              <button type="button" className="think" disabled={busy || !ready(question, draft)} onClick={() => void submit('think')}>
                Think so
              </button>
              <button type="button" className="guess" disabled={busy || !ready(question, draft)} onClick={() => void submit('guess')}>
                Guessing
              </button>
            </div>
          </div>
        </>
      )}
      {outcome !== null && (
        <div className="reveal">
          {outcome.needs_self_grade ? (
            <>
              <div className="verdict">Compare with the model answer</div>
              <Markdown text={String(outcome.key['model_answer'] ?? '')} />
              <ul className="rubric">
                {((outcome.key['rubric'] as string[] | undefined) ?? []).map((r, i) => (
                  <li key={i}>
                    <Markdown text={r} inline />
                  </li>
                ))}
              </ul>
              <div className="self-grade">
                <button type="button" onClick={() => void selfGrade('got_it')}>
                  Got it
                </button>
                <button type="button" onClick={() => void selfGrade('partly')}>
                  Partly
                </button>
                <button type="button" onClick={() => void selfGrade('missed')}>
                  Missed it
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`verdict ${verdict ?? ''}`}>
                {verdict === 'right' ? (outcome.graded_by === 'disputed' ? '✓ Counted as right' : '✓ Right') : verdict === 'partly' ? `~ Partly right (${pct(outcome.score)})` : '✗ Not quite'}
              </div>
              {verdict !== 'right' && (
                <p className="small-text">
                  The answer: <Markdown text={outcome.answer_text} inline />
                </p>
              )}
              {outcome.why !== null && (
                <div className="tutor-voice" style={{marginBottom: 8}}>
                  <strong>Why not that one: </strong>
                  <Markdown text={outcome.why} inline />
                </div>
              )}
              {question.type === 'free_response' && <Markdown text={String(outcome.key['model_answer'] ?? '')} />}
              <Markdown text={outcome.explanation} />
              {outcome.predicted !== null && <Prediction predicted={outcome.predicted} score={outcome.score} />}
              {outcome.disputable && (
                <button type="button" className="small" onClick={() => void dispute()}>
                  I was right
                </button>
              )}
              {outcome.agent_note !== null && (
                <div className="reply">
                  <div className="from">Your tutor, re-grading ({pct(outcome.agent_score)})</div>
                  {outcome.agent_note}
                </div>
              )}
            </>
          )}
          <QuestionReactions question={question} checkup={checkup} />
        </div>
      )}
    </div>
  );
}

/** What the tutor expected, shown once the answer is graded: how well it knows you is part of what it learns. */
function Prediction({predicted, score}: {predicted: number; score: number | null}) {
  const surprise = score === null ? '' : score >= 1 && predicted <= 0.3 ? ' You surprised it.' : score < 0.5 && predicted >= 0.8 ? ' It expected you to get this one.' : '';
  return (
    <p className="small-text muted">
      Your tutor gave this a {pct(predicted)} chance.{surprise}
    </p>
  );
}
