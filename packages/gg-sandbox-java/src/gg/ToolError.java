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
 * <p>An unexpected one is best left to escape: the program dies the way its runtime kills it, and
 * what the model reads is the runtime's own dying words — this exception's message, then the stack,
 * in the program's own file and lines. That is why {@link #getMessage()} is
 * <b>{@code `tool` failed (code): what went wrong}</b> rather than gg's sentence alone: an uncaught
 * failure has no second channel to carry the call's name and its class on, and every arm of a study
 * reports one in that same shape. {@link #detail()} is the sentence without them.
 */
public final class ToolError extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final String tool;
    private final ToolErrorCode code;
    private final String detail;

    /**
     * Build one, which is what this SDK's bridge does when a call comes back a failure.
     *
     * @param tool the gg tool that failed, under gg's own name for it
     * @param code the class of failure
     * @param message what went wrong, in gg's words
     */
    public ToolError(String tool, ToolErrorCode code, String message) {
        super("`" + tool + "` failed (" + code.wireName() + "): " + message);
        this.tool = tool;
        this.code = code;
        this.detail = message;
    }

    /**
     * What went wrong, in gg's own words alone.
     *
     * <p>Without the call's name and its class, which {@link #getMessage()} carries in front of
     * them so that an uncaught failure names all three.
     *
     * @return gg's own sentence about the failure
     */
    public String detail() {
        return detail;
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
