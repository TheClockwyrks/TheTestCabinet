/**
 * The types every other capability module speaks in.
 *
 * A failure is one type and one type only, so a program that handles `ToolError` handles every call
 * this surface offers. Nothing here is a call: this module exists for the sake of the names its types
 * are qualified by.
 */

/**
 * Why a call failed, as the `code` on a thrown `ToolError`.
 *
 * A catch site branches on this rather than on the message, which is prose and free to be reworded.
 */
export type ToolErrorCode =
  /**
   * The arguments were malformed, ill-typed, or out of range.
   *
   * A path that is absolute or climbs out of the workspace and an agent name the run does not
   * declare both land here.
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
   * gg refused the call on a rule about the agent's state rather than about its arguments.
   *
   * A compaction in flight that this call is not the one it asked for, a memory call while memories
   * are read-only, a second ending in one turn, and a hook that blocked the call are the cases. A
   * ceiling that was reached is `limit-exceeded` instead.
   */
  | "refused"
  /**
   * The call exists and this run's capability set does not offer it.
   *
   * A withheld function is absent from a program's scope entirely, so this is the host's backstop
   * for a name a program reached anyway.
   */
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
   * Reserved for outcomes raised outside a tool implementation, which is gg's own bridge and
   * degradation paths; nothing on this surface produces it.
   */
  | "other";

/**
 * A gg call that failed, thrown by every function on this surface.
 *
 * `catch (error) { if (error instanceof ToolError) … }` is the shape that reads `tool` and `code`; an
 * uncaught one ends the program and is reported back with the line it was thrown on.
 */
export class ToolError extends Error {
  /**
   * The call that failed, by the key of the operation this program reached for.
   *
   * `read_file` for `gg.files.readFile`, `read_text_file` for `gg.files.readTextFile`, `open_file`
   * for `gg.views.openFile`.
   */
  readonly tool: string;

  /** The failure class, so a catch site branches on a value rather than on prose. */
  readonly code: ToolErrorCode;

  /** @internal Not model-facing: the SDK constructs these; a program only catches them. */
  constructor(tool: string, code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.tool = tool;
    this.code = code;
  }

  /**
   * The failure as a plain object, so that serializing one keeps its message.
   *
   * `Error.prototype.message` is not enumerable, so without this a failure folded into a logged
   * structure would serialize to an empty object and lose the one field worth reading.
   */
  toJSON(): { name: string; tool: string; code: ToolErrorCode; message: string } {
    return { name: this.name, tool: this.tool, code: this.code, message: this.message };
  }
}

