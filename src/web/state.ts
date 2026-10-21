/**
 * What every view shares: who is signed in, a counter that ticks whenever the server
 * reports a change, a way to say something briefly, and navigation.
 */
import {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {get, type WhoAmI} from './api.ts';

export interface Shared {
  who: WhoAmI;
  /** Goes up on every server event: views refetch when it changes. */
  tick: number;
  toast(message: string): void;
}

export const SharedContext = createContext<Shared | null>(null);

export function useShared(): Shared {
  const shared = useContext(SharedContext);
  if (shared === null) throw new Error('useShared outside the app');
  return shared;
}

/** Fetch on mount and whenever the tick moves (unless `live` is false). */
export function useLoad<T>(path: string | null, options: {live?: boolean} = {}): {data: T | undefined; error: string | undefined; reload: () => void} {
  const {tick} = useShared();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  const live = options.live ?? true;
  useEffect(() => {
    if (path === null) return;
    let alive = true;
    get<T>(path)
      .then(result => {
        if (alive) {
          setData(result);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [path, live ? tick : 0, nonce]);
  return {data, error, reload};
}

export function go(hash: string): void {
  window.location.hash = hash;
}

export function ago(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export const pct = (rate: number | null | undefined) => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

export function dayLabel(day: string, today: string): string {
  if (day === today) return 'today';
  const date = new Date(`${day}T12:00:00Z`);
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - date.getTime()) / 86_400_000);
  if (diff === 1) return 'yesterday';
  return date.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'});
}

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
