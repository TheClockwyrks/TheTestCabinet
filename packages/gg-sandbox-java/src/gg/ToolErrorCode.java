package gg;

/**
 * Why a gg call failed, as a value a catch site branches on rather than prose it has to match.
 *
 * <p>The set is gg's and is closed. A code this SDK has no constant for arrives as {@link #OTHER}
 * rather than as a crash, because a program that cannot name a failure can still handle it.
 */
public enum ToolErrorCode {
    /**
     * The arguments were malformed, ill-typed, or out of range.
     *
     * <p>A path that climbs out of the workspace and an agent name this run does not declare are
     * both this.
     */
    INVALID_ARGUMENT("invalid-argument"),
    /**
     * The named thing does not exist.
     *
     * <p>A file, a skill, a memory, a task, an epic, an issue, a subagent, a stored program, or a
     * documentation entry.
     */
    NOT_FOUND("not-found"),
    /**
     * Well-formed, but in conflict with the current state.
     *
     * <p>An ambiguous edit, a dependency cycle, a duplicate id, a subagent that has already
     * returned.
     */
    CONFLICT("conflict"),
    /**
     * gg refused the call on a rule about the session's state.
     *
     * <p>A compaction in flight that this call is not the one it asked for, a memory call while
     * memories are read-only, a second ending or hand-over in one turn, or a hook that blocked it. A
     * ceiling that was hit is {@link #LIMIT_EXCEEDED} rather than this.
     */
    REFUSED("refused"),
    /** The call exists, and this run's capability set does not offer it. */
    UNAVAILABLE("unavailable"),
    /**
     * A gg-side ceiling was hit.
     *
     * <p>A shell timeout, a store cap, the delegation depth cap, or the run's wall-clock budget.
     */
    LIMIT_EXCEEDED("limit-exceeded"),
    /** The underlying I/O or process failed. */
    IO_ERROR("io-error"),
    /**
     * The failure was not classified.
     *
     * <p>Reserved for outcomes raised outside a tool implementation; nothing in this SDK produces
     * one.
     */
    OTHER("other");

    private final String wire;

    ToolErrorCode(String wire) {
        this.wire = wire;
    }

    /**
     * gg's own spelling of this code, which is what a run record reports.
     *
     * @return the hyphenated name gg uses on the wire
     */
    public String wireName() {
        return wire;
    }

    /**
     * The code a wire spelling names, or {@link #OTHER} for one this SDK has no constant for.
     *
     * @param wire the hyphenated name gg used on the wire
     * @return the matching code, or {@link #OTHER}
     */
    public static ToolErrorCode of(String wire) {
        for (ToolErrorCode code : values()) {
            if (code.wire.equals(wire)) {
                return code;
            }
        }
        return OTHER;
    }
}
