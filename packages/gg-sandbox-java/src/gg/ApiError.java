package gg;

/**
 * The exception every gg call throws when it fails.
 *
 * <p>It is unchecked. {@link #getMessage()} is the failing operation in backticks, then the code in
 * parentheses, then gg's own sentence. {@link #detail()} is that sentence alone, and
 * {@link #code()} is the failure class a catch site branches on.
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
     * What went wrong, in gg's own words alone, without the call's name and its class.
     *
     * @return gg's own sentence about the failure
     */
    public String detail() {
        return detail;
    }

    /**
     * The call that failed, by the key of the operation this program reached for.
     *
     * <p>gg's own spelling of the operation rather than the method's: {@code open_text}.
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
