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

/** Stroke icons for the tab bar, drawn in the current text colour. */
const ICONS: Record<string, string> = {
  Today: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  Subjects: 'M4 4h4v16H4zM9 4h4v16H9zM14.5 5.2l3.9-1 3.6 14.8-3.9 1z',
  Progress: 'M3 20h18M5 16l4.5-5 3.5 3 6-7',
  Library: 'M6 3.5h12v17l-6-4-6 4z',
  Tutor: 'M20 3.5C12 4 7 9 6 17.5L4.5 20.5M6.5 15c5 .3 9.5-2.5 11-8.5M9.5 11.5h5',
};

function TabIcon({label}: {label: string}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[label]} />
    </svg>
  );
}

const TABS = [
  {hash: '#/', label: 'Today', match: (r: string[]) => r[0] === '' || r[0] === 'lesson' || r[0] === 'quiz'},
  {hash: '#/subjects', label: 'Subjects', match: (r: string[]) => r[0] === 'subjects' || r[0] === 'subject'},
  {hash: '#/progress', label: 'Progress', match: (r: string[]) => r[0] === 'progress'},
  {hash: '#/library', label: 'Library', match: (r: string[]) => r[0] === 'library'},
  {hash: '#/tutor', label: 'Tutor', match: (r: string[]) => r[0] === 'tutor' || r[0] === 'improvements'},
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
        <img className="logo" src={logo} alt="" width={64} height={64} />
        lectio
      </h1>
      <p className="tagline">A lesson a day, from a tutor that learns how you learn.</p>
      <p className="muted">Sign in with a token for <code>you</code>. No token yet? On the computer running lectio:</p>
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

/** What waits on you: unseen replies from your tutor, and proposals (a dot on the Tutor tab). */
function useWaiting(tick: number, signedIn: boolean): {replies: number; improvements: number} {
  const [waiting, setWaiting] = useState({replies: 0, improvements: 0});
  useEffect(() => {
    if (!signedIn) return;
    get<{replies: unknown[]; improvements: number}>('/api/today')
      .then(t => setWaiting({replies: t.replies.length, improvements: t.improvements}))
      .catch(() => undefined);
  }, [tick, signedIn]);
  return waiting;
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

  const waiting = useWaiting(tick, who !== undefined && who !== null);
  const badge = waiting.improvements;
  // The browser tab shows how many messages wait, e.g. "(3) lectio".
  const messages = who ? waiting.replies + waiting.improvements : 0;
  useEffect(() => {
    document.title = messages > 0 ? `(${messages}) lectio` : 'lectio';
  }, [messages]);
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
            <a key={t.hash} href={t.hash} className={t.match(parts) ? 'active' : ''} aria-current={t.match(parts) ? 'page' : undefined}>
              <TabIcon label={t.label} />
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
