package gg.session;

import gg.FunctionSummary;
import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;

/**
 * End the session, with the ending the agent's role has.
 *
 * <p>Under responses as code every reply is a program, so there is no prose turn that could mean
 * "the work is done" — a model that answers "task complete" has written a reply that failed to be a
 * program rather than an ending. These are the calls that mean it, and which of them a program has
 * is decided by the role the agent was dispatched in: an agent doing work ends with
 * {@code Session.finish}, and a reviewer with {@code Session.approve} or
 * {@code Session.requestChanges}.
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
     * List the functions this module offers, each with a one-line summary.
     *
     * <p>Only the functions this run actually bound are returned, so the directory never names a
     * call a program cannot make. One function's full signature, argument descriptions and types
     * are opened as a view with {@code Views.openDocsView}.
     *
     * @return the functions this module really bound, each with its one-line summary
     * @ggmeta list
     */
    public static List<FunctionSummary> list() {
        // The one module whose calls come from two of the guest's objects, because which ending a
        // program has is decided by its agent's role: a working agent is bound `harness` and a
        // reviewing one `review`, never both. The directory asks whichever this run has.
        boolean working = Wire.harness() != null;
        return Read.functionSummaries(Wire.call("list", working ? Wire.harness() : Wire.review(),
                working ? "harness" : "review", "list", Wire.args()));
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
        Wire.run("finish", Wire.harness(), "harness", "finish", Wire.args(Wire.text(summary)));
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
        Wire.run("approve", Wire.review(), "review", "approve", Wire.args());
    }

    /**
     * Reject the work under review, listing every change it needs before it can be accepted.
     *
     * <p>This ends a reviewing agent's session. Each item says what is wrong and what to change.
     *
     * @param items Every change the work needs before it can be accepted, one per entry: what is
     *     wrong, and what to change. The list may not be empty.
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when the list is empty.
     * @ggop session.request_changes
     */
    public static void requestChanges(String... items) {
        Wire.run("request_changes", Wire.review(), "review", "requestChanges",
                Wire.args(Wire.texts(items)));
    }
}
