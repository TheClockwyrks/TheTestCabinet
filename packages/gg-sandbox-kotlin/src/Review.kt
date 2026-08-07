import org.teavm.jso.JSObject

/**
 * The `review` object: returning your verdict on the work you are reviewing.
 *
 * An ending is a **result**, and a reviewer's result has a shape of its own: not what was done, but
 * whether it may stand. So it is its own pair of calls rather than a `finish` carrying a verdict in
 * prose, and they are bound only for a program whose agent is reviewing — an agent doing work has
 * `harness.finish` and no `review` object at all.
 */
public class Review internal constructor() : ApiObject("review") {
    override fun target(): JSObject? = reviewObject()

    /**
     * Accept the work you are reviewing: it meets every completion criterion and stays in scope. This
     * ends your session.
     *
     * It does not stop your program — whatever follows it still runs — so call it last, once you have
     * actually read the change.
     */
    public fun approve() {
        ggRun("approve", target(), owner, "approve", ggArgs())
    }

    /**
     * Reject the work you are reviewing, listing every change that must be made before it can be
     * accepted. This ends your session, and does not stop your program.
     *
     * Each item says what is wrong and what to change.
     *
     * @param items Every change that must be made before the work can be accepted, one per entry: what is
     *   wrong, and what to change. It may not be empty.
     * @throws ToolError `INVALID_ARGUMENT` when the list is empty.
     */
    public fun requestChanges(vararg items: String) {
        ggRun(
            "request_changes",
            target(),
            owner,
            "requestChanges",
            ggArgs(ggTexts(items.asIterable())),
        )
    }
}
