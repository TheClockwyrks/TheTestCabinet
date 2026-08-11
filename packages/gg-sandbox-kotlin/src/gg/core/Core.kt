/**
 * The failure type, the failure codes, and the small values every other module speaks in.
 *
 * It catalogues no capability of its own. What it holds is the vocabulary the other twelve modules
 * share, gathered here so that no module has to reach into another to name a failure — and so that a
 * program catching one writes a single `import gg.core.ToolError` rather than one per module it
 * calls. The session-wide `lib` namespace sits here for the same reason: a code module arrives from
 * a skill or from a memory, so it belongs to neither.
 *
 * @ggmodule core
 */
package gg.core

/**
 * A gg call that failed.
 *
 * Every function in this SDK raises it. A `catch` branches on [code], which is an enum entry rather
 * than free text, so the branch is checked by the compiler:
 *
 * ```
 * try {
 *     gg.views.openText("notes", gg.files.readTextFile("notes.md"))
 * } catch (failure: gg.core.ToolError) {
 *     if (failure.code == gg.core.ToolErrorCode.NOT_FOUND) gg.files.writeFile("notes.md", "")
 *     else throw failure
 * }
 * ```
 *
 * It is a [RuntimeException], which is what Kotlin makes every exception: this language has no
 * checked exceptions, so a composed program is not forced into a `try` around every line, and a
 * surface that returned a `Result` from each call would force a branch after every line instead.
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
 * Why a gg call failed — the [ToolError.code] a catch site branches on.
 *
 * The set is gg's own and is closed. A code this SDK has no entry for reads as [OTHER] rather than
 * failing the read, because a program handed an unclassified failure is better placed than a program
 * handed a crash.
 *
 * @property wireName gg's own spelling of the code, which a run record and the tool-calling arm both
 *   report.
 */
public enum class ToolErrorCode(public val wireName: String) {
    /**
     * The arguments were malformed, ill-typed, or out of range.
     *
     * A path that is absolute or climbs out of the workspace is this, and so is an agent name the
     * run does not declare.
     */
    INVALID_ARGUMENT("invalid-argument"),

    /**
     * The named thing does not exist.
     *
     * A file, skill, memory, task, epic, issue, subagent, stored program or documentation entry all
     * report their absence this way.
     */
    NOT_FOUND("not-found"),

    /**
     * Well-formed, and in conflict with the current state.
     *
     * An ambiguous edit, a dependency cycle, a duplicate id and a subagent that has already returned
     * are each this.
     */
    CONFLICT("conflict"),

    /**
     * gg refused the call on a rule about the session's state.
     *
     * A compaction in flight that this call is not the one it asked for, a memory write while the
     * memories are read-only, a second ending or hand-over in one turn, and a hook that blocked the
     * call are each this. A ceiling that was reached is [LIMIT_EXCEEDED] instead.
     */
    REFUSED("refused"),

    /** The call exists and this run's capability set does not offer it. */
    UNAVAILABLE("unavailable"),

    /**
     * A gg-side ceiling was reached.
     *
     * A shell timeout, a store cap, the delegation depth cap, one of the view caps a program spends,
     * and the run's wall-clock budget are each this.
     */
    LIMIT_EXCEEDED("limit-exceeded"),

    /** The underlying input, output or process failed. */
    IO_ERROR("io-error"),

    /**
     * The failure was not classified.
     *
     * Reserved for outcomes raised outside a tool implementation; nothing in this SDK produces it.
     */
    OTHER("other"),

    ;

    internal companion object {
        /**
         * The code a wire spelling names, or [OTHER] for one this SDK has no arm for.
         *
         * The set is gg's and is closed; a program reading a code it has no arm for is better off
         * with the unclassified one than with a crash.
         */
        fun of(wire: String): ToolErrorCode = entries.firstOrNull { it.wireName == wire } ?: OTHER
    }
}

/**
 * One field of a revision that can be cleared as well as replaced.
 *
 * Most of what `gg.tasks.updateTask` and `gg.board.updateIssue` take is two-way: naming a field
 * replaces it and leaving it out keeps it. A description, and an issue's epic, are three-way — kept,
 * replaced, or emptied — and `null` is already spoken for by the second of those, since leaving an
 * argument out is passing `null` in this language. So the third state is a value rather than a
 * sentinel, which is what a sealed type is for:
 *
 * ```
 * gg.tasks.updateTask("parse", description = gg.core.Patch.Replace("read the manifest first"))
 * gg.board.updateIssue("AUTH-1", epicId = gg.core.Patch.Clear)
 * ```
 */
public sealed interface Patch<out T> {
    /**
     * Replace the field with [value].
     *
     * @property value What to put there instead of what is there now.
     */
    public data class Replace<out T>(val value: T) : Patch<T>

    /** Empty the field, leaving it with nothing. */
    public data object Clear : Patch<Nothing>
}

