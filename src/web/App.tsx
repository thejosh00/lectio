import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api, get, type WhoAmI} from './api.ts';
import {ImprovementsView} from './Improvements.tsx';
import {LessonView} from './Lesson.tsx';
import {LibraryView} from './Library.tsx';
import {ProgressView} from './Progress.tsx';
import {QuizView} from './Quiz.tsx';
import {SharedContext, type Shared} from './state.ts';
import {NewSubjectView, SubjectsView, SubjectView} from './Subjects.tsx';
import {TodayView} from './Today.tsx';
import {TutorView} from './Tutor.tsx';
import logo from './logo.svg';

const TABS = [
  {hash: '#/', label: 'Today', icon: '☀', match: (r: string[]) => r[0] === '' || r[0] === 'lesson' || r[0] === 'quiz'},
  {hash: '#/subjects', label: 'Subjects', icon: '❖', match: (r: string[]) => r[0] === 'subjects' || r[0] === 'subject'},
  {hash: '#/progress', label: 'Progress', icon: '↗', match: (r: string[]) => r[0] === 'progress'},
  {hash: '#/library', label: 'Library', icon: '☰', match: (r: string[]) => r[0] === 'library'},
  {hash: '#/tutor', label: 'Tutor', icon: '✎', match: (r: string[]) => r[0] === 'tutor' || r[0] === 'improvements'},
];

const route = () => window.location.hash.replace(/^#\/?/, '').split('/');

function SignIn({onSignedIn}: {onSignedIn: () => void}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const submit = async (value: string) => {
    try {
      await api('POST', '/api/session', {token: value.trim()});
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <main className="signin">
      <h1 className="brand">
        <img className="logo" src={logo} alt="" width={40} height={40} />
        lectio
      </h1>
      <p className="muted">A lesson a day, from a tutor that learns how you learn. Sign in with a token for <code>you</code>:</p>
      <pre className="hint-box">lectio token you</pre>
      <form
        onSubmit={e => {
          e.preventDefault();
          void submit(token);
        }}
      >
        <input autoFocus placeholder="lc_…" value={token} onChange={e => setToken(e.target.value)} aria-label="token" />
        <button className="primary" type="submit" disabled={token.trim() === ''}>
          Sign in
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

function Page({parts}: {parts: string[]}) {
  const [head, id] = parts;
  switch (head) {
    case 'lesson':
      return <LessonView key={id} id={id ?? ''} />;
    case 'quiz':
      return <QuizView key={id} id={id ?? ''} />;
    case 'subjects':
      return id === 'new' ? <NewSubjectView /> : <SubjectsView />;
    case 'subject':
      return <SubjectView key={id} id={id ?? ''} />;
    case 'progress':
      return <ProgressView />;
    case 'library':
      return <LibraryView />;
    case 'tutor':
      return <TutorView />;
    case 'improvements':
      return <ImprovementsView />;
    default:
      return <TodayView />;
  }
}

/** How many proposals wait on you: a dot on the Tutor tab. */
function useImprovementsBadge(tick: number, signedIn: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!signedIn) return;
    get<{improvements: number}>('/api/today')
      .then(t => setCount(t.improvements))
      .catch(() => undefined);
  }, [tick, signedIn]);
  return count;
}

export function App() {
  const [who, setWho] = useState<WhoAmI | null | undefined>(undefined);
  const [parts, setParts] = useState<string[]>(route);
  const [tick, setTick] = useState(0);
  const [toastText, setToastText] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      setWho(await get<WhoAmI>('/api/whoami'));
    } catch {
      setWho(null);
    }
  }, []);

  // A link with ?token=… signs this browser in once, then forgets the token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token === null) {
      void load();
      return;
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    api('POST', '/api/session', {token})
      .catch(() => undefined)
      .finally(() => void load());
  }, [load]);

  useEffect(() => {
    const onHash = () => {
      setParts(route());
      window.scrollTo({top: 0});
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Live updates: any change anywhere bumps the tick, debounced.
  useEffect(() => {
    if (!who) return;
    const source = new EventSource('/api/events');
    let pending: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener('change', () => {
      clearTimeout(pending);
      pending = setTimeout(() => setTick(t => t + 1), 150);
    });
    source.addEventListener('hello', () => setTick(t => t + 1));
    return () => {
      clearTimeout(pending);
      source.close();
    };
  }, [who]);

  const shared = useMemo<Shared | null>(
    () =>
      who
        ? {
            who,
            tick,
            toast(message) {
              clearTimeout(toastTimer.current);
              setToastText(message);
              toastTimer.current = setTimeout(() => setToastText(undefined), 3500);
            },
          }
        : null,
    [who, tick],
  );

  const badge = useImprovementsBadge(tick, who !== undefined && who !== null);
  if (who === undefined) return <main className="loading">…</main>;
  if (who === null || shared === null) return <SignIn onSignedIn={() => void load()} />;

  return (
    <SharedContext.Provider value={shared}>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="#/">
            <img className="logo" src={logo} alt="" width={26} height={26} />
            lectio
          </a>
          <nav className="tabs-top">
            {TABS.map(t => (
              <a key={t.hash} href={t.hash} className={t.match(parts) ? 'active' : ''}>
                {t.label}
                {t.label === 'Tutor' && badge > 0 && <span className="dot" aria-label={`${badge} improvements need you`} />}
              </a>
            ))}
          </nav>
        </header>
        <main className="content">
          <Page parts={parts} />
        </main>
        <nav className="tabs-bottom">
          {TABS.map(t => (
            <a key={t.hash} href={t.hash} className={t.match(parts) ? 'active' : ''}>
              <span aria-hidden>{t.icon}</span>
              {t.label}
              {t.label === 'Tutor' && badge > 0 && <span className="dot" aria-label={`${badge} improvements need you`} />}
            </a>
          ))}
        </nav>
        {toastText && (
          <div className="toast" role="status">
            {toastText}
          </div>
        )}
      </div>
    </SharedContext.Provider>
  );
}
