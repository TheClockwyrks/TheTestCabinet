/// your task list
///
/// A DAG rather than a list of lines: every task may name the tasks that must finish before it, and
/// an edge that would close a cycle is refused.
///
/// One argument in here is worth reading twice. `updateTask`'s `description` is a **three-way** edit,
/// and `TextEdit` says all three without a sentinel: leave it at `.keep` to keep the description you
/// have, `.clear` to empty it, `.set(…)` to replace it.
public enum tasks: ApiObject {
    public static let ggObject = "tasks"

    /// The gg tools this object dispatches — see `fs.ggTools`.
    static let ggTools = [
        "add_task", "update_task", "set_blocked_by", "complete_task", "remove_task",
    ]

    /// Add a task to the task DAG and hand back the task budget.
    ///
    /// - Parameters:
    ///   - id: The id you choose for it. It is what every other task call takes, and no two tasks may
    ///     share one.
    ///   - title: A short line naming the work.
    ///   - description: What the work is, at whatever length is useful. Left out, the task has none.
    ///   - blockedBy: The ids of the tasks that must be done before this one. Empty by default.
    /// - Returns: the task budget after the addition.
    /// - Throws: `ToolError` with `.conflict` on a duplicate id or on an edge that would close a
    ///   cycle.
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

    /// Revise a task's title, description and/or status; name at least one of them.
    ///
    /// An argument you leave out is left alone, `description: .clear` empties the description, and
    /// `description: .set("…")` replaces it.
    ///
    /// - Parameters:
    ///   - id: The task to revise.
    ///   - title: The title to replace the old one with. Left out, the title is untouched.
    ///   - description: A three-way edit of the description: `.keep` leaves it, `.clear` empties it,
    ///     `.set(…)` replaces it.
    ///   - status: Where the task now stands. Left out, the status is untouched.
    /// - Throws: `ToolError` with `.notFound` for an unknown id, and `.invalidArgument` when nothing
    ///   was named to change.
    public static func updateTask(
        _ id: String, title: String? = nil, description: TextEdit = .keep,
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
    /// - Throws: `ToolError` with `.notFound` for an unknown id, and `.conflict` when an edge would
    ///   close a cycle.
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

    /// Mark a task done. Tasks it was blocking become actionable once every one of their blockers is
    /// done.
    ///
    /// - Parameter id: The task to mark done.
    /// - Throws: `ToolError` with `.notFound` for an unknown id.
    public static func completeTask(_ id: String) throws {
        try withScratch { scratch in
            var id = scratch.string(id)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_tasks_complete_task(&id, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Remove a task and every blocker edge pointing at it, and hand back the task budget.
    ///
    /// - Parameter id: The task to remove.
    /// - Returns: the task budget after the removal.
    /// - Throws: `ToolError` with `.notFound` for an unknown id.
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
}
