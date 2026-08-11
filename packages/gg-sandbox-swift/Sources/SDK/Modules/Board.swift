/// The epic and issue board, on which work is decomposed into dispatchable units.
///
/// An issue is heavyweight and self-contained: its scope, non-scope and completion criteria are
/// exactly what a delegated child agent is briefed from, which is why `createIssue` asks for more
/// than `tasks.addTask` does.
///
/// Two of `updateIssue`'s arguments are three-way, and Swift has an `enum` for exactly that:
/// `core.TextEdit` leaves, empties or replaces a description, and `board.EpicAssignment` leaves,
/// detaches or regroups an epic. Neither needs a sentinel.
///
/// - ggmodule: board
public enum board {
    /// The gg tools this module dispatches — see `files.ggTools`.
    static let ggTools = [
        "create_epic", "create_issue", "update_issue", "set_issue_blocked_by", "remove_epic",
        "remove_issue", "wait_for_issue",
    ]

    /// Create an epic to group related issues, and hand back the id its prefix resolved to.
    ///
    /// `prefix` is 3-6 letters naming the epic; it is upper-cased and becomes the epic's id, which
    /// is also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`,
    /// `AUTH-2`, and so on.
    ///
    /// - Parameters:
    ///   - prefix: 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
    ///     issues are numbered from.
    ///   - title: A short line naming the body of work.
    ///   - description: What the epic covers, for a reader who has not seen its issues.
    /// - Returns: the epic's id, and the board budget.
    /// - Throws: `core.ToolError` with `.invalidArgument` when the prefix is not 3-6 letters,
    ///   `.conflict` when another epic already holds it, and `.limitExceeded` at the board's epic
    ///   cap.
    /// - ggop: board.create_epic
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

    /// Create a self-contained, dispatchable issue, and hand back the id the board assigned it.
    ///
    /// The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it
    /// has no epic. It is the board's to choose, so it is worth keeping: blocking a later issue on
    /// this one, and waiting for it, both take it. `inScope`, `outOfScope` and `completionCriteria`
    /// are what a child agent is briefed from, so they are written for a reader with no other
    /// context.
    ///
    /// - Parameters:
    ///   - title: A short line naming the work.
    ///   - inScope: What the issue covers, precisely. Part of the brief a child agent is given.
    ///   - outOfScope: What the issue deliberately does not cover, so the work stops where it was
    ///     meant to.
    ///   - completionCriteria: What must be true for the issue to be done. It is what a reviewer
    ///     checks the work against.
    ///   - agent: The agent the issue is dispatched to. It must be one this agent may spawn.
    ///   - description: What the work is, for a child agent with no other context. Left out, the
    ///     issue has none.
    ///   - blockedBy: The ids of every issue that must be done before this one. Empty by default.
    ///   - epic: The id of an existing epic to group it under. Left out, the issue is ungrouped and
    ///     numbered under `ISSUE`.
    ///   - reviewers: The agents that must approve the work, from the set this agent may spawn.
    ///     Required when this run's reviewers feature is on, and empty otherwise.
    /// - Returns: the id the board assigned, and the board budget.
    /// - Throws: `core.ToolError` with `.invalidArgument` when `agent` or a reviewer is not one this
    ///   agent may assign, `.notFound` for an unknown epic or blocker, and `.conflict` on a blocker
    ///   edge that would close a cycle.
    /// - ggop: board.create_issue
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

