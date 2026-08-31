/**
 * The types every other capability module speaks in.
 *
 * Every call on this surface fails as an `ApiError`.
 */

/**
 * Why a call failed, as the `code` on a thrown `ApiError`.
 *
 * The message beside it is prose and free to be reworded; this is the value a catch site branches
 * on.
 */
export type ApiErrorCode =
  /**
   * The arguments were malformed, ill-typed, or out of range.
   *
   * An empty path, an empty view label and an agent name the run does not declare all land here.
   */
  | "invalid-argument"
  /** The named file, skill, memory, task, epic, issue, subagent, program or documentation is absent. */
  | "not-found"
  /**
   * Well formed, and in conflict with the current state.
   *
   * An ambiguous edit, a dependency cycle, a duplicate id and a subagent that already returned are
   * the four shapes of it.
   */
  | "conflict"
  /**
   * gg refused the call on a rule about the session's state rather than about its arguments.
   *
   * A compaction in flight that this call is not the one it asked for, a memory call while memories
   * are read-only, a second ending in one turn, and a hook that blocked the call are the cases. A
   * ceiling that was reached is `limit-exceeded` instead.
   */
  | "refused"
  /** The call exists and this run's capability set does not offer it. */
  | "unavailable"
  /**
   * A gg-side ceiling was reached.
   *
   * A shell timeout, a store cap, the delegation depth cap and the run's wall-clock budget all
   * report themselves this way.
   */
  | "limit-exceeded"
  /** The underlying input, output or process failed. */
  | "io-error"
  /**
   * The failure was not classified.
   *
   * Nothing on this surface produces it.
   */
  | "other";

/**
 * A gg call that failed, thrown by every function on this surface.
 *
 * An uncaught one ends the program and is reported back with the line it was thrown on.
 */
export class ApiError extends Error {
  /**
   * The call that failed, by the key of the operation this program reached for.
   *
   * gg's own `snake_case` spelling of the call, without its module.
   */
  readonly operation: string;

  /** The failure class. */
  readonly code: ApiErrorCode;

  /** @internal Not model-facing: the SDK constructs these; a program only catches them. */
  constructor(operation: string, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.operation = operation;
    this.code = code;
  }

  /** The failure as a plain object, so that serializing one keeps its message. */
  toJSON(): { name: string; operation: string; code: ApiErrorCode; message: string } {
    return { name: this.name, operation: this.operation, code: this.code, message: this.message };
  }
}

