/// End this session, in the shape this session's role ends one.
///
/// Each role is bound one of these calls: work is ended by reporting what was done, and a review is
/// ended with a verdict.
///
/// None of them stops the program. Whatever follows an ending still runs, and a program that then
/// fails has its ending revoked along with everything else it decided.
///
/// - ggmodule: session
public enum session {
    /// End the session, reporting what was done in a sentence or two.
    ///
    /// It does not stop the program: whatever follows it still runs. A program that then fails has
    /// the ending cancelled and gets another turn.
    ///
    /// - Parameter summary: What was done, in a sentence or two.
    /// - Throws: `core.ApiError` with `.invalidArgument` for a blank summary, and `.unavailable`
    ///   when this session ends some other way.
    /// - ggop: session.finish
    public static func finish(_ summary: String) throws {
        try withScratch { scratch in
            var summary = scratch.string(summary)
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_session_finish(&summary, &err) else { throw lift(failure: &err) }
        }
    }

    /// Accept the work under review: it meets every completion criterion and stays in scope.
    ///
    /// This ends the session. It does not stop the program: whatever follows it still runs.
    ///
    /// - Throws: `core.ApiError` with `.unavailable` when this session ends some other way.
    /// - ggop: session.approve
    public static func approve() throws {
        var err = test_cabinet_gg_types_api_error_t()
        guard test_cabinet_gg_session_approve(&err) else { throw lift(failure: &err) }
    }

    /// Reject the work under review, listing every change that must be made before it is accepted.
    ///
    /// This ends the session, and does not stop the program. Each item says what is wrong and what
    /// to change.
    ///
    /// - Parameter items: Every change that must be made before the work can be accepted, one per
    ///   entry: what is wrong, and what to change. It may not be empty.
    /// - Throws: `core.ApiError` with `.invalidArgument` when the list is empty, and `.unavailable`
    ///   when this session ends some other way.
    /// - ggop: session.request_changes
    public static func requestChanges(_ items: [String]) throws {
        try withScratch { scratch in
            var items = scratch.list(items)
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_session_request_changes(&items, &err) else {
                throw lift(failure: &err)
            }
        }
    }
}
