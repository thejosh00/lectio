/**
 * A CLI command is a mapping: flags → one HTTP call → text for a person.
 *
 * With `--json` the server's envelope is printed as it came, so the CLI and the API
 * cannot disagree about shapes. The one exception is the interactive quiz, which makes
 * one call per answer.
 */
import type {ParsedArgs} from '../core/args.ts';
import type {ApiCall, ApiResult} from '../client.ts';

export interface CommandIO {
  readStdin(): Promise<string>;
  /** Read a file the command names (`--file lesson.json`). */
  readFile(path: string): Promise<string>;
  /** The same, as bytes (`asset put picture.png`). */
  readBytes(path: string): Promise<Uint8Array>;
  env: Record<string, string | undefined>;
  /** For commands that must read before they write (`notes edit`), and the quiz. */
  call(call: ApiCall): Promise<ApiResult>;
  /** Open text in the user's editor and return what they saved. */
  edit(text: string): Promise<string>;
  /** One line typed by the learner; undefined at the end of input. */
  readLine(prompt: string): Promise<string | undefined>;
  out(line?: string): void;
  /** Shuffle for display. Injected so tests can fix the order. */
  shuffle<T>(items: readonly T[]): T[];
  /** A clock for timing answers, in milliseconds. */
  clock(): number;
}

export type Audience = 'learner' | 'tutor' | 'builder' | 'anyone';

export interface CommandDef {
  /** One or more words: `today`, `lesson submit`, `run start`. */
  name: string;
  summary: string;
  usage: string;
  /** Whose command it is, for grouping the help. */
  audience: Audience;
  /** Flags that take a value. */
  values?: readonly string[];
  /** Flags that take none. */
  booleans?: readonly string[];
  alias?: Readonly<Record<string, string>>;
  build(args: ParsedArgs, io: CommandIO): ApiCall | Promise<ApiCall>;
  human(body: Record<string, unknown>, args: ParsedArgs): string | string[];
  /** A command that talks to the server more than once (the quiz). Returns the exit code. */
  interactive?(args: ParsedArgs, io: CommandIO, json: boolean): Promise<number>;
}

export class CommandUsage extends Error {}
