package gg.programs;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;
import java.util.Optional;

/**
 * Fetch a program this session already ran, and hand a patched copy back to be run.
 *
 * <p>Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
 * program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
 * what ran, patch it with ordinary string work, hand it back.
 *
 * <pre>{@code
 * Programs.rerun(Programs.get().replace("Files.readfile", "Files.readFile"));
 * }</pre>
 *
 * @ggmodule programs
 */
public final class Programs {
    private Programs() {
    }

    /**
     * Every program this session has run, oldest first.
     *
     * <p>It lists shapes rather than sources, so a directory of forty programs costs a few lines
     * each. The list survives a compaction, which makes it the way back to a program whose text has
     * left the context window. A session that has run nothing yet gets an empty list rather than a
     * failure.
     *
     * @return every program this session has run, oldest first
     * @ggop programs.history
     */
    public static List<ProgramSummary> history() {
        return Read.programSummaries(Coding.call("programs.history"));
    }

    /**
     * The exact source of one program this session ran, as a string; with no turn, the most recent.
     *
     * <p>The first half of fixing a program without rewriting it: get what ran, patch it with
     * ordinary string work, hand the result to {@link #rerun}. What comes back is the program that
     * executed — so where a turn's program was itself handed over by {@link #rerun}, this is the
     * program that ran rather than the few lines that asked for it, and fetch-patch-run composes
     * turn after turn.
     *
     * @return the source of the last program this session ran
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND}, naming the turns that are held, when
     *     nothing has run yet.
     * @ggop programs.get
     */
    public static String get() {
        return Coding.call("programs.get", Value.none()).text();
    }

    /**
     * The program that ran on one particular turn, rather than the most recent one.
     *
     * @param turn The turn whose program to fetch, as {@link #history} reports it.
     * @return the source of the program that ran on that turn
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND}, naming the turns that are held, for a turn
     *     that ran no program or one old enough that the library has dropped it.
     * @ggop programs.get
     */
    public static String get(int turn) {
        return Coding.call("programs.get", Value.of(turn)).text();
    }

    /**
     * Hand gg a program to run in place of this one.
     *
     * <p>This program finishes, then gg compiles and runs {@code source} as the turn's program.
     * Nothing is undone: every call already made stands, and the program that runs next sees the
     * world this one left behind — so a hand-over belongs before work that should not happen twice.
     *
     * <p>The first call stands, because a silently replaced program is a change nobody can see. A
     * program that then fails cancels its hand-over along with everything else it decided, and the
     * turn is an ordinary error turn instead. Chains are bounded: one hand-over per turn, and the
     * program handed over does the work.
     *
     * @param source The program to run in place of this one, as Java statements. It may not be
     *     blank.
     * @throws ToolError {@link ToolErrorCode#REFUSED} for a second hand-over in one turn, and
     *     {@link ToolErrorCode#INVALID_ARGUMENT} for a blank source.
     * @ggop programs.rerun
     */
    public static void rerun(String source) {
        Coding.call("programs.rerun", Value.of(source));
    }

    // -------------------------------------------------------------------------------------------
    // The type the library hands back
    // -------------------------------------------------------------------------------------------

    /**
     * One program this session already ran, as the history lists it.
     *
     * <p>It describes the program's shape, never its source: a directory that inlined every program
     * would put the whole session back in the context window, which is the one thing the library
     * exists to avoid.
     *
     * @param turn The turn it ran on — what {@link Programs#get(int)} takes.
     * @param lines How many lines of source it was.
     * @param chars How many characters of source it was.
     * @param ok Whether it ran to its end, with no uncaught failure and no ceiling stopping it.
     * @param error The error it ended with, where it did not run to its end.
     */
    public record ProgramSummary(int turn, int lines, int chars, boolean ok,
            Optional<String> error) {

        /**
         * Fetch this program's source, which is {@link Programs#get(int)} on the turn it ran.
         *
         * @return the source of the program that ran on this turn
         * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when the library has dropped it.
         * @ggalias programs.get
         */
        public String source() {
            return Programs.get(turn);
        }
    }
}
