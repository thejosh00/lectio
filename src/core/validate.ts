/**
 * Reading untrusted JSON, collecting every problem with the path it is at.
 *
 * Submissions are validated all or nothing, and the tutor fixes them in one pass, so a
 * validator never stops at the first problem: it walks the whole value, records an
 * `Issue` for each thing wrong ("blocks[3].body.alt: is required"), and returns what it
 * could read. Pure.
 */

export interface Issue {
  path: string;
  message: string;
}

export const formatIssue = (issue: Issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`);

export type Result<T> = {ok: true; value: T} | {ok: false; issues: Issue[]};

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function joinPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  const part = IDENT.test(key) ? key : `[${JSON.stringify(key)}]`;
  if (base === '' || part.startsWith('[')) return `${base}${part}`;
  return `${base}.${part}`;
}

export const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export interface StringOptions {
  /** Default 1: required strings must not be blank. Use 0 to allow ''. */
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternMessage?: string;
}

/** One place in a JSON value, and the shared list its problems go to. */
export class Node {
  constructor(
    readonly value: unknown,
    readonly path: string,
    readonly issues: Issue[],
  ) {}

  static root(value: unknown, path = '', issues: Issue[] = []): Node {
    return new Node(value, path, issues);
  }

  get present(): boolean {
    return this.value !== undefined && this.value !== null;
  }

  get(key: string): Node {
    const value = typeof this.value === 'object' && this.value !== null && !Array.isArray(this.value) ? (this.value as Record<string, unknown>)[key] : undefined;
    return new Node(value, joinPath(this.path, key), this.issues);
  }

  fail(message: string): undefined {
    this.issues.push({path: this.path, message});
    return undefined;
  }

  /** An object, flagging keys outside `allowed` (a typo is better caught now than ignored). */
  object(allowed?: readonly string[]): Record<string, unknown> | undefined {
    if (!this.present) return this.fail('is required');
    if (typeof this.value !== 'object' || Array.isArray(this.value)) return this.fail('must be an object');
    const value = this.value as Record<string, unknown>;
    if (allowed !== undefined) {
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) this.issues.push({path: joinPath(this.path, key), message: `is not a field here; expected ${allowed.join(', ')}`});
      }
    }
    return value;
  }

  string(options: StringOptions = {}): string | undefined {
    if (!this.present) return this.fail('is required');
    if (typeof this.value !== 'string') return this.fail('must be a string');
    const min = options.min ?? 1;
    if (this.value.trim().length < min) return this.fail(min === 1 ? 'must not be empty' : `must be at least ${min} characters`);
    if (options.max !== undefined && this.value.length > options.max) return this.fail(`is ${this.value.length} characters; the most is ${options.max}`);
    if (options.pattern !== undefined && !options.pattern.test(this.value)) return this.fail(options.patternMessage ?? `must match ${options.pattern}`);
    return this.value;
  }

  optionalString(options: StringOptions = {}): string | undefined {
    return this.present ? this.string({min: 0, ...options}) : undefined;
  }

  number(options: {min?: number; max?: number; integer?: boolean} = {}): number | undefined {
    if (!this.present) return this.fail('is required');
    if (typeof this.value !== 'number' || !Number.isFinite(this.value)) return this.fail('must be a number');
    if (options.integer === true && !Number.isInteger(this.value)) return this.fail('must be a whole number');
    if (options.min !== undefined && this.value < options.min) return this.fail(`must be at least ${options.min}`);
    if (options.max !== undefined && this.value > options.max) return this.fail(`must be at most ${options.max}`);
    return this.value;
  }

  optionalNumber(options: {min?: number; max?: number; integer?: boolean} = {}): number | undefined {
    return this.present ? this.number(options) : undefined;
  }

  boolean(): boolean | undefined {
    if (!this.present) return this.fail('is required');
    if (typeof this.value !== 'boolean') return this.fail('must be true or false');
    return this.value;
  }

  optionalBoolean(): boolean | undefined {
    return this.present ? this.boolean() : undefined;
  }

  oneOf<T extends string>(values: readonly T[]): T | undefined {
    if (!this.present) return this.fail(`is required: one of ${values.join(', ')}`);
    if (typeof this.value !== 'string' || !values.includes(this.value as T)) return this.fail(`must be one of ${values.join(', ')}`);
    return this.value as T;
  }

  /** The elements, each as a node; undefined (and an issue) if this isn't an array. */
  array(options: {min?: number; max?: number} = {}): Node[] | undefined {
    if (!this.present) return this.fail('is required');
    if (!Array.isArray(this.value)) return this.fail('must be a list');
    const value = this.value as unknown[];
    if (options.min !== undefined && value.length < options.min) {
      return this.fail(options.min === 1 ? 'must not be empty' : `must have at least ${options.min} entries`);
    }
    if (options.max !== undefined && value.length > options.max) return this.fail(`has ${value.length} entries; the most is ${options.max}`);
    return value.map((v, i) => new Node(v, joinPath(this.path, i), this.issues));
  }

  optionalArray(options: {min?: number; max?: number} = {}): Node[] {
    return this.present ? (this.array(options) ?? []) : [];
  }

  /** A list of non-empty strings: `min`/`max` bound the list, `item` each string. */
  stringArray(options: {min?: number; max?: number; item?: StringOptions} = {}): string[] | undefined {
    const items = this.array({min: options.min, max: options.max});
    if (items === undefined) return undefined;
    const out: string[] = [];
    for (const item of items) {
      const value = item.string(options.item);
      if (value !== undefined) out.push(value);
    }
    return out;
  }
}

export function result<T>(issues: Issue[], value: T | undefined): Result<T> {
  return issues.length === 0 && value !== undefined ? {ok: true, value} : {ok: false, issues: issues.length === 0 ? [{path: '', message: 'is not valid'}] : issues};
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
