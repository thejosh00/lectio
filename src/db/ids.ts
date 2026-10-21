import {mintId} from '../core/id.ts';

export function newId(nowIso?: string): string {
  const ms = nowIso === undefined ? Date.now() : new Date(nowIso).getTime();
  return mintId(ms, crypto.getRandomValues(new Uint8Array(4)));
}

/** A long random secret for tokens and session cookies. */
export function newSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}
