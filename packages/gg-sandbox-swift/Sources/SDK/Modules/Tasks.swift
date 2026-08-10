/// A private task list, kept as a directed acyclic graph rather than as a list of lines.
///
/// Every task may name the tasks that must finish before it, and an edge that would close a cycle
/// is refused.
///
/// One argument here is worth reading twice. `updateTask`'s `description` is a three-way edit, and
/// `core.TextEdit` says all three without a sentinel: `.keep` keeps the description that is there,
/// `.clear` empties it, `.set` replaces it.
///
/// - ggmodule: tasks
public enum tasks: ModuleDirectory {
    /// The gg module this namespace is, which is what its directory is looked up by.
    public static let ggModule = "gg.tasks"

    /// The gg tools this module dispatches — see `files.ggTools`.
    static let ggTools = [
        "add_task", "update_task", "set_blocked_by", "complete_task", "remove_task",
    ]

    /// Add a task to the task graph and hand back the task budget.
    ///
    /// - Parameters:
    ///   - id: The id chosen for it. Every other task call takes it, and no two tasks may share
    ///     one.
    ///   - title: A short line naming the work.
    ///   - description: What the work is, at whatever length is useful. Left out, the task has none.
    ///   - blockedBy: The ids of the tasks that must be done before this one. Empty by default.
    /// - Returns: the task budget after the addition.
    /// - Throws: `core.ToolError` with `.conflict` on a duplicate id or on an edge that would close
    ///   a cycle, `.notFound` for an unknown blocker, and `.limitExceeded` at the task cap.
    /// - ggop: tasks.add_task
    @discardableResult
    public static func addTask(
        _ id: String, title: String, description: String? = nil, blockedBy: [String] = []
    ) throws -> TaskUsage {
        try withScratch { scratch in
            var input = test_cabinet_gg_tasks_task_input_t(
                id: scratch.string(id),
                title: scratch.string(title),
                description: scratch.optional(description),
                blocked_by: scratch.list(blockedBy))
            var ret = test_cabinet_gg_tasks_task_usage_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_tasks_add_task(&input, &ret, &err) else {
                throw lift(failure: &err)
            }
            return TaskUsage(wire: ret)
        }
    }

    /// Revise a task's title, description or status; at least one must be supplied.
    ///
    /// An argument left out is left alone, `description: .clear` empties the description, and
    /// `description: .set("…")` replaces it.
    ///
    /// - Parameters:
    ///   - id: The task to revise.
    ///   - title: The title to replace the old one with. Left out, the title is untouched.
    ///   - description: A three-way edit of the description: `.keep` leaves it, `.clear` empties it,
    ///     `.set` replaces it.
    ///   - status: Where the task now stands. Left out, the status is untouched.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown id, and `.invalidArgument` when
    ///   nothing was named to change.
    /// - ggop: tasks.update_task
    public static func updateTask(
        _ id: String, title: String? = nil, description: core.TextEdit = .keep,
        status: TaskStatus? = nil
    ) throws {
        try withScratch { scratch in
            var id = scratch.string(id)
            var patch = test_cabinet_gg_tasks_task_patch_t(
                title: scratch.optional(title),
                description: scratch.textEdit(description),
                status: test_cabinet_gg_tasks_option_task_status_t(
                    is_some: status != nil, val: status?.wire ?? 0))
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_tasks_update_task(&id, &patch, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Replace a task's whole blocker set; an empty array clears every blocker.
    ///
    /// - Parameters:
    ///   - id: The task whose blockers to replace.
    ///   - to: The ids of every task that must now be done before it. An empty array clears them
    ///     all.
    /// - Throws: `core.ToolError` with `.notFound` for a task or blocker that is not on the list,
    ///   and `.conflict` when an edge would close a cycle or block the task on itself.
    /// - ggop: tasks.set_blocked_by
    public static func setBlockedBy(_ id: String, to blockedBy: [String]) throws {
        try withScratch { scratch in
            var id = scratch.string(id)
            var blockedBy = scratch.list(blockedBy)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_tasks_set_blocked_by(&id, &blockedBy, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Mark a task done.
    ///
    /// Tasks it was blocking become actionable once every one of their blockers is done.
    ///
    /// - Parameter id: The task to mark done.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown id.
    /// - ggop: tasks.complete_task
    public static func completeTask(_ id: String) throws {
        try withScratch { scratch in
            var id = scratch.string(id)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_tasks_complete_task(&id, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Remove a task and every blocker edge pointing at it.
    ///
    /// - Parameter id: The task to remove.
    /// - Returns: the task budget after the removal.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown id.
    /// - ggop: tasks.remove_task
    @discardableResult
    public static func removeTask(_ id: String) throws -> TaskUsage {
        try withScratch { scratch in
            var id = scratch.string(id)
            var ret = test_cabinet_gg_tasks_task_usage_t()
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_tasks_remove_task(&id, &ret, &err) else {
                throw lift(failure: &err)
            }
            return TaskUsage(wire: ret)
        }
    }

    /// Where a task stands.
    public enum TaskStatus: Sendable {
        /// Not started. Every task begins here.
        case pending
        /// Being worked on now.
        case inProgress
        /// Finished. Tasks blocked on it become actionable once all their blockers are done.
        case done

        /// The wire's value for this case.
        var wire: test_cabinet_gg_tasks_task_status_t {
            switch self {
            case .pending:
                test_cabinet_gg_tasks_task_status_t(TEST_CABINET_GG_TASKS_TASK_STATUS_PENDING)
            case .inProgress:
                test_cabinet_gg_tasks_task_status_t(TEST_CABINET_GG_TASKS_TASK_STATUS_IN_PROGRESS)
            case .done:
                test_cabinet_gg_tasks_task_status_t(TEST_CABINET_GG_TASKS_TASK_STATUS_DONE)
            }
        }
    }

    /// How much of the run's task budget is used, after the call that returned it.
    public struct TaskUsage: Sendable {
        /// Tasks currently on the list.
        public let count: Int
        /// The most tasks this run allows.
        public let maxTasks: Int

        init(wire: test_cabinet_gg_tasks_task_usage_t) {
            count = Int(wire.count)
            maxTasks = Int(wire.max_tasks)
        }
    }
}
