/**
 * Exit codes, the JSON envelope, and the one error type the server reports.
 *
 * The CLI prints the envelope for `--json` on success and failure alike, with stderr
 * empty, so an agent parses one stream and checks `ok`.
 */

export const EXIT_OK = 0;
/** The command ran and failed: a cap, a subject that isn't ready, a refused write. */
export const EXIT_ERROR = 1;
/** Bad command or usage, an invalid submission, or not allowed for this actor. */
export const EXIT_USAGE = 2;
export const EXIT_NOT_FOUND = 3;
/** The server is unreachable or busy. Distinct so a caller can stop or retry. */
export const EXIT_UNAVAILABLE = 4;

export interface Failure {
  ok: false;
  error: string;
  code: number;
  [key: string]: unknown;
}

export function failure(error: string, code: number, extra: Record<string, unknown> = {}): Failure {
  return {ok: false, error, code, ...extra};
}

/** What a handler throws to report a failure; the router turns it into an envelope. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: number = EXIT_ERROR,
    readonly extra: Record<string, unknown> = {},
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const usageError = (message: string, extra: Record<string, unknown> = {}) => new AppError(message, EXIT_USAGE, extra);
export const notFound = (message: string, extra: Record<string, unknown> = {}) => new AppError(message, EXIT_NOT_FOUND, extra);
export const failed = (message: string, extra: Record<string, unknown> = {}) => new AppError(message, EXIT_ERROR, extra);

/** Refused because of who is asking. `whose` says who may do it instead. */
export const refused = (what: string, whose: string) =>
  new AppError(`${what} is ${whose} to do; this token cannot do it`, EXIT_USAGE, {refused: true}, 403);

export function httpStatusFor(error: AppError): number {
  if (error.status !== undefined) return error.status;
  switch (error.code) {
    case EXIT_USAGE:
      return 400;
    case EXIT_NOT_FOUND:
      return 404;
    case EXIT_UNAVAILABLE:
      return 503;
    default:
      return 422;
  }
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
