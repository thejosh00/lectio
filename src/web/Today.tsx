/**
 * Today: for each subject, the lesson and quiz waiting, reviews due, and — when nothing
 * is ready — the real reason. Replies from the tutor since you last looked go on top.
 */
import {FEEDBACK_LABELS} from '../core/feedbackKinds.ts';
import {post, type TodayQuiz, type TodayView} from './api.ts';
import {Markdown} from './markdown.tsx';
import {dayLabel, go, pct, useLoad, useShared} from './state.ts';

/** What a reply is answering, in a line: "You asked: …", "You flagged it wrong". */
export function aboutLine(kind: string, note: string): string {
  const quoted = note ? `: “${note}”` : '';
  if (kind === 'ask') return `You asked${quoted}`;
  if (kind === 'dispute') return `You said you were right${quoted}`;
  return `You marked it “${(FEEDBACK_LABELS[kind] ?? kind).toLowerCase()}”${quoted}`;
}

const QUIZ_LABEL: Record<string, string> = {daily: 'Quiz', placement: 'Placement quiz', practice: 'Practice'};

function quizLine(q: TodayQuiz): string {
  const parts = Object.entries(q.counts).map(([role, n]) => `${n} ${role === 'probe' ? 'questions' : role}`);
  return `${parts.join(' · ')} · ~${q.estimate_minutes} min`;
}

function QuizRow({quiz}: {quiz: TodayQuiz}) {
  const done = quiz.state === 'finished';
  return (
    <div className="row" style={{marginTop: 10}}>
      <div style={{flex: 1, minWidth: 0}}>
        <div>
          <strong>{QUIZ_LABEL[quiz.kind] ?? 'Quiz'}</strong> <span className="small-text muted">{quizLine(quiz)}</span>
        </div>
        {quiz.blocked !== null && !done && <div className="small-text muted">{quiz.blocked}</div>}
        {done && <div className="small-text muted">Done: {pct(quiz.progress.score)}</div>}
        {!done && quiz.progress.answered > 0 && <div className="small-text muted">{quiz.progress.answered} of {quiz.progress.total} answered</div>}
      </div>
      {!done && quiz.blocked === null && (
        <a className="button small primary" href={`#/quiz/${quiz.id}`}>
          {quiz.progress.answered > 0 ? 'Continue' : 'Start'}
        </a>
      )}
      {done && (
        <a className="button small" href={`#/quiz/${quiz.id}`}>
          Review
        </a>
      )}
    </div>
  );
}

export function TodayView() {
  const {who, toast} = useShared();
  const {data, error} = useLoad<TodayView>('/api/today');
  if (error !== undefined) return <p className="error">{error}</p>;
  if (data === undefined) return <p className="loading">…</p>;

  const practice = async (subject: string) => {
    try {
      const result = await post<{practice: Array<{quiz: {id: string} | null}>}>('/api/practice', {subject});
      const quiz = result.practice[0]?.quiz;
      if (quiz === null || quiz === undefined) toast('Nothing is due for review.');
      else go(`#/quiz/${quiz.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <div className="kicker-line">
        {new Date(`${data.day}T12:00:00Z`).toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'}).replace(/,(?=[^,]*$)/, ' ·')}
      </div>
      <h2 className="page">Today</h2>
      {data.subjects.length > 0 && (
        <p className="page-sub">
          {data.subjects.length} subject{data.subjects.length === 1 ? '' : 's'} · about {data.subjects.reduce((sum, s) => sum + s.subject.minutes_per_day, 0)} minutes
        </p>
      )}
      {(data.improvements ?? 0) > 0 && (
        <a className="banner" href="#/improvements">
          <span className="count">{data.improvements}</span>
          <span className="spacer">Improvement{data.improvements === 1 ? '' : 's'} to lectio need{data.improvements === 1 ? 's' : ''} you</span>
          <span aria-hidden>›</span>
        </a>
      )}
      {data.replies.length > 0 && (
        <div className="card from-tutor">
          <div className="row">
            <div className="card-kicker">From your tutor</div>
            <span className="spacer" />
            <button type="button" className="small ghost" onClick={() => void post('/api/replies/seen')}>
              Got it
            </button>
          </div>
          {data.replies.map(r => (
            <div key={r.id} className="reply">
              <div className="from">{aboutLine(r.kind, r.note)}</div>
              <Markdown text={r.reply ?? ''} />
            </div>
          ))}
        </div>
      )}
      {data.subjects.length === 0 && (
        <div className="card">
          <h3>What do you want to learn?</h3>
          <p className="muted">Add a subject and what you want from it. Your tutor plans it, then writes you a lesson and a quiz each day.</p>
          <a className="button primary" href="#/subjects/new">
            Add a subject
          </a>
        </div>
      )}
      {data.subjects.map(s => (
        <div key={s.subject.id} className="card">
          <div className="card-title">
            <h3>{s.subject.title}</h3>
            <span className="small-text muted">{s.subject.minutes_per_day} min a day</span>
          </div>
          {s.lesson !== null && (
            <div style={{marginTop: 10}}>
              <div className="row">
                <div style={{flex: 1, minWidth: 0}}>
                  <div>
                    <strong>{s.lesson.title}</strong>
                  </div>
                  <div className="small-text muted">
                    Lesson · {s.lesson.estimated_minutes} min{s.lesson.is_today ? '' : ` · from ${dayLabel(s.lesson.day, who.today)}`}
                    {s.lesson.state === 'finished' && ' · finished'}
                    {s.lesson.state === 'skipped' && ' · skipped'}
                  </div>
                </div>
                <a className={`button small ${s.lesson.state === 'ready' || s.lesson.state === 'open' ? 'primary' : ''}`} href={`#/lesson/${s.lesson.id}`}>
                  {s.lesson.state === 'ready' ? 'Read' : s.lesson.state === 'open' ? 'Continue' : 'Read again'}
                </a>
              </div>
              {(s.lesson.state === 'ready' || s.lesson.state === 'open') && (
                <ul className="objectives">
                  {s.lesson.objectives.slice(0, 3).map((o, i) => (
                    <li key={i}>
                      <Markdown text={o} inline />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {s.waiting !== null && <p className="small-text muted" style={{marginBottom: 0}}>{s.waiting.message}</p>}
          {s.quizzes.map(q => (
            <QuizRow key={q.id} quiz={q} />
          ))}
          {s.practice_due > 0 && !s.quizzes.some(q => q.kind === 'practice' && q.state !== 'finished') && (
            <div className="row" style={{marginTop: 10}}>
              <div style={{flex: 1}}>
                <strong>Practice</strong>{' '}
                <span className="small-text muted">
                  {s.practice_due} review{s.practice_due === 1 ? '' : 's'} due
                </span>
              </div>
              <button type="button" className="small" onClick={() => void practice(s.subject.id)}>
                Practice
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
