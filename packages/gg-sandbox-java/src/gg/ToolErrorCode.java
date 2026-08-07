package gg;

/**
 * Why a gg call failed — the {@code code} on a {@link ToolError}, and the value a catch site
 * branches on instead of matching on prose.
 */
public enum ToolErrorCode {
    /**
     * The arguments were malformed, ill-typed, or out of range — including a path that is absolute
     * or climbs out of the workspace, and an agent name this run does not declare.
     */
    INVALID_ARGUMENT("invalid-argument"),
    /**
     * The named file, skill, memory, task, epic, issue, subagent, stored program, or documentation
     * entry does not exist.
     */
    NOT_FOUND("not-found"),
    /**
     * Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle, a
     * duplicate id, a subagent that already returned.
     */
    CONFLICT("conflict"),
    /**
     * gg refused the call on a rule about your state: a compaction in flight that this call is not
     * the one it asked for, a memory call while your memories are read-only, a second ending or
     * hand-over in a turn that already declared one, or a hook that blocked it. A ceiling you ran
     * into is {@link #LIMIT_EXCEEDED}, not this.
     */
    REFUSED("refused"),
    /** The call exists but this run's capability set does not offer it. */
    UNAVAILABLE("unavailable"),
    /**
     * A gg-side ceiling was hit: a shell timeout, a store cap, the delegation depth cap, one of the
     * view caps this program spends, or the run's wall-clock budget.
     */
    LIMIT_EXCEEDED("limit-exceeded"),
    /** The underlying I/O or process failed. */
    IO_ERROR("io-error"),
    /**
     * The failure was not classified. Reserved for outcomes raised outside a tool implementation;
     * nothing you call produces it.
     */
    OTHER("other");

    private final String wire;

    ToolErrorCode(String wire) {
        this.wire = wire;
    }

    /**
     * gg's own spelling of this code, which is what a run record and the tool-calling arm both
     * report.
     *
     * @return the hyphenated name gg uses on the wire
     */
    public String wireName() {
        return wire;
    }

    /**
     * The code a wire spelling names, or {@link #OTHER} for one this SDK has no arm for.
     *
     * <p>The set is gg's and is closed; a program reading a code it has no arm for is better off
     * with the unclassified one than with a crash.
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
