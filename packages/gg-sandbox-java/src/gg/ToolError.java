package gg;

/**
 * A gg call that failed.
 *
 * <p>Thrown by every function in this SDK. Catch it when a failure is expected and branch on
 * {@link #code()}; let it escape when it is not, and gg reports which call failed and where your
 * program was.
 *
 * <pre>{@code
 * try {
 *     String notes = fs.readTextFile("notes.md");
 *     view.openText("notes", notes);
 * } catch (ToolError failure) {
 *     if (failure.code() == ToolErrorCode.NOT_FOUND) {
 *         fs.writeFile("notes.md", "");
 *     } else {
 *         throw failure;
 *     }
 * }
 * }</pre>
 *
 * <p>It is <b>unchecked</b>, which is the Java answer to a failure that is usually fatal to what
 * you were doing: a checked exception would force a {@code try} around every line and make a
 * composed program unwritable, and a surface where every call returned a result object would do
 * the same with an {@code if}.
 */
public final class ToolError extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final String tool;
    private final ToolErrorCode code;

    /**
     * Build one. gg's own SDK raises these; a program catches them.
     *
     * @param tool the gg call that failed, under gg's own name for it
     * @param code the failure class
     * @param message what went wrong, in gg's words
     */
    public ToolError(String tool, ToolErrorCode code, String message) {
        super(message);
        this.tool = tool;
        this.code = code;
    }

    /**
     * The gg call that failed, under gg's own name for it ({@code read_file},
     * {@code spawn_subagent}).
     *
     * @return gg's name for the call
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
