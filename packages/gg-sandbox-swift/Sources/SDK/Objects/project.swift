/// the epic/issue board — decompose work into dispatchable issues
///
/// An issue is the heavyweight unit of work — its scope, non-scope and completion criteria are
/// exactly what a delegated child agent is briefed from — which is why `createIssue` asks for more
/// than `tasks.addTask` does.
///
/// Two of `updateIssue`'s arguments are **three-way**, and Swift has an `enum` for exactly that:
/// `TextEdit` leaves, empties or replaces a description, and `EpicAssignment` leaves, detaches or
/// regroups an epic. Neither needs a sentinel.
public enum project: ApiObject {
    public static let ggObject = "project"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = [
        "create_epic", "create_issue", "update_issue", "set_issue_blocked_by", "remove_epic",
        "remove_issue", "wait_for_issue",
    ]

    /// Create an epic to group related issues, and hand back the id its prefix resolved to together
    /// with the board budget.
    ///
    /// `prefix` is 3-6 letters naming the epic; it is upper-cased and becomes the epic's id, which is
    /// also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`,
    /// and so on.
    ///
    /// - Parameters:
    ///   - prefix: 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
    ///     issues are numbered from.
    ///   - title: A short line naming the body of work.
    ///   - description: What the epic covers, for a reader who has not seen its issues.
    /// - Returns: the epic's id, and the board budget.
    /// - Throws: `ToolError` with `.invalidArgument` when the prefix is not 3-6 letters, and
    ///   `.conflict` when another epic already holds it.
    @discardableResult
    public static func createEpic(
        prefix: String, title: String, description: String
    ) throws -> EpicCreated {
        try withScratch { scratch in
            var input = test_cabinet_gg_board_epic_input_t(
                prefix: scratch.string(prefix),
                title: scratch.string(title),
                description: scratch.string(description))
            var ret = test_cabinet_gg_board_epic_created_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_create_epic(&input, &ret, &err) else {
                throw lift(failure: &err)
            }
            let created = EpicCreated(wire: ret)
            test_cabinet_gg_board_epic_created_free(&ret)
            return created
        }
    }

    /// Create a self-contained, dispatchable issue, and hand back the id the board **assigned** it
    /// together with the board budget.
    ///
    /// The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it
    /// has no epic; you do not choose it, so keep the returned one to block a later issue on this one
    /// or to wait for it. `inScope`, `outOfScope` and `completionCriteria` are what a child agent is
    /// briefed from, so write them for a reader with no other context.
    ///
    /// - Parameters:
    ///   - title: A short line naming the work.
    ///   - inScope: What the issue covers, precisely. Part of the brief a child agent is given.
    ///   - outOfScope: What the issue deliberately does not cover, so the work stops where you meant
    ///     it to.
    ///   - completionCriteria: What must be true for the issue to be done. It is what a reviewer
    ///     checks the work against.
    ///   - agent: The agent the issue is dispatched to. It must be one you may spawn.
    ///   - description: What the work is, for a child agent with no other context. Left out, the
    ///     issue has none.
    ///   - blockedBy: The ids of every issue that must be done before this one. Empty by default.
    ///   - epic: The id of an existing epic to group it under. Left out, the issue is ungrouped and
    ///     numbered under `ISSUE`.
    ///   - reviewers: The agents that must approve the work, from the set you may spawn. Required
    ///     when this run's reviewers feature is on, and empty otherwise.
    /// - Returns: the id the board assigned, and the board budget.
    /// - Throws: `ToolError` with `.invalidArgument` when `agent` or a reviewer is not yours to
    ///   assign, and `.conflict` on a blocker edge that would close a cycle.
    @discardableResult
    public static func createIssue(
        title: String, inScope: String, outOfScope: String, completionCriteria: String,
        agent: String, description: String? = nil, blockedBy: [String] = [],
        epic: String? = nil, reviewers: [String] = []
    ) throws -> IssueCreated {
        try withScratch { scratch in
            var input = test_cabinet_gg_board_issue_input_t(
                title: scratch.string(title),
                description: scratch.optional(description),
                in_scope: scratch.string(inScope),
                out_of_scope: scratch.string(outOfScope),
                completion_criteria: scratch.string(completionCriteria),
                blocked_by: scratch.list(blockedBy),
                epic_id: scratch.optional(epic),
                agent: scratch.string(agent),
                reviewers: scratch.list(reviewers))
            var ret = test_cabinet_gg_board_issue_created_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_create_issue(&input, &ret, &err) else {
                throw lift(failure: &err)
            }
            let created = IssueCreated(wire: ret)
            test_cabinet_gg_board_issue_created_free(&ret)
            return created
        }
    }

