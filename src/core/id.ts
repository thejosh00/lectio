/**
 * Ids for everything the app stores: a 12-character lowercase Crockford base32 id, 7
 * characters of Unix seconds then 5 random, so ids sort by creation time.
 *
 * Nothing here reads the clock or generates randomness; both are parameters.
 */

/** Crockford base32: the digits, minus `i`, `l`, `o` and `u`. */
export const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ID_LENGTH = 12;

const TIME_CHARS = 7;
const RANDOM_CHARS = 5;
const RADIX = ID_ALPHABET.length;
const TIME_CAPACITY = RADIX ** TIME_CHARS;
const RANDOM_CAPACITY = RADIX ** RANDOM_CHARS;

function encode(value: number, chars: number): string {
  let out = '';
  let v = Math.floor(value);
  for (let i = 0; i < chars; i++) {
    out = ID_ALPHABET[v % RADIX]! + out;
    v = Math.floor(v / RADIX);
  }
  return out;
}

/** Mint an id. `random` supplies at least 4 bytes of entropy. */
export function mintId(nowMs: number, random: Uint8Array): string {
  const seconds = Math.floor(nowMs / 1000);
  if (seconds < 0 || seconds >= TIME_CAPACITY) throw new RangeError(`timestamp ${nowMs} is out of range for an id`);
  let entropy = 0;
  for (let i = 0; i < 4; i++) entropy = entropy * 256 + (random[i] ?? 0);
  return encode(seconds, TIME_CHARS) + encode(entropy % RANDOM_CAPACITY, RANDOM_CHARS);
}

/** Fold case and Crockford's ambiguous characters, the way a person might type an id. */
export function foldAmbiguous(value: string): string {
  return value.trim().toLowerCase().replace(/[il]/g, '1').replace(/o/g, '0');
}

export type PrefixResolution = {kind: 'ok'; id: string} | {kind: 'none'} | {kind: 'ambiguous'; candidates: string[]};

/** Resolve a possibly-abbreviated id the way git resolves a short hash. */
export function resolveIdPrefix(ids: Iterable<string>, prefix: string): PrefixResolution {
  const needle = foldAmbiguous(prefix);
  if (needle.length === 0) return {kind: 'none'};
  const exact: string[] = [];
  const prefixed: string[] = [];
  for (const id of ids) {
    if (id === needle) exact.push(id);
    else if (id.startsWith(needle)) prefixed.push(id);
  }
  if (exact.length === 1) return {kind: 'ok', id: exact[0]!};
  if (prefixed.length === 1) return {kind: 'ok', id: prefixed[0]!};
  if (prefixed.length > 1) return {kind: 'ambiguous', candidates: prefixed.sort()};
  return {kind: 'none'};
}
