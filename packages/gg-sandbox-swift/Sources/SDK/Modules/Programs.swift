/// Fetch a program that already ran, and hand a patched copy back to be run.
///
/// Under responses as code a reply is a whole program, so a one-character mistake in a sixty-line
/// program costs the sixty lines again. The library makes the fix proportional to the mistake: fetch
/// what ran, patch it with ordinary string work, hand it back.
///
/// ```swift
/// let source = try programs.get()
/// try programs.rerun(source.replacing("files.readFil(", with: "files.readFile("))
/// ```
///
/// - ggmodule: programs
public enum programs {
    /// List the programs this session has already run, oldest first.
    ///
    /// Each carries the turn it ran on, how big it was, and whether it ran to its end. It lists
    /// shapes, not sources: `programs.get` is what fetches one. The list survives a compaction, so
    /// it is also how a program whose text has left the context window is found again. A session
    /// that has run nothing yet gets an empty array rather than an error.
    ///
    /// - Returns: every program this session has run, oldest first.
    /// - Throws: `core.ToolError` with `.unavailable` when this agent keeps no program library —
    ///   which is a different fact from an empty one, and the reason this call is `throws` rather
    ///   than total.
    /// - ggop: programs.history
    public static func history() throws -> [ProgramSummary] {
        var ret = test_cabinet_gg_programs_list_program_summary_t()
        var err = test_cabinet_gg_types_tool_error_t()
        guard test_cabinet_gg_programs_history(&ret, &err) else { throw lift(failure: &err) }
        let summaries = lift(ret.ptr, ret.len) { ProgramSummary(wire: $0) }
        test_cabinet_gg_programs_list_program_summary_free(&ret)
        return summaries
    }

    /// Fetch the exact source of one program that ran; with the turn left out, the most recent.
    ///
    /// This is the first half of fixing a program without rewriting it: get what ran, patch it with
    /// ordinary string work, and hand the result to `programs.rerun`. What comes back is the program
    /// that executed, so when a turn's program was itself handed over by `programs.rerun`, the
    /// program that ran is what arrives rather than the few lines that asked for it — and
    /// fetch-patch-run composes turn after turn.
    ///
    /// - Parameter turn: The turn whose program to fetch, as `programs.history` reports it. Left
    ///   out, it fetches the most recent one.
    /// - Returns: the program's source, exactly as it ran.
    /// - Throws: `core.ToolError` with `.notFound`, naming the turns that are held, for a turn that
    ///   ran no program or one old enough that the library has dropped it.
    /// - ggop: programs.get
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

    /// Hand gg a program to run in place of this one.
    ///
    /// The calling program finishes, then gg compiles and runs `source` as this turn's program. Used
    /// with `programs.get` it fixes a program without re-emitting it. Nothing is undone: every call
    /// the calling program already made stands, and the program that runs next sees the world it
    /// left behind — so the hand-over belongs before work that should not happen twice.
    ///
    /// The first call stands, because a silently replaced program is a change nobody can see. If the
    /// calling program then fails, the hand-over is cancelled along with everything else that
    /// program decided, and the turn ends in an ordinary error. Chains are bounded: one hand-over
    /// per turn, and the fixed program is the one that does the work.
    ///
    /// - Parameter source: The program to run in place of this one, as Swift. It may not be blank.
    /// - Throws: `core.ToolError` with `.refused` for a second hand-over in one turn, and
    ///   `.invalidArgument` for a blank source.
    /// - ggop: programs.rerun
    public static func rerun(_ source: String) throws {
        try withScratch { scratch in
            var source = scratch.string(source)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_programs_rerun(&source, &err) else { throw lift(failure: &err) }
        }
    }

    /// One program that already ran, as `programs.history` lists it.
    ///
    /// It describes the program's shape, never its source: a directory that inlined every program
    /// would put the whole session back in the context window, which is the one thing the library
    /// exists to avoid. `programs.get` is what fetches a source.
    public struct ProgramSummary: Sendable {
        /// The turn it ran on — what `programs.get` takes.
        public let turn: Int
        /// How many lines of source it was.
        public let lines: Int
        /// How many characters of source it was.
        public let chars: Int
        /// Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
        public let ok: Bool
        /// The error it ended with, when it did not run to its end.
        public let error: String?

        init(wire: test_cabinet_gg_programs_program_summary_t) {
            turn = Int(wire.turn)
            lines = Int(wire.lines)
            chars = Int(wire.chars)
            ok = wire.ok
            error = lift(wire.error)
        }
    }
}

extension programs.ProgramSummary {
    /// Fetch this program's source, with its turn already supplied.
    ///
    /// `programs.get` for the common case where the history entry is in hand.
    ///
    /// - Returns: the program's source, exactly as it ran.
    /// - Throws: `core.ToolError` with `.notFound` when the library has since dropped that turn.
    /// - ggop-alias: programs.get
    public func source() throws -> String {
        try programs.get(turn: turn)
    }
}
