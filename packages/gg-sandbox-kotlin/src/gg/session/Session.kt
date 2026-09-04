/**
 * Ending the session.
 *
 * Every reply is a program, so an ending is a call rather than a sentence.
 *
 * @ggmodule session
 */
package gg.session

import gg.core.ApiError
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts

/**
 * End the session, reporting what was done in a sentence or two.
 *
 * It does not stop the program; whatever follows it still runs. A program that then fails cancels the
 * ending, and the session gets another turn.
 *
 * @ggop session.finish
 * @param summary What was done, in a sentence or two.
 * @throws ApiError `REFUSED` for a second ending in one turn.
 */
public fun finish(summary: String) {
    ggRun("session.finish", ggText(summary))
}

/**
 * Accept the work under review: it meets every completion criterion and stays in scope.
 *
 * This ends the session and does not stop the program.
 *
 * @ggop session.approve
 * @throws ApiError `REFUSED` for a second verdict in one turn.
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
 * @throws ApiError `INVALID_ARGUMENT` when the list is empty, and `REFUSED` for a second verdict in
 *   one turn.
 */
public fun requestChanges(vararg items: String) {
    ggRun("session.request_changes", ggTexts(items.asIterable()))
}
