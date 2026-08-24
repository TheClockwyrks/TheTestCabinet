package gg.session;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Value;

/**
 * End the session, with the ending the agent's role has.
 *
 * <p>Under responses as code every reply is a program, so there is no prose turn that could mean
 * "the work is done" — a model that answers "task complete" has written a reply that failed to be a
 * program rather than an ending. These are the calls that mean it, and which of them a program has
 * is decided by the role the agent was dispatched in: an agent doing work is given the plain
 * ending, and a reviewer the verdict pair instead. No agent holds both, because an ending is a
 * result and the two roles produce different results.
 *
 * <p>None of them stops the program. Whatever follows still runs, which is why they belong last, and
 * a program that then fails cancels its own ending and gets another turn.
 *
 * @ggmodule session
 */
public final class Session {
    private Session() {
    }

    /**
     * End the session, reporting what was done in a sentence or two.
     *
     * <p>The one thing that ends a working agent's session. It is best called last, once the tools
     * have confirmed the work is really done.
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
     * <p>This ends a reviewing agent's session, and is best called once the change has actually been
     * read.
     *
     * @ggop session.approve
     */
    public static void approve() {
        Coding.call("session.approve");
    }

    /**
     * Reject the work under review, listing every change it needs before it can be accepted.
     *
     * <p>This ends a reviewing agent's session. Each item says what is wrong and what to change.
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