    /// Revise an issue; name at least one thing to change.
    ///
    /// An argument you leave out is left alone, `description: .clear` empties the description, and
    /// `epic: .ungroup` detaches the issue from its epic.
    ///
    /// - Parameters:
    ///   - id: The issue to revise.
    ///   - title: The title to replace the old one with. Left out, the title is untouched.
    ///   - description: A three-way edit of the description: `.keep` leaves it, `.clear` empties it,
    ///     `.set(…)` replaces it.
    ///   - inScope: The scope statement to replace the old one with. Left out, it is untouched.
    ///   - outOfScope: The non-scope statement to replace the old one with. Left out, it is
    ///     untouched.
    ///   - completionCriteria: The completion criteria to replace the old ones with. Left out, they
    ///     are untouched.
    ///   - status: Where the issue now stands. Left out, the status is untouched.
    ///   - epic: A three-way change of epic grouping: `.keep` leaves it, `.ungroup` detaches the
    ///     issue, `.set(…)` regroups it.
    /// - Throws: `ToolError` with `.notFound` for an unknown id, and `.invalidArgument` when nothing
    ///   was named to change.
    public static func updateIssue(
        _ id: String, title: String? = nil, description: TextEdit = .keep,
        inScope: String? = nil, outOfScope: String? = nil, completionCriteria: String? = nil,
        status: IssueStatus? = nil, epic: EpicAssignment = .keep
    ) throws {
        try withScratch { scratch in
            var id = scratch.string(id)
            var patch = test_cabinet_gg_board_issue_patch_t(
                title: scratch.optional(title),
                description: scratch.textEdit(description),
                in_scope: scratch.optional(inScope),
                out_of_scope: scratch.optional(outOfScope),
                completion_criteria: scratch.optional(completionCriteria),
                status: test_cabinet_gg_board_option_issue_status_t(
                    is_some: status != nil, val: status?.wire ?? 0),
                epic: scratch.epicAssignment(epic))
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_update_issue(&id, &patch, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Replace an issue's whole blocker set; an empty array clears every blocker.
    ///
    /// - Parameters:
    ///   - id: The issue whose blockers to replace.
    ///   - to: The ids of every issue that must now be done before it. An empty array clears them
    ///     all.
    /// - Throws: `ToolError` with `.notFound` for an unknown id, and `.conflict` when an edge would
    ///   close a cycle.
    public static func setIssueBlockedBy(_ id: String, to blockedBy: [String]) throws {
        try withScratch { scratch in
            var id = scratch.string(id)
            var blockedBy = scratch.list(blockedBy)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_set_issue_blocked_by(&id, &blockedBy, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
    ///
    /// - Parameter id: The epic to remove.
    /// - Returns: the board budget after the removal.
    /// - Throws: `ToolError` with `.notFound` for an unknown id.
    @discardableResult
    public static func removeEpic(_ id: String) throws -> BoardUsage {
        try withScratch { scratch in
            var id = scratch.string(id)
            var ret = test_cabinet_gg_board_board_usage_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_remove_epic(&id, &ret, &err) else {
                throw lift(failure: &err)
            }
            return BoardUsage(wire: ret)
        }
    }

    /// Remove an issue and every blocker edge pointing at it, and hand back the board budget.
    ///
    /// - Parameter id: The issue to remove.
    /// - Returns: the board budget after the removal.
    /// - Throws: `ToolError` with `.notFound` for an unknown id.
    @discardableResult
    public static func removeIssue(_ id: String) throws -> BoardUsage {
        try withScratch { scratch in
            var id = scratch.string(id)
            var ret = test_cabinet_gg_board_board_usage_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_remove_issue(&id, &ret, &err) else {
                throw lift(failure: &err)
            }
            return BoardUsage(wire: ret)
        }
    }

    /// Register a wait on an issue and hand back an acknowledgement.
    ///
    /// It does not block inside your program — it records the wait and returns at once, so the rest
    /// of your program still runs; the suspension happens after the program ends, between turns. Once
    /// the program finishes the run suspends, freeing this agent's slot for others, until the issue
    /// is terminal (done, or failed if its assigned agent could not complete it), then resumes on the
    /// next turn. Use it to sequence your next turn's work behind an issue you depend on. You cannot
    /// wait on the issue you were assigned to implement.
    ///
    /// - Parameter id: The issue to wait on. It may not be the issue you were assigned.
    /// - Returns: gg's acknowledgement of the registered wait.
    /// - Throws: `ToolError` with `.notFound` for an unknown id.
    @discardableResult
    public static func waitForIssue(_ id: String) throws -> String {
        try withScratch { scratch in
            var id = scratch.string(id)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_board_wait_for_issue(&id, &ret, &err) else {
                throw lift(failure: &err)
            }
            let acknowledgement = lift(ret)
            sandbox_string_free(&ret)
            return acknowledgement
        }
    }
}
