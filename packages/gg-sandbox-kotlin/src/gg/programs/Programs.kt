/**
 * The library of programs this agent has already run.
 *
 * Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
 * program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
 * what ran, patch it with ordinary string work, hand it back.
 *
 * ```
 * gg.programs.rerun(gg.programs.get("k3p9").replace("gg.views.opentext", "gg.views.openText"))
 * ```
 *
 * @ggmodule programs
 */
package gg.programs

import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggRun
import gg.internal.ggText


/**
 * The programs this session has already run, oldest first.
 *
 * Each carries its id, the turn it ran on, how big it was, and whether it ran to its end. It lists
 * shapes rather than sources, so fetching one is a separate call: a directory that inlined every
 * program would put the whole session back in front of the model, which is the one thing the
 * library exists to avoid.
 *
 * The list survives a compaction, so it is also how a program whose text has left the context window
 * is found again. A session that has run nothing yet gets an empty list rather than a failure.
 *
 * @ggop programs.history
 * @return every program this session has run, oldest first
 * @throws ApiError `UNAVAILABLE` when this agent keeps no program library.
 */
public fun history(): List<ProgramSummary> =
    Read.programSummaries(ggCall("programs.history"))

/**
 * Fetch the exact source of one program that ran, by the id its acknowledgement carried.
 *
 * The source comes back as a string. This is the first half of fixing a program without rewriting
 * it: get what ran, patch it with ordinary string work, and hand the result back to be run. What
 * comes back is the program that executed — so when a submission's program was itself handed over,
 * the answer is the program that ran rather than the few lines that asked for it, and fetch, patch
 * and run compose turn after turn. A rerun keeps the id of the submission it replaced.
 *
 * @ggop programs.get
 * @param id The program's id, as its acknowledgement carried it and as the history reports it.
 * @return the source of the program that ran under that id
 * @throws ApiError `NOT_FOUND`, naming the ids that are held, for an id this agent was never issued
 *   or one whose program the library has dropped.
 */
public fun get(id: String): String = ggCall("programs.get", ggText(id)).text()

/**
 * Hand gg a program to run in place of this one.
 *
 * The current program finishes, then gg compiles and runs `source` as this submission's program,
 * under the same id. Nothing is undone: every call already made stands, and the program that runs
 * next sees the world this one left behind, so a hand-over comes before work that should not be
 * done twice.
 *
 * The first call stands, because a silently replaced program is a change nobody can see. A program
 * that then fails cancels the hand-over along with everything else it decided, and the turn ends as
 * an ordinary error. Chains are bounded: a submission runs at most four programs, this one plus
 * three handed over.
 *
 * @ggop programs.rerun
 * @param source The program to run in place of this one, as Kotlin. It may not be blank.
 * @throws ApiError `REFUSED` for a second hand-over from the same program, and `INVALID_ARGUMENT` for a blank
 *   source.
 */
public fun rerun(source: String) {
    ggRun("programs.rerun", ggText(source))
}

/**
 * One program that has already run, as the history lists it.
 *
 * It describes the program's shape rather than its source: fetching the source is its own call.
 *
 * @property id The id its `submit_program` acknowledgement carried, which fetching its source takes.
 * @property turn The turn it ran on.
 * @property lines How many lines of source it was.
 * @property chars How many characters of source it was.
 * @property ok Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping
 *   it.
 * @property error The error it ended with, when it did not run to its end.
 */
public data class ProgramSummary(
    val id: String,
    val turn: Int,
    val lines: Int,
    val chars: Int,
    val ok: Boolean,
    val error: String?,
) {
    /**
     * The source of this program, with its id already supplied.
     *
     * `gg.programs.get` for the common case where the summary is in hand, written as a member so
     * that the value carrying the id is what the call hangs off.
     *
     * @ggalias programs.get
     * @return the source of the program that ran under that id
     * @throws ApiError `NOT_FOUND` when the library has dropped that program since the history was
     *   read.
     */
    public fun source(): String = get(id)
}