    /// Revise an issue; at least one field must be supplied.
    ///
    /// An argument left out is left alone, `description: .clear` empties the description, and
    /// `epic: .ungroup` detaches the issue from its epic.
    ///
    /// - Parameters:
    ///   - id: The issue to revise.
    ///   - title: The title to replace the old one with. Left out, the title is untouched.
    ///   - description: A three-way edit of the description: `.keep` leaves it, `.clear` empties it,
    ///     `.set` replaces it.
    ///   - inScope: The scope statement to replace the old one with. Left out, it is untouched.
    ///   - outOfScope: The non-scope statement to replace the old one with. Left out, it is
    ///     untouched.
    ///   - completionCriteria: The completion criteria to replace the old ones with. Left out, they
    ///     are untouched.
    ///   - status: Where the issue now stands. Left out, the status is untouched.
    ///   - epic: A three-way change of epic grouping: `.keep` leaves it, `.ungroup` detaches the
    ///     issue, `.set` regroups it.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown issue or epic id, and
    ///   `.invalidArgument` when nothing was named to change.
    /// - ggop: board.update_issue
    public static func updateIssue(
        _ id: String, title: String? = nil, description: core.TextEdit = .keep,
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
    /// - Throws: `core.ToolError` with `.notFound` for an issue or blocker the board does not hold,
    ///   and `.conflict` when an edge would close a cycle or block the issue on itself.
    /// - ggop: board.set_issue_blocked_by
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

    /// Remove an epic, keeping its issues and ungrouping them.
    ///
    /// - Parameter id: The epic to remove.
    /// - Returns: the board budget after the removal.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown id.
    /// - ggop: board.remove_epic
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

    /// Remove an issue and every blocker edge pointing at it.
    ///
    /// - Parameter id: The issue to remove.
    /// - Returns: the board budget after the removal.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown id.
    /// - ggop: board.remove_issue
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
    /// Nothing blocks inside the program: the wait is recorded and the call returns at once, so the
    /// rest of the program still runs. The suspension happens after the program ends, between turns
    /// — the run frees this agent's slot until the issue is terminal, done or failed, then resumes
    /// on the next turn. It is how a turn's work is sequenced behind an issue it depends on. The
    /// issue this agent was assigned to implement is the one issue it may not wait on.
    ///
    /// - Parameter id: The issue to wait on. It may not be the issue this agent was assigned.
    /// - Returns: gg's acknowledgement of the registered wait.
    /// - Throws: `core.ToolError` with `.invalidArgument` for this agent's own assigned issue, and
    ///   `.notFound` for an id the board does not hold.
    /// - ggop: board.wait_for_issue
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

    /// Where an issue stands.
    public enum IssueStatus: Sendable {
        /// Not started, and dispatchable once its blockers are done.
        case open
        /// Dispatched, with its assigned agent working on it.
        case inProgress
        /// Finished and, where this run requires reviewers, approved.
        case done

        /// The wire's value for this case.
        var wire: test_cabinet_gg_board_issue_status_t {
            switch self {
            case .open:
                test_cabinet_gg_board_issue_status_t(TEST_CABINET_GG_BOARD_ISSUE_STATUS_OPEN)
            case .inProgress:
                test_cabinet_gg_board_issue_status_t(TEST_CABINET_GG_BOARD_ISSUE_STATUS_IN_PROGRESS)
            case .done:
                test_cabinet_gg_board_issue_status_t(TEST_CABINET_GG_BOARD_ISSUE_STATUS_DONE)
            }
        }
    }

    /// How an issue's epic grouping changes.
    ///
    /// The same three-way shape as `core.TextEdit`, for a field whose value is an epic id.
    public enum EpicAssignment: Sendable {
        /// Leave the grouping alone.
        case keep
        /// Detach the issue from its epic, leaving it ungrouped.
        case ungroup
        /// Group the issue under this epic, by its id.
        case set(String)
    }

    /// How much of the run's board budget is used, after the call that returned it.
    public struct BoardUsage: Sendable {
        /// Epics currently on the board.
        public let epics: Int
        /// The most epics this run allows.
        public let maxEpics: Int
        /// Issues currently on the board.
        public let issues: Int
        /// The most issues this run allows.
        public let maxIssues: Int

        init(wire: test_cabinet_gg_board_board_usage_t) {
            epics = Int(wire.epics)
            maxEpics = Int(wire.max_epics)
            issues = Int(wire.issues)
            maxIssues = Int(wire.max_issues)
        }
    }

    /// An epic that was just created: the id its prefix resolved to, and the board budget.
    public struct EpicCreated: Sendable {
        /// The epic's id — the given prefix, upper-cased (`auth` → `AUTH`).
        ///
        /// It is what groups issues under the epic, and the stem its issues are numbered from
        /// (`AUTH-1`).
        public let id: String
        /// How much of the board budget is used.
        public let board: BoardUsage

        init(wire: test_cabinet_gg_board_epic_created_t) {
            id = lift(wire.id)
            board = BoardUsage(wire: wire.board)
        }
    }

    /// An issue that was just created: the id the board assigned it, and the board budget.
    public struct IssueCreated: Sendable {
        /// The id the board assigned (`AUTH-1`), which is the board's to choose rather than the
        /// caller's.
        ///
        /// It is what blocks a later issue on this one, and what waits for it.
        public let id: String
        /// How much of the board budget is used.
        public let board: BoardUsage

        init(wire: test_cabinet_gg_board_issue_created_t) {
            id = lift(wire.id)
            board = BoardUsage(wire: wire.board)
        }
    }
}

extension board.IssueCreated {
    /// Register a wait on this issue, with its id already supplied.
    ///
    /// `board.waitForIssue` for the common case where the created issue is in hand.
    ///
    /// - Returns: gg's acknowledgement of the registered wait.
    /// - Throws: `core.ToolError` with `.invalidArgument` when this is the issue the agent was
    ///   assigned.
    /// - ggop-alias: board.wait_for_issue
    @discardableResult
    public func wait() throws -> String {
        try gg.board.waitForIssue(id)
    }
}
