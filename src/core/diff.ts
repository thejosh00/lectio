/**
 * A line diff, for showing what changed between two versions of a document (the playbook's
 * history, M13). Longest common subsequence over lines: small documents, so the quadratic
 * table is fine. Pure.
 */

export interface DiffLine {
  op: 'same' | 'add' | 'del';
  line: string;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({length: a.length + 1}, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({op: 'same', line: a[i]!});
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({op: 'del', line: a[i++]!});
    else out.push({op: 'add', line: b[j++]!});
  }
  while (i < a.length) out.push({op: 'del', line: a[i++]!});
  while (j < b.length) out.push({op: 'add', line: b[j++]!});
  return out;
}
