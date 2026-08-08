/// return your verdict on the work you are reviewing
///
/// An ending is a **result**, and a reviewer's result has a shape of its own: not what was done, but
/// whether it may stand. So it is its own pair of calls rather than a `finish` carrying a verdict in
/// prose, and they are bound only for a program whose agent is reviewing — an agent doing work has
/// `harness.finish` and no `review` object at all.
public enum review: ApiObject {
    public static let ggObject = "review"

    /// Accept the work you are reviewing: it meets every completion criterion and stays in scope.
    /// This ends your session.
    ///
    /// It does not stop your program — whatever follows it still runs — so call it last, once you
    /// have actually read the change. It takes nothing: an approval carries no obligation beyond
    /// itself.
    ///
    /// - Throws: `ToolError` with `.unavailable` when your role is not to review.
    public static func approve() throws {
        var err = test_cabinet_gg_types_tool_error_t()
        guard test_cabinet_gg_session_approve(&err) else { throw lift(failure: &err) }
    }

    /// Reject the work you are reviewing, listing every change that must be made before it can be
    /// accepted. This ends your session, and does not stop your program.
    ///
    /// Each item says what is wrong and what to change; the list may not be empty.
    ///
    /// - Parameter items: Every change that must be made before the work can be accepted, one per
    ///   entry: what is wrong, and what to change. It may not be empty.
    /// - Throws: `ToolError` with `.invalidArgument` when the list is empty, and `.unavailable` when
    ///   your role is not to review.
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
