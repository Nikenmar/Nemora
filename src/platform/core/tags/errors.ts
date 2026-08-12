export type TagIoErrorCode =
  | 'read-failed'
  | 'parse-failed'
  | 'corrupt-input'
  | 'mutation-failed'
  | 'validation-failed'
  | 'atomic-write-failed';

export class TagIoError extends Error {
  readonly code: TagIoErrorCode;
  readonly path: string;
  override readonly cause: unknown;

  constructor(code: TagIoErrorCode, path: string, message: string, cause?: unknown) {
    // The cause goes in the message, not only in the property. Loggers and
    // toasts print `error.message`; a wrapper that keeps the real reason in a
    // field nobody reads turns a specific failure into "something went wrong".
    const reason = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause);
    super(reason ? `${message}: ${path} (${reason})` : `${message}: ${path}`);
    this.name = 'TagIoError';
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}
