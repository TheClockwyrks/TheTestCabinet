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

import gg.core.ToolError
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts

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
    ggRun("session.finish", ggText(summary))
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
    ggRun("session.approve")
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
    ggRun("session.request_changes", ggTexts(items.asIterable()))
}
