/**
 * How typed answers are compared: NFKC, trimmed, whitespace collapsed, surrounding
 * punctuation stripped, and lowercased unless the question is case-sensitive. So
 * "  The Owner. " and "the owner" are the same answer, and "C++" keeps its pluses
 * (they are symbols, not punctuation).
 */

const SURROUNDING_PUNCTUATION = /^[\p{P}\s]+|[\p{P}\s]+$/gu;

export function normalizeAnswer(text: string, caseSensitive = false): string {
  const folded = text.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(SURROUNDING_PUNCTUATION, '');
  return caseSensitive ? folded : folded.toLowerCase();
}

/** Whether a typed answer matches any accepted answer or any whole-answer pattern. */
export function textMatches(answer: string, accept: readonly string[], patterns: readonly string[], caseSensitive = false): boolean {
  const given = normalizeAnswer(answer, caseSensitive);
  if (given === '') return false;
  if (accept.some(a => normalizeAnswer(a, caseSensitive) === given)) return true;
  return patterns.some(p => new RegExp(`^(?:${p})$`, caseSensitive ? 'u' : 'iu').test(given));
}

/** A pattern the tutor wrote, checked before it is stored. Undefined if it compiles. */
export function patternProblem(pattern: string): string | undefined {
  try {
    new RegExp(`^(?:${pattern})$`, 'u');
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * A number as someone might type it: "3.5", "-2", "1,000", "1e3", "12 ms". The unit, if
 * the question has one, may follow. Undefined if it isn't a number.
 */
export function parseNumber(text: string, unit?: string | null): number | undefined {
  let t = text.normalize('NFKC').trim();
  if (unit !== undefined && unit !== null && unit !== '' && t.toLowerCase().endsWith(unit.toLowerCase())) t = t.slice(0, -unit.length).trim();
  t = t.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\s+/g, '').replace(/^\+/, '').replace(/−/g, '-');
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
