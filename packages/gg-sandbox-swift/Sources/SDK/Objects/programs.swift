/// fetch a program you already ran, and hand a patched copy back to be run
///
/// Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
/// program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
/// what ran, patch it with ordinary string work, hand it back.
///
/// ```swift
/// let source = try programs.get()
/// try programs.rerun(source.replacingOccurrences(of: "fs.readFil(", with: "fs.readFile("))
/// ```
public enum programs: ApiObject {
    public static let ggObject = "programs"

    /// The programs you have already run this session, oldest first — each with the turn it ran on,
    /// how big it was, and whether it ran to its end.
    ///
    /// It lists shapes, not sources: fetch the one you want with `programs.get`. The list survives a
    /// compaction, so it is also how you find a program whose text has left your context window. It
    /// is empty — never a failure — for a session that has run nothing yet.
    ///
    /// - Returns: every program this session has run, oldest first.
    /// - Throws: `ToolError` with `.unavailable` when this agent keeps no program library.
    public static func history() throws -> [ProgramSummary] {
        var ret = test_cabinet_gg_programs_list_program_summary_t()
        var err = test_cabinet_gg_types_tool_error_t()
        guard test_cabinet_gg_programs_history(&ret, &err) else { throw lift(failure: &err) }
        let summaries = lift(ret.ptr, ret.len) { ProgramSummary(wire: $0) }
        test_cabinet_gg_programs_list_program_summary_free(&ret)
        return summaries
    }

    /// The exact source of one program you ran. With the turn left out, your most recent one.
    ///
    /// This is the first half of fixing a program without rewriting it: get what ran, patch it with
    /// ordinary string work, and hand the result to `programs.rerun`. What comes back is the program
    /// that **executed** — so when a turn's program was itself handed over by `programs.rerun`, you
    /// get the program that ran, not the few lines that asked for it, and fetch-patch-run composes
    /// turn after turn.
    ///
    /// - Parameter turn: The turn whose program to fetch, as `programs.history` reports it. Left out,
    ///   it fetches your most recent one.
    /// - Returns: the program's source, exactly as it ran.
    /// - Throws: `ToolError` with `.notFound`, naming the turns that are held, for a turn that ran no
    ///   program or one old enough that the library has dropped it.
    public static func get(turn: Int? = nil) throws -> String {
        var ret = sandbox_string_t()
        var err = test_cabinet_gg_types_tool_error_t()
        let ok = withOptional(turn.map { UInt32(truncatingIfNeeded: $0) }) { turn in
            test_cabinet_gg_programs_get(turn, &ret, &err)
        }
        guard ok else { throw lift(failure: &err) }
        let source = lift(ret)
        sandbox_string_free(&ret)
        return source
    }

    /// Hand gg a program to run in place of this one. Your program finishes, then gg compiles and
    /// runs `source` as this turn's program.
    ///
    /// Use it with `programs.get` to fix a program without re-emitting it. Nothing is undone: every
    /// call your program already made stands, and the program that runs next sees the world your
    /// program left behind — so hand over BEFORE doing work you do not want done twice.
    ///
    /// The first call stands, because a silently replaced program is a change you cannot see. If your
    /// program then fails, the hand-over is cancelled along with everything else the failed program
    /// decided, and you get an ordinary error turn instead. Chains are bounded: hand over once per
    /// turn, and write the fixed program to do the work.
    ///
    /// - Parameter source: The program to run in place of this one, as Swift. It may not be blank.
    /// - Throws: `ToolError` with `.refused` for a second hand-over in one turn, and
    ///   `.invalidArgument` for a blank source.
    public static func rerun(_ source: String) throws {
        try withScratch { scratch in
            var source = scratch.string(source)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_programs_rerun(&source, &err) else { throw lift(failure: &err) }
        }
    }
}
