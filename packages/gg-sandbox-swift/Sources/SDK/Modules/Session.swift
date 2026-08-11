/// End the session, with the ending that belongs to this agent's role.
///
/// Under responses as code every reply is a program, so there is no prose turn that could mean "the
/// work is done" — a model that answers "task complete" has written a reply that failed to be a
/// program, not an ending. These are the calls that mean it, and a run binds only the group its
/// agent's role has: an agent doing work gets `finish`, and a reviewer gets `approve` and
/// `requestChanges` instead.
///
/// None of them stops the program. Whatever follows an ending still runs, so an ending belongs last
/// — and a program that then fails has its ending revoked along with everything else it decided.
///
/// - ggmodule: session
public enum session {
    /// End the session, reporting what was done in a sentence or two.
    ///
    /// This is the only thing that ends a working agent's session. It does not stop the program —
    /// whatever follows it still runs — so it belongs last, once the tools have confirmed the work
    /// is really done. A program that then fails has the ending cancelled and gets another turn.
    ///
    /// - Parameter summary: What was done, in a sentence or two.
    /// - Throws: `core.ToolError` with `.invalidArgument` for a blank summary, and `.unavailable`
    ///   when this agent's role ends its session some other way.
    /// - ggop: session.finish
    public static func finish(_ summary: String) throws {
        try withScratch { scratch in
            var summary = scratch.string(summary)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_session_finish(&summary, &err) else { throw lift(failure: &err) }
        }
    }

    /// Accept the work under review: it meets every completion criterion and stays in scope.
    ///
    /// This ends the session. It does not stop the program — whatever follows it still runs — so it
    /// belongs last, once the change has actually been read. It takes nothing, because an approval
    /// carries no obligation beyond itself.
    ///
    /// - Throws: `core.ToolError` with `.unavailable` when this agent's role ends its session some
    ///   other way.
    /// - ggop: session.approve
    public static func approve() throws {
        var err = test_cabinet_gg_types_tool_error_t()
        guard test_cabinet_gg_session_approve(&err) else { throw lift(failure: &err) }
    }

    /// Reject the work under review, listing every change that must be made before it is accepted.
    ///
    /// This ends the session, and does not stop the program. Each item says what is wrong and what
    /// to change.
    ///
    /// - Parameter items: Every change that must be made before the work can be accepted, one per
    ///   entry: what is wrong, and what to change. It may not be empty.
    /// - Throws: `core.ToolError` with `.invalidArgument` when the list is empty, and `.unavailable`
    ///   when this agent's role ends its session some other way.
    /// - ggop: session.request_changes
    public static func requestChanges(_ items: [String]) throws {
        try withScratch { scratch in
            var items = scratch.list(items)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_session_request_changes(&items, &err) else {
                throw lift(failure: &err)
            }
        }
    }
}
