/// Fetch a program that already ran, and hand a patched copy back to be run.
///
/// ```swift
/// let source = try programs.get("k3p9")
/// try programs.rerun(source.replacing("views.openTex(", with: "views.openText("))
/// ```
///
/// - ggmodule: programs
public enum programs {
    /// List the programs this session has already run, oldest first.
    ///
    /// Each carries its id, the turn it ran on, how big it was, and whether it ran to its end;
    /// sources are not listed. The list survives a compaction. A session that has run nothing yet
    /// gets an empty array.
    ///
    /// - Returns: every program this session has run, oldest first.
    /// - Throws: `core.ApiError` with `.unavailable` when this run keeps no program library.
    /// - ggop: programs.history
    public static func history() throws -> [ProgramSummary] {
        var ret = test_cabinet_gg_programs_list_program_summary_t()
        var err = test_cabinet_gg_types_api_error_t()
        guard test_cabinet_gg_programs_history(&ret, &err) else { throw lift(failure: &err) }
        let summaries = lift(ret.ptr, ret.len) { ProgramSummary(wire: $0) }
        test_cabinet_gg_programs_list_program_summary_free(&ret)
        return summaries
    }

    /// Fetch the exact source of one program that ran, by the id its acknowledgement carried.
    ///
    /// What comes back is the program that executed, so where a submission's program was itself
    /// handed over by `programs.rerun`, the program that ran is what arrives rather than the few
    /// lines that asked for it. A rerun keeps the id of the submission it replaced.
    ///
    /// - Parameter id: The program's id, as its acknowledgement carried it and as
    ///   `programs.history` reports it.
    /// - Returns: the program's source, exactly as it ran.
    /// - Throws: `core.ApiError` with `.notFound`, naming the ids that are held, for an id this
    ///   agent was never issued or one whose program is old enough that the library has dropped it.
    /// - ggop: programs.get
    public static func get(_ id: String) throws -> String {
        try withScratch { scratch in
            var id = scratch.string(id)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_programs_get(&id, &ret, &err) else { throw lift(failure: &err) }
            let source = lift(ret)
            sandbox_string_free(&ret)
            return source
        }
    }

    /// Hand gg a program to run in place of this one.
    ///
    /// The calling program finishes, then gg compiles and runs `source` as this submission's
    /// program, under the same id. Nothing is undone: every call the calling program already made
    /// stands, and the program that runs next sees the world it left behind.
    ///
    /// The first call stands; a second from the same program is refused. If the calling program
    /// then fails, the hand-over is cancelled along with everything else that program decided, and
    /// the turn ends in an ordinary error. A submission runs at most four programs, this one plus
    /// three handed over.
    ///
    /// - Parameter source: The program to run in place of this one, as Swift. It may not be blank.
    /// - Throws: `core.ApiError` with `.refused` for a second hand-over from the same program, and
    ///   `.invalidArgument` for a blank source.
    /// - ggop: programs.rerun
    public static func rerun(_ source: String) throws {
        try withScratch { scratch in
            var source = scratch.string(source)
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_programs_rerun(&source, &err) else { throw lift(failure: &err) }
        }
    }

    /// One program that already ran, as `programs.history` lists it.
    ///
    /// It describes the program's shape, never its source.
    public struct ProgramSummary: Sendable {
        /// The id its `submit_program` acknowledgement carried — what `programs.get` takes.
        public let id: String
        /// The turn it ran on.
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
            id = lift(wire.id)
            turn = Int(wire.turn)
            lines = Int(wire.lines)
            chars = Int(wire.chars)
            ok = wire.ok
            error = lift(wire.error)
        }
    }
}

extension programs.ProgramSummary {
    /// Fetch this program's source, with its id already supplied.
    ///
    /// - Returns: the program's source, exactly as it ran.
    /// - Throws: `core.ApiError` with `.notFound` when the library has since dropped that program.
    /// - ggop-alias: programs.get
    public func source() throws -> String {
        try programs.get(id)
    }
}
