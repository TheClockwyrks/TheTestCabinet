/**
 * The failure type, the failure codes, and the small values every other module speaks in.
 *
 * Every module's failures are the one `gg.core.ApiError`.
 *
 * @ggmodule core
 */
package gg.core

/**
 * A gg call that failed.
 *
 * Every function in this SDK raises it. It is a `RuntimeException`, so it is unchecked. A `catch`
 * branches on [code], which is an enum entry rather than free text.
 *
 * `message` is `` `operation` failed (code): what went wrong ``. [detail] is that sentence without
 * the operation and the code.
 *
 * @property operation The gg call that failed, under gg's own name for it (`open_text`,
 *   `open_docs_view`).
 * @property code The failure class.
 * @property detail What went wrong, in gg's own words alone.
 */
public class ApiError(
    public val operation: String,
    public val code: ApiErrorCode,
    public val detail: String,
) : RuntimeException("`" + operation + "` failed (" + code.wireName + "): " + detail)

/**
 * Why a gg call failed — the [ApiError.code] a catch site branches on.
 *
 * The set is gg's own and is closed. A code this SDK has no entry for reads as [OTHER].
 *
 * @property wireName gg's own spelling of the code.
 */
public enum class ApiErrorCode(public val wireName: String) {
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
        fun of(wire: String): ApiErrorCode = entries.firstOrNull { it.wireName == wire } ?: OTHER
    }
}

/**
 * One field of a revision that can be cleared as well as replaced.
 *
 * `Patch.Replace(value)` replaces the field, `Patch.Clear` empties it, and leaving the argument out
 * keeps what is there.
 *
 * ```
 * val rewritten = gg.core.Patch.Replace("read the manifest first")
 * val emptied = gg.core.Patch.Clear
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

