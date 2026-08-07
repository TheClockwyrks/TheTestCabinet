package gg;

import gg.internal.Wire;
import org.teavm.jso.JSObject;

/**
 * The {@code harness} object: ending your session.
 *
 * <p>Under responses as code every reply is a program, so there is no prose turn that could mean
 * "I am done" — a model that answers "task complete" has written a reply that failed to be a
 * program, not an ending. This is the call that means it, and it is bound only for an agent whose
 * role is to do work: a reviewer's programs get {@link Review} instead.
 */
public final class Harness extends ApiObject {
    Harness() {
        super("harness");
    }

    @Override
    JSObject target() {
        return Wire.harness();
    }

    /**
     * End your session, reporting what you did in a sentence or two. This is the only thing that
     * ends it.
     *
     * <p>It does not stop your program — whatever follows it still runs — so call it last, once
     * the tools have confirmed the work is really done. If your program then fails, the ending is
     * cancelled and you get another turn.
     *
     * @param summary What you did, in a sentence or two.
     */
    public void finish(String summary) {
        Wire.run("finish", target(), object(), "finish", Wire.args(Wire.text(summary)));
    }
}
