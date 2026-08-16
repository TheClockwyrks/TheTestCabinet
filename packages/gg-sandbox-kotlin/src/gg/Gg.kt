package gg

import gg.internal.ggRun
import gg.internal.ggText

/**
 * Write one line to the run's own log.
 *
 * This is this arm's `console.log`: a line the host records and caps, and never shows back to the
 * model. Showing something to the model is `gg.views.openText`, which is a view — attributable,
 * closable, and in the next prompt.
 *
 * It exists because standard output reaches nobody. gg attaches a standard **error** to every program
 * and deliberately no standard output, so `println` succeeds and its bytes are kept by nothing. What
 * `System.err.println` writes is kept and is shown to the model with a failure; this is the channel
 * that reaches the operator whether or not the program fails.
 *
 * Deliberately outside the signature catalogue, on the same terms every other arm's `console.log` is:
 * the catalogue describes the capability modules, and this belongs to none of them. `GgCatalogue`
 * names the package it lives in so that the reflector skips it rather than refusing it.
 *
 * @param line What to say. It reaches the operator and never the model.
 */
public fun log(line: String) {
    ggRun("feedback.log", ggText(line))
}
