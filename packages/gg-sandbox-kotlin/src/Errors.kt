/**
 * A gg call that failed.
 *
 * Thrown by every function in this SDK. Catch it when a failure is expected and branch on [code]; let it
 * escape when it is not, and gg reports which call failed and where your program was.
 *
 * ```
 * try {
 *     view.openText("notes", fs.readTextFile("notes.md"))
 * } catch (failure: ToolError) {
 *     if (failure.code == ToolErrorCode.NOT_FOUND) fs.writeFile("notes.md", "") else throw failure
 * }
 * ```
 *
 * It is a [RuntimeException], which is what Kotlin makes every exception: there are no checked exceptions
 * in this language, so a composed program is not forced into a `try` around every line, and a surface
 * where every call returned a `Result` would force a branch after every line instead.
 *
 * @property tool The gg call that failed, under gg's own name for it (`read_file`, `spawn_subagent`).
 * @property code The failure class, so a catch site branches on a value rather than on prose.
 */
public class ToolError(
    public val tool: String,
    public val code: ToolErrorCode,
    message: String,
) : RuntimeException(message)

/**
 * Why a gg call failed — the `code` on a [ToolError], and the value a catch site branches on instead of
 * matching on prose.
 *
 * @property wireName gg's own spelling of this code, which is what a run record and the tool-calling arm
 *   both report.
 */
public enum class ToolErrorCode(public val wireName: String) {
    /**
     * The arguments were malformed, ill-typed, or out of range — including a path that is absolute or
     * climbs out of the workspace, and an agent name this run does not declare.
     */
    INVALID_ARGUMENT("invalid-argument"),

    /**
     * The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation entry
     * does not exist.
     */
    NOT_FOUND("not-found"),

    /**
     * Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
     * duplicate id, a subagent that already returned.
     */
    CONFLICT("conflict"),

    /**
     * gg refused the call on a rule about your state: a compaction in flight that this call is not the one
     * it asked for, a memory call while your memories are read-only, a second ending or hand-over in a
     * turn that already declared one, or a hook that blocked it. A ceiling you ran into is
     * [LIMIT_EXCEEDED], not this.
     */
    REFUSED("refused"),

    /** The call exists but this run's capability set does not offer it. */
    UNAVAILABLE("unavailable"),

    /**
     * A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the view
     * caps this program spends, or the run's wall-clock budget.
     */
    LIMIT_EXCEEDED("limit-exceeded"),

    /** The underlying I/O or process failed. */
    IO_ERROR("io-error"),

    /**
     * The failure was not classified. Reserved for outcomes raised outside a tool implementation; nothing
     * you call produces it.
     */
    OTHER("other"),

    ;

    internal companion object {
        /**
         * The code a wire spelling names, or [OTHER] for one this SDK has no arm for.
         *
         * The set is gg's and is closed; a program reading a code it has no arm for is better off with the
         * unclassified one than with a crash.
         */
        fun of(wire: String): ToolErrorCode = entries.firstOrNull { it.wireName == wire } ?: OTHER
    }
}
