/**
 * The library of programs this agent has already run.
 *
 * Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
 * program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
 * what ran, patch it with ordinary string work, hand it back.
 *
 * ```
 * gg.programs.rerun(gg.programs.get().replace("gg.files.readfile", "gg.files.readFile"))
 * ```
 *
 * @ggmodule programs
 */
package gg.programs

import gg.core.ToolError
import gg.internal.Read
import gg.internal.ggArgs
import gg.internal.ggAsString
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.programsObject


/**
 * The programs this session has already run, oldest first.
 *
 * Each carries the turn it ran on, how big it was, and whether it ran to its end. It lists shapes
 * rather than sources, so fetching one is a separate call: a directory that inlined every program
 * would put the whole session back in front of the model, which is the one thing the library exists
 * to avoid.
 *
 * The list survives a compaction, so it is also how a program whose text has left the context window
 * is found again. A session that has run nothing yet gets an empty list rather than a failure.
 *
 * @ggop programs.history
 * @return every program this session has run, oldest first
 * @throws ToolError `UNAVAILABLE` when this agent keeps no program library.
 */
public fun history(): List<ProgramSummary> =
    Read.programSummaries(ggCall("history", programsObject(), "gg.programs", "history", ggArgs()))

/**
 * The exact source of one program that ran, as a string.
 *
 * This is the first half of fixing a program without rewriting it: get what ran, patch it with
 * ordinary string work, and hand the result back to be run. What comes back is the program that
 * executed — so when a turn's program was itself handed over, the answer is the program that ran
 * rather than the few lines that asked for it, and fetch, patch and run compose turn after turn.
 *
 * @ggop programs.get
 * @param turn The turn whose program to fetch, as the history reports it. Left out, the most recent
 *   program comes back.
 * @return the source of the program that ran on that turn
 * @throws ToolError `NOT_FOUND`, naming the turns that are held, for a turn that ran no program or
 *   one the library has dropped.
 */
public fun get(turn: Int? = null): String =
    ggAsString(
        ggCall(
            "get",
            programsObject(),
            "gg.programs",
            "get",
            if (turn == null) ggArgs() else ggArgs(ggNumber(turn)),
        ),
    )

/**
 * Hand gg a program to run in place of this one.
 *
 * The current program finishes, then gg compiles and runs `source` as this turn's program. Nothing is
 * undone: every call already made stands, and the program that runs next sees the world this one
 * left behind, so a hand-over comes before work that should not be done twice.
 *
 * The first call stands, because a silently replaced program is a change nobody can see. A program
 * that then fails cancels the hand-over along with everything else it decided, and the turn ends as
 * an ordinary error. Chains are bounded at one hand-over per turn.
 *
 * @ggop programs.rerun
 * @param source The program to run in place of this one, as Kotlin. It may not be blank.
 * @throws ToolError `REFUSED` for a second hand-over in one turn, and `INVALID_ARGUMENT` for a blank
 *   source.
 */
public fun rerun(source: String) {
    ggRun("rerun", programsObject(), "gg.programs", "rerun", ggArgs(ggText(source)))
}

/**
 * One program that has already run, as the history lists it.
 *
 * It describes the program's shape rather than its source: fetching the source is its own call.
 *
 * @property turn The turn it ran on, which fetching its source takes.
 * @property lines How many lines of source it was.
 * @property chars How many characters of source it was.
 * @property ok Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping
 *   it.
 * @property error The error it ended with, when it did not run to its end.
 */
public data class ProgramSummary(
    val turn: Int,
    val lines: Int,
    val chars: Int,
    val ok: Boolean,
    val error: String?,
) {
    /**
     * The source of this program, with its turn already supplied.
     *
     * `gg.programs.get` for the common case where the summary is in hand, written as a member so
     * that the value carrying the turn is what the call hangs off.
     *
     * @ggalias programs.get
     * @return the source of the program that ran on that turn
     * @throws ToolError `NOT_FOUND` when the library has dropped that turn since the history was
     *   read.
     */
    public fun source(): String = get(turn)
}
