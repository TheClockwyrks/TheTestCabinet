import org.teavm.jso.JSObject

/**
 * How much of the run's task budget is used, after the call that returned it.
 *
 * @property count Tasks currently on the list.
 * @property maxTasks The most tasks this run allows.
 */
public data class TaskUsage(val count: Int, val maxTasks: Int)

/**
 * How much of the run's board budget is used, after the call that returned it.
 *
 * @property epics Epics currently on the board.
 * @property maxEpics The most epics this run allows.
 * @property issues Issues currently on the board.
 * @property maxIssues The most issues this run allows.
 */
public data class BoardUsage(
    val epics: Int,
    val maxEpics: Int,
    val issues: Int,
    val maxIssues: Int,
)

/**
 * An epic that was just created: the id its prefix resolved to, and the board budget.
 *
 * @property id The epic's id — the prefix you gave, upper-cased (`auth` → `AUTH`). Group issues under it
 *   with this, and its issues are numbered from it (`AUTH-1`).
 * @property board How much of the board budget is used.
 */
public data class EpicCreated(val id: String, val board: BoardUsage)

/**
 * An issue that was just created: the id the board assigned it, and the board budget.
 *
 * @property id The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later issues
 *   on this one, or to wait for it.
 * @property board How much of the board budget is used.
 */
public data class IssueCreated(val id: String, val board: BoardUsage)

/**
 * Where a task stands.
 *
 * @property wireName gg's own word for this status, which is what both execution modes report.
 */
public enum class TaskStatus(public val wireName: String) {
    /** Not started. Every task begins here. */
    PENDING("pending"),

    /** Being worked on now. */
    IN_PROGRESS("in_progress"),

    /** Finished. Tasks blocked on it become actionable once all their blockers are done. */
    DONE("done"),
}

/**
 * Where an issue stands.
 *
 * @property wireName gg's own word for this status, which is what both execution modes report.
 */
public enum class IssueStatus(public val wireName: String) {
    /** Not started, and dispatchable once its blockers are done. */
    OPEN("open"),

    /** Dispatched, with its assigned agent working on it. */
    IN_PROGRESS("in_progress"),

    /** Finished and, where this run requires reviewers, approved. */
    DONE("done"),
}

/**
 * One field of a revision that can be **cleared** as well as replaced.
 *
 * Most of what `tasks.updateTask` and `project.updateIssue` take is two-way: name it to replace it, leave
 * it out to keep it. A description, and an issue's epic, are three-way — kept, replaced, or emptied — and
 * `null` is already spoken for by the second of those, since leaving an argument out *is* passing `null`
 * in this language. So the third state is a value of its own rather than a sentinel constant, which is
 * what a sealed type is for: leave the argument out to keep what is there, pass [Clear] to empty it, and
 * pass [Replace] to replace it.
 *
 * ```
 * tasks.updateTask("parse", description = Patch.Replace("read the manifest first"))
 * project.updateIssue("AUTH-1", epicId = Patch.Clear)
 * ```
 */
public sealed interface Patch<out T> {
    /**
     * Replace the field with `value`.
     *
     * @property value What to put there instead of what is there now.
     */
    public data class Replace<out T>(val value: T) : Patch<T>

    /** Empty the field, leaving it with nothing. */
    public data object Clear : Patch<Nothing>
}

/** Write this patch onto the record the guest's own function takes. */
internal fun Patch<String>.lower(record: JSObject, field: String) {
    when (this) {
        is Patch.Replace -> ggSet(record, field, ggText(value))
        Patch.Clear -> ggClear(record, field)
    }
}
