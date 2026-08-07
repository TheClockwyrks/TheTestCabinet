import org.teavm.jso.JSObject

/**
 * The `harness` object: ending your session.
 *
 * Under responses as code every reply is a program, so there is no prose turn that could mean "I am
 * done" — a model that answers "task complete" has written a reply that failed to be a program, not an
 * ending. This is the call that means it, and it is bound only for an agent whose role is to do work: a
 * reviewer's programs get [Review] instead.
 */
public class Harness internal constructor() : ApiObject("harness") {
    override fun target(): JSObject? = harnessObject()

    /**
     * End your session, reporting what you did in a sentence or two. This is the only thing that ends it.
     *
     * It does not stop your program — whatever follows it still runs — so call it last, once the tools
     * have confirmed the work is really done. If your program then fails, the ending is cancelled and you
     * get another turn.
     *
     * @param summary What you did, in a sentence or two.
     */
    public fun finish(summary: String) {
        ggRun("finish", target(), owner, "finish", ggArgs(ggText(summary)))
    }
}
