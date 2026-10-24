/**
 * A quiz, one question per screen. At the end: the score, new and review shown
 * separately, the concepts touched, and what's next.
 */
import {useEffect, useState} from 'react';
import {enc, post, type QuizDetail} from './api.ts';
import {QuestionCard} from './QuestionCard.tsx';
import {pct, useLoad, useShared} from './state.ts';

const ROLE_LABEL: Record<string, string> = {new: "Today's lesson", review: 'Review', retry: 'Another try', probe: 'Finding your level', exam: 'Checkup'};

function Summary({quiz}: {quiz: QuizDetail}) {
  const roles = Object.entries(quiz.progress.by_role);
  return (
    <div className="card">
      <p className="muted small-text">{quiz.subject.title}</p>
      <p className="score-big">{pct(quiz.progress.score)}</p>
      <div className="stack" style={{marginTop: 8}}>
        {roles.map(([role, r]) => (
          <div key={role} className="row">
            <span>{ROLE_LABEL[role] ?? role}</span>
            <span className="spacer" />
            <span>
              {r.right} of {r.total} right
            </span>
          </div>
        ))}
      </div>
      {quiz.kind === 'placement' && <p className="small-text muted">That was to find your level, not to test you. Your tutor starts from what it showed.</p>}
      {quiz.concepts.length > 0 && <p className="small-text muted">Touched: {quiz.concepts.map(c => c.title).join(', ')}</p>}
      <div className="actions">
        <a className="button primary" href="#/">
          Back to today
        </a>
        <a className="button" href="#/progress">
          Progress
        </a>
      </div>
    </div>
  );
}

export function QuizView({id}: {id: string}) {
  const {toast} = useShared();
  // Not live: a server event mid-question must not reshuffle the screen.
  const {data, error, reload} = useLoad<{quiz: QuizDetail}>(`/api/quizzes/${enc(id)}`, {live: false});
  const [index, setIndex] = useState<number | null>(null);
  const [answeredHere, setAnsweredHere] = useState<Set<string>>(new Set());
  const quiz = data?.quiz;

  useEffect(() => {
    if (quiz === undefined || index !== null) return;
    if (quiz.blocked === null && quiz.state === 'ready') void post(`/api/quizzes/${enc(id)}/open`).catch(() => undefined);
    // Pick up where the learner left off.
    const first = quiz.items.findIndex(i => i.answered === null || i.answered.needs_self_grade);
    setIndex(first === -1 ? quiz.items.length : first);
  }, [quiz, index, id]);

  if (error !== undefined) return <p className="error">{error}</p>;
  if (quiz === undefined || index === null) return <p className="loading">…</p>;
  if (quiz.blocked !== null && quiz.state !== 'finished') {
    return (
      <div className="card">
        <h3>Not yet</h3>
        <p>{quiz.blocked}</p>
        {quiz.lesson !== null && (
          <a className="button primary" href={`#/lesson/${quiz.lesson.id}`}>
            Go to the lesson
          </a>
        )}
      </div>
    );
  }
  if (index >= quiz.items.length) return <Summary quiz={quiz} />;
  const item = quiz.items[index]!;
  const done = item.answered !== null && !item.answered.needs_self_grade;
  const canGoOn = done || answeredHere.has(item.question.id);
  return (
    <div>
      <div className="quiz-head">
        <a href="#/" className="small-text muted" style={{textDecoration: 'none'}}>
          ✕
        </a>
        <div className="progress">
          <span style={{width: `${Math.round((index / quiz.items.length) * 100)}%`}} />
        </div>
        <span className="small-text muted">
          {index + 1} / {quiz.items.length}
        </span>
      </div>
      <QuestionCard
        key={item.question.id}
        question={item.question}
        answered={item.answered}
        where={{quiz: quiz.id}}
        kicker={ROLE_LABEL[item.role] ?? item.role}
        checkup={quiz.kind === 'exam' && quiz.state !== 'finished'}
        onAnswered={result => {
          if (!result.outcome.needs_self_grade) setAnsweredHere(s => new Set(s).add(item.question.id));
          if (result.quiz?.state === 'finished') toast('Quiz finished.');
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="primary wide"
          disabled={!canGoOn}
          onClick={() => {
            const next = index + 1;
            if (next >= quiz.items.length) reload();
            setIndex(next);
            window.scrollTo({top: 0});
          }}
        >
          {index + 1 === quiz.items.length ? 'See how you did' : 'Next'}
        </button>
      </div>
    </div>
  );
}
