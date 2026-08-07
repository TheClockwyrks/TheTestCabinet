import org.teavm.jso.JSObject

/**
 * The `programs` object: the library of programs this agent has already run.
 *
 * Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line program
 * costs the sixty lines again. The library makes the fix proportional to the mistake: fetch what ran,
 * patch it with ordinary string work, hand it back.
 *
 * ```
 * programs.rerun(programs.get().replace("fs.readfile", "fs.readFile"))
 * ```
 */
public class Programs internal constructor() : ApiObject("programs") {
    override fun target(): JSObject? = programsObject()

    /**
     * The programs you have already run this session, oldest first — each with the turn it ran on, how
     * big it was, and whether it ran to its end.
     *
     * It lists shapes, not sources: fetch the one you want with `programs.get`. The list survives a
     * compaction, so it is also how you find a program whose text has left your context window. It is
     * empty — never an error — for a session that has run nothing yet.
     *
     * @return every program this session has run, oldest first
     */
    public fun history(): List<ProgramSummary> =
        Read.programSummaries(ggCall("history", target(), owner, "history", ggArgs()))

    /**
     * The exact source of one program you ran, as a string.
     *
     * This is the first half of fixing a program without rewriting it: get what ran, patch it with
     * ordinary string work, and hand the result to `programs.rerun`. What comes back is the program that
     * **executed** — so when a turn's program was itself handed over by `programs.rerun`, you get the
     * program that ran, not the few lines that asked for it, and fetch-patch-run composes turn after
     * turn.
     *
     * @param turn The turn whose program to fetch, as `programs.history` reports it. Leave it out for
     *   your most recent program.
     * @return the source of the program that ran on that turn
     * @throws ToolError `NOT_FOUND`, naming the turns that are held, for a turn that ran no program, one
     *   old enough that the library has dropped it, or a session that has run nothing yet.
     */
    public fun get(turn: Int? = null): String =
        ggAsString(
            ggCall(
                "get",
                target(),
                owner,
                "get",
                if (turn == null) ggArgs() else ggArgs(ggNumber(turn)),
            ),
        )

    /**
     * Hand gg a program to run in place of this one. Your program finishes, then gg compiles and runs
     * `source` as this turn's program.
     *
     * Use it with `programs.get` to fix a program without re-emitting it. Nothing is undone: every call
     * your program already made stands, and the program that runs next sees the world your program left
     * behind — so hand over BEFORE doing work you do not want done twice.
     *
     * The first call stands, because a silently replaced program is a change you cannot see. If your
     * program then fails, the hand-over is cancelled along with everything else the failed program
     * decided, and you get an ordinary error turn instead. Chains are bounded: hand over once per turn,
     * and write the fixed program to do the work.
     *
     * @param source The program to run in place of this one, as Kotlin. It may not be blank.
     * @throws ToolError `REFUSED` for a second hand-over in one turn, and `INVALID_ARGUMENT` for a blank
     *   source.
     */
    public fun rerun(source: String) {
        ggRun("rerun", target(), owner, "rerun", ggArgs(ggText(source)))
    }
}
