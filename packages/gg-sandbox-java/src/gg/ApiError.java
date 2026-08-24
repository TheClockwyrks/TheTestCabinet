package gg;

/**
 * The exception every gg call throws when it fails.
 *
 * <p>A failure is thrown rather than returned because Java is an exception language: the common path
 * reads as a straight line, and only the calls expected to fail are wrapped. It is unchecked for the
 * same reason — a checked exception would put a {@code try} around every line of a composed program.
 *
 * <pre>{@code
 * String name = "gg.docs.Docs.search";
 * try {
 *     Views.openDocsView(name);
 * } catch (ApiError failure) {
 *     if (failure.code() != ApiErrorCode.NOT_FOUND) {
 *         throw failure;
 *     }
 *     Views.openText("docs", "nothing on this surface is called " + name);
 * }
 * }</pre>
 *
 * <p>An unexpected one is best left to escape: the program dies the way its runtime kills it, and
 * what the model reads is the runtime's own dying words — this exception's message, then the stack,
 * in the program's own file and lines. That is why {@link #getMessage()} is
 * <b>{@code `operation` failed (code): what went wrong}</b> rather than gg's sentence alone: an
 * uncaught failure has no second channel to carry the call's name and its class on, and every arm of
 * a study reports one in that same shape. {@link #detail()} is the sentence without them.
 */
public final class ApiError extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final String operation;
    private final ApiErrorCode code;
    private final String detail;

    /**
     * Build one, which is what this SDK's bridge does when a call comes back a failure.
     *
     * @param operation the gg operation that failed, under gg's own name for it
     * @param code the class of failure
     * @param message what went wrong, in gg's words
     */
    public ApiError(String operation, ApiErrorCode code, String message) {
        super("`" + operation + "` failed (" + code.wireName() + "): " + message);
        this.operation = operation;
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
     * <p>{@code open_text} for {@code Views.openText}, {@code open_docs_view} for
     * {@code Views.openDocsView}.
     *
     * @return gg's own key for the call
     */
    public String operation() {
        return operation;
    }

    /**
     * The failure class, so a catch site branches on a value rather than on prose.
     *
     * @return why the call failed
     */
    public ApiErrorCode code() {
        return code;
    }
}
