package gg;

import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The {@code review} object: returning your verdict on the work you are reviewing.
 *
 * <p>An ending is a <b>result</b>, and a reviewer's result has a shape of its own: not what was
 * done, but whether it may stand. So it is its own pair of calls rather than a {@code finish}
 * carrying a verdict in prose, and they are bound only for a program whose agent is reviewing — an
 * agent doing work has {@code harness.finish} and no {@code review} object at all.
 */
public final class Review extends ApiObject {
    Review() {
        super("review");
    }

    @Override
    JSObject target() {
        return Wire.review();
    }

    /**
     * Accept the work you are reviewing: it meets every completion criterion and stays in scope.
     * This ends your session.
     *
     * <p>It does not stop your program — whatever follows it still runs — so call it last, once
     * you have actually read the change.
     */
    public void approve() {
        Wire.run("approve", target(), object(), "approve", Wire.args());
    }

    /**
     * Reject the work you are reviewing, listing every change that must be made before it can be
     * accepted. This ends your session, and does not stop your program.
     *
     * <p>Each item says what is wrong and what to change.
     *
     * @param items Every change that must be made before the work can be accepted, one per entry:
     *     what is wrong, and what to change. It may not be empty.
     * @throws ToolError {@code INVALID_ARGUMENT} when the list is empty.
     */
    public void requestChanges(String... items) {
        Wire.run("request_changes", target(), object(), "requestChanges",
                Wire.args(Wire.texts(items)));
    }
}
