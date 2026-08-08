/// end your session
///
/// Under responses as code every reply is a program, so there is no prose turn that could mean "I am
/// done" — a model that answers "task complete" has written a reply that failed to be a program, not
/// an ending. This is the call that means it, and it is bound only for an agent whose role is to do
/// work: a reviewer's programs get `review` instead.
public enum harness: ApiObject {
    public static let ggObject = "harness"

    /// End your session, reporting what you did in a sentence or two. This is the only thing that
    /// ends it.
    ///
    /// It does not stop your program — whatever follows it still runs — so call it last, once the
    /// tools have confirmed the work is really done. If your program then fails, the ending is
    /// cancelled and you get another turn.
    ///
    /// - Parameter summary: What you did, in a sentence or two.
    /// - Throws: `ToolError` with `.unavailable` when your role does not end this way, and
    ///   `.invalidArgument` for an empty summary.
    public static func finish(_ summary: String) throws {
        try withScratch { scratch in
            var summary = scratch.string(summary)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_session_finish(&summary, &err) else { throw lift(failure: &err) }
        }
    }
}
