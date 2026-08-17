package gg.internal;

import gg.ToolError;
import gg.ToolErrorCode;

/**
 * <b>One gg call, from this arm's side</b> — the bridge every model-facing class in this SDK sits
 * on.
 *
 * <p>Nothing here is model-facing, and nothing describes it to a model — {@link #call} takes an
 * operation id as data, which is exactly the shape the seam forbids a <i>capability</i> to reach a
 * program as, and it is under the typed surface rather than in it. See {@link Abi}'s class note for
 * what keeps it there.
 *
 * <p>What crosses is {@link Frames}' business and {@link Abi} carries it. Both of those are shared
 * with the Kotlin arm and live in {@code packages/gg-sandbox-jvm}; this file is the half that cannot
 * be, because the class a program catches is this arm's own.
 */
public final class Coding {
    private Coding() {
    }

    /**
     * Make one gg call and hand back what it answered.
     *
     * <p>A call's arguments go out positionally in the order the WIT declares them, and what comes
     * back is either the value or a raised {@link ToolError} carrying the three fields gg failed
     * with — the same class, the same code and the same sentence every other arm's program catches.
     *
     * @param op the rendered operation id — {@code files.read_file}
     * @param arguments the call's arguments, already lowered
     * @return what the call returned, which is {@link Value#none()} for a call that returns nothing
     * @throws ToolError when gg refused the call or the tool behind it failed
     */
    public static Value call(String op, Value... arguments) {
        Frames.Answer answered = Frames.response(Abi.call(op, Frames.request(arguments)));
        if (answered.failed()) {
            throw new ToolError(answered.tool(), ToolErrorCode.of(answered.code()),
                    answered.message());
        }
        return answered.value();
    }
}
