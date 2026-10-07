/**
 * The library of programs this session has already run.
 *
 * A stored program's source is fetched, patched with ordinary string work, and handed back to be run
 * in place of the current one.
 *
 * ```
 * gg.programs.rerun(gg.programs.get("k3p9").replace("opentext", "openText"))
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
 * shapes rather than sources; fetching a source is a separate call.
 *
 * The list survives a compaction. A session that has run nothing yet gets an empty list rather than a
 * failure.
 *
 * @ggop programs.history
 * @return every program this session has run, oldest first
 * @throws ApiError `UNAVAILABLE` when this run keeps no program library.
 */
public fun history(): List<ProgramSummary> =
    Read.programSummaries(ggCall("programs.history"))

/**
 * Fetch the exact source of one program that ran, by the id its acknowledgement carried.
 *
 * The source comes back as a string. What comes back is the program that executed, so where a
 * submission's program was itself handed over, the answer is the handed-over program. A rerun keeps
 * the id of the submission it replaced.
 *
 * @ggop programs.get
 * @param id The program's id, as its acknowledgement carried it and as the history reports it.
 * @return the source of the program that ran under that id
 * @throws ApiError `NOT_FOUND`, naming the ids that are held, for an id this session was never
 *   issued or one whose program the library has dropped.
 */
public fun get(id: String): String = ggCall("programs.get", ggText(id)).text()

/**
 * Hand gg a program to run in place of this one.
 *
 * The current program finishes, then gg compiles and runs `source` as this submission's program,
 * under the same id. Nothing is undone: every call already made stands, and the program that runs
 * next sees the world this one left behind.
 *
 * The first call stands. A program that then fails cancels the hand-over along with everything else
 * it decided, and the turn ends as an ordinary error. A submission runs at most four programs, this
 * one plus three handed over.
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
     * @ggalias programs.get
     * @return the source of the program that ran under that id
     * @throws ApiError `NOT_FOUND` when the library has dropped that program since the history was
     *   read.
     */
    public fun source(): String = get(id)
}
