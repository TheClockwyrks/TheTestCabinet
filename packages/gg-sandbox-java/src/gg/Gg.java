package gg;

import gg.internal.Coding;
import gg.internal.Value;

/**
 * The one thing a program can say to whoever is watching the run.
 *
 * <p>This is this arm's {@code console.log}: a line the host records and caps, and never shows back
 * to the model. Showing something to the model is {@code gg.views.Views.openText}, which is a
 * view — attributable, closable, and in the next prompt.
 *
 * <p>It exists because standard output reaches nobody. gg attaches a standard <b>error</b> to every
 * program and deliberately no standard output, so {@code System.out.println} succeeds and its bytes
 * are kept by nothing. What {@code System.err.println} writes is kept and is shown to the model
 * with a failure; this is the channel that reaches the operator whether or not the program fails.
 *
 * <p>Deliberately outside the signature catalogue, on the same terms every other arm's
 * {@code console.log} is: the catalogue describes the capability modules, and this belongs to none
 * of them.
 */
public final class Gg {
    private Gg() {
    }

    /**
     * Write one line to the run's own log.
     *
     * @param line What to say. It reaches the operator and never the model.
     */
    public static void log(String line) {
        Coding.call("feedback.log", Value.of(line));
    }
}
