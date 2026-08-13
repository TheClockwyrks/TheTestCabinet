package gg;

/**
 * The exception every gg call throws when it fails.
 *
 * <p>A failure is thrown rather than returned because Java is an exception language: the common path
 * reads as a straight line, and only the calls expected to fail are wrapped. It is unchecked for the
 * same reason — a checked exception would put a {@code try} around every line of a composed program.
 *
 * <pre>{@code
 * try {
 *     Views.openText("notes", Files.readTextFile("NOTES.md"));
 * } catch (ToolError failure) {
 *     if (failure.code() != ToolErrorCode.NOT_FOUND) {
 *         throw failure;
 *     }
 *     Views.openText("notes", "there are no notes yet");
 * }
 * }</pre>
 *
 * <p>An unexpected one is best left to escape: gg reports which call failed, with the stack, and the
 * turn is recoverable.
 */
public final class ToolError extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final String tool;
    private final ToolErrorCode code;

    /**
     * Build one, which is what this SDK's bridge does when a call comes back a failure.
     *
     * @param tool the gg tool that failed, under gg's own name for it
     * @param code the class of failure
     * @param message what went wrong, in gg's words
     */
    public ToolError(String tool, ToolErrorCode code, String message) {
        super(message);
        this.tool = tool;
        this.code = code;
    }

    /**
     * The call that failed, by the key of the operation this program reached for.
     *
     * <p>{@code read_file} for {@code Files.readFile}, {@code read_text_file} for
     * {@code Files.readTextFile}.
     *
     * @return gg's own key for the call
     */
    public String tool() {
        return tool;
    }

    /**
     * The failure class, so a catch site branches on a value rather than on prose.
     *
     * @return why the call failed
     */
    public ToolErrorCode code() {
        return code;
    }
}
