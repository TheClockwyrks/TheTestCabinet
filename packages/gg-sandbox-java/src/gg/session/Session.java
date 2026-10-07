package gg.session;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Value;

/**
 * End the session.
 *
 * <p>A call here does not stop the program: whatever follows still runs, and a program that then
 * fails cancels its own ending and gets another turn.
 *
 * @ggmodule session
 */
public final class Session {
    private Session() {
    }

    /**
     * End the session, reporting what was done in a sentence or two.
     *
     * @param summary What was done, in a sentence or two.
     * @ggop session.finish
     */
    public static void finish(String summary) {
        Coding.call("session.finish", Value.of(summary));
    }

    /**
     * Accept the work under review: it meets every completion criterion and stays in scope.
     *
     * <p>Ends the session with an approving verdict.
     *
     * @ggop session.approve
     */
    public static void approve() {
        Coding.call("session.approve");
    }

    /**
     * Reject the work under review, listing every change it needs before it can be accepted.
     *
     * <p>Ends the session with a rejecting verdict. Each item says what is wrong and what to
     * change.
     *
     * @param items Every change the work needs before it can be accepted, one per entry: what is
     *     wrong, and what to change. The list may not be empty.
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} when the list is empty.
     * @ggop session.request_changes
     */
    public static void requestChanges(String... items) {
        Coding.call("session.request_changes", Value.texts(items));
    }
}
