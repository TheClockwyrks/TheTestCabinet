/**
 * Ending the session, in the shape the agent's own role calls for.
 *
 * Under responses as code every reply is a program, so there is no prose turn that could mean "the
 * work is done" — a model that answers "task complete" has written a reply that failed to be a
 * program rather than an ending. These are the calls that mean it.
 *
 * Which of them a program gets is decided by the agent's role: one that does work is given the plain
 * ending, and one that reviews is given the verdict pair instead. No agent holds both, because an
 * ending is a result and the two roles produce different results.
 *
 * @ggmodule session
 */
package gg.session

import gg.core.FunctionSummary
import gg.core.ToolError
import gg.internal.Read
import gg.internal.ggArgs
import gg.internal.ggCall
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts
import gg.internal.harnessObject
import gg.internal.reviewObject

/**
 * List the functions this module offers, each with a one-line summary.
 *
 * Only the functions this run actually bound are returned, so the directory never names a call the
 * program cannot make. One function's full signature, argument descriptions and types are opened as a
 * view with `gg.views.openDocsView`.
 *
 * @return every function this module really bound, each with one line saying what it does
 */
public fun list(): List<FunctionSummary> =
    Read.functionSummaries(
        // The one module whose directory hangs off two of the guest's objects, because the ending an
        // agent is given depends on its role: a working agent binds `harness` and a reviewer binds
        // `review`, and no agent binds both. Asking the one that is there is what makes this
        // module's directory answer for either role.
        ggCall("list", harnessObject() ?: reviewObject(), "gg.session", "list", ggArgs()),
    )

/**
 * End the session, reporting what was done in a sentence or two.
 *
 * It does not stop the program — whatever follows it still runs — so it belongs last, once the tools
 * have confirmed the work is really done. A program that then fails cancels the ending, and the
 * session gets another turn.
 *
 * @ggop session.finish
 * @param summary What was done, in a sentence or two.
 * @throws ToolError `REFUSED` for a second ending in one turn.
 */
public fun finish(summary: String) {
    ggRun("finish", harnessObject(), "gg.session", "finish", ggArgs(ggText(summary)))
}

/**
 * Accept the work under review: it meets every completion criterion and stays in scope.
 *
 * This ends the session, and does not stop the program, so it belongs last — once the change has
 * actually been read.
 *
 * @ggop session.approve
 * @throws ToolError `REFUSED` for a second verdict in one turn.
 */
public fun approve() {
    ggRun("approve", reviewObject(), "gg.session", "approve", ggArgs())
}

/**
 * Reject the work under review, listing every change that must be made before it can be accepted.
 *
 * Each item says what is wrong and what to change. This ends the session, and does not stop the
 * program.
 *
 * @ggop session.request_changes
 * @param items Every change that must be made before the work can be accepted, one per entry. The
 *   list may not be empty.
 * @throws ToolError `INVALID_ARGUMENT` when the list is empty, and `REFUSED` for a second verdict in
 *   one turn.
 */
public fun requestChanges(vararg items: String) {
    ggRun(
        "request_changes",
        reviewObject(),
        "gg.session",
        "requestChanges",
        ggArgs(ggTexts(items.asIterable())),
    )
}
