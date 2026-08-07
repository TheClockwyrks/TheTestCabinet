package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The {@code programs} object: the library of programs this agent has already run.
 *
 * <p>Under responses as code a reply is a whole program, so a one-character mistake in a
 * sixty-line program costs the sixty lines again. The library makes the fix proportional to the
 * mistake: fetch what ran, patch it with ordinary string work, hand it back.
 *
 * <pre>{@code
 * programs.rerun(programs.get().replace("fs.readfile", "fs.readFile"));
 * }</pre>
 */
public final class Programs extends ApiObject {
    Programs() {
        super("programs");
    }

    @Override
    JSObject target() {
        return Wire.programs();
    }

    /**
     * The programs you have already run this session, oldest first — each with the turn it ran on,
     * how big it was, and whether it ran to its end.
     *
     * <p>It lists shapes, not sources: fetch the one you want with {@code programs.get}. The list
     * survives a compaction, so it is also how you find a program whose text has left your context
     * window. It is empty — never an error — for a session that has run nothing yet.
     *
     * @return every program this session has run, oldest first
     */
    public List<ProgramSummary> history() {
        return Read.programSummaries(
                Wire.call("history", target(), object(), "history", Wire.args()));
    }

    /**
     * The exact source of your most recent program, as a string.
     *
     * <p>This is the first half of fixing a program without rewriting it: get what ran, patch it
     * with ordinary string work, and hand the result to {@code programs.rerun}. What comes back is
     * the program that <b>executed</b> — so when a turn's program was itself handed over by
     * {@code programs.rerun}, you get the program that ran, not the few lines that asked for it,
     * and fetch-patch-run composes turn after turn.
     *
     * @return the source of the last program you ran
     * @throws ToolError {@code NOT_FOUND}, naming the turns that are held, when nothing has run
     *     yet.
     */
    public String get() {
        return Wire.asString(Wire.call("get", target(), object(), "get", Wire.args()));
    }

    /**
     * The exact source of one program you ran, as a string.
     *
     * @param turn The turn whose program to fetch, as {@code programs.history} reports it.
     * @return the source of the program that ran on that turn
     * @throws ToolError {@code NOT_FOUND}, naming the turns that are held, for a turn that ran no
     *     program or one old enough that the library has dropped it.
     */
    public String get(int turn) {
        return Wire.asString(Wire.call("get", target(), object(), "get",
                Wire.args(Wire.number(turn))));
    }

    /**
     * Hand gg a program to run in place of this one. Your program finishes, then gg compiles and
     * runs {@code source} as this turn's program.
     *
     * <p>Use it with {@code programs.get} to fix a program without re-emitting it. Nothing is
     * undone: every call your program already made stands, and the program that runs next sees the
     * world your program left behind — so hand over BEFORE doing work you do not want done twice.
     *
     * <p>The first call stands, because a silently replaced program is a change you cannot see. If
     * your program then fails, the hand-over is cancelled along with everything else the failed
     * program decided, and you get an ordinary error turn instead. Chains are bounded: hand over
     * once per turn, and write the fixed program to do the work.
     *
     * @param source The program to run in place of this one, as Java statements. It may not be
     *     blank.
     * @throws ToolError {@code REFUSED} for a second hand-over in one turn, and
     *     {@code INVALID_ARGUMENT} for a blank source.
     */
    public void rerun(String source) {
        Wire.run("rerun", target(), object(), "rerun", Wire.args(Wire.text(source)));
    }
}
