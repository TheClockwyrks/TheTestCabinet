namespace Gg;

/// <summary>A private task list, held as a graph with blocker edges.</summary>
/// <remarks>
/// Small units of the agent's own work. Nobody dispatches from it — <c>Board</c> is where other
/// agents pick work up.
/// </remarks>
/// <ggmodule>tasks</ggmodule>
public static partial class Tasks
{
    /// <summary>Add a task to the list.</summary>
    /// <param name="id">The unique short id other tasks reference it by.</param>
    /// <param name="title">What the task is.</param>
    /// <param name="description">A longer description, where a title does not carry it.</param>
    /// <param name="blockedBy">Ids of tasks that must finish first. A cycle is refused.</param>
    /// <returns>how full the task budget now is.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for a blank id or title,
    /// <see cref="ToolErrorCode.Conflict"/> for an id already in use or an edge that would make a
    /// cycle, <see cref="ToolErrorCode.NotFound"/> for a blocker that is not on the list, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the task cap.
    /// </exception>
    /// <ggop>tasks.add_task</ggop>
    public static TaskUsage AddTask(
        string id,
        string title,
        string? description = null,
        string[]? blockedBy = null)
    {
        Internal.Wire.Check(Internal.Native.AddTask(
            id,
            title,
            description,
            Internal.Wire.Or(blockedBy),
            out var count,
            out var maxTasks));
        return new TaskUsage(count, maxTasks);
    }

    /// <summary>Revise a task's title, description and status.</summary>
    /// <remarks>
    /// Everything is optional and what is left out is left alone. The description is a
    /// <see cref="TextEdit"/> rather than a nullable string, so that clearing it and leaving it are
    /// different requests.
    /// </remarks>
    /// <param name="id">The task to revise.</param>
    /// <param name="title">A new title.</param>
    /// <param name="description">A three-way edit of the description: keep it, clear it, or set it.</param>
    /// <param name="status">A new status.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for an unknown id, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> when nothing at all was changed, or a field that
    /// must have a value was blanked.
    /// </exception>
    /// <ggop>tasks.update_task</ggop>
    public static void UpdateTask(
        string id,
        string? title = null,
        TextEdit description = default,
        TaskStatus? status = null) =>
        Internal.Wire.Check(Internal.Native.UpdateTask(
            id,
            title,
            description.Kind,
            description.Text,
            status.HasValue ? (int)status.Value : -1));

    /// <summary>Replace a task's whole blocker set.</summary>
    /// <param name="id">The task whose blockers change.</param>
    /// <param name="blockedBy">
    /// The ids that must finish first, replacing whatever was there. An empty list clears every
    /// blocker.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for a blank id or blocker,
    /// <see cref="ToolErrorCode.NotFound"/> for a task or blocker that is not on the list, and
    /// <see cref="ToolErrorCode.Conflict"/> for an edge that would make a cycle or block the task on
    /// itself.
    /// </exception>
    /// <ggop>tasks.set_blocked_by</ggop>
    public static void SetBlockedBy(string id, params string[] blockedBy) =>
        Internal.Wire.Check(Internal.Native.SetBlockedBy(id, blockedBy));

    /// <summary>Mark a task done.</summary>
    /// <remarks>Tasks it blocked become actionable once every one of their blockers is done.</remarks>
    /// <param name="id">The task that is finished.</param>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for an unknown id.</exception>
    /// <ggop>tasks.complete_task</ggop>
    public static void CompleteTask(string id) => Internal.Wire.Check(Internal.Native.CompleteTask(id));

    /// <summary>Remove a task, and every blocker edge pointing at it.</summary>
    /// <param name="id">The task to drop.</param>
    /// <returns>how full the task budget now is.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for an unknown id.</exception>
    /// <ggop>tasks.remove_task</ggop>
    public static TaskUsage RemoveTask(string id)
    {
        Internal.Wire.Check(Internal.Native.RemoveTask(id, out var count, out var maxTasks));
        return new TaskUsage(count, maxTasks);
    }
}
