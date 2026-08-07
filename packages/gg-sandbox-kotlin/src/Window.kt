/**
 * Which of the three kinds a view is.
 *
 * The taxonomy is closed at three on purpose: everything on disk is a file, everything a program can
 * compute is a string, and documentation is neither — gg holds it.
 */
public enum class ViewKind {
    /** A file you opened; its selector is the path. */
    FILE,

    /**
     * A value you showed yourself; its selector is the label you gave it. A directory listing, a
     * command's output, a child agent's answer and a table you assembled are all this.
     */
    TEXT,

    /** A function's documentation; its selector is the function's name. */
    DOCS,
}

/**
 * The window of lines a **paged** file view covers.
 *
 * @property offset The 1-based first line the view shows.
 * @property limit How many lines it shows.
 */
public data class ViewRegion(val offset: Int, val limit: Int)

/**
 * One view open in your context window, as `view.current` reports it.
 *
 * @property kind Whether it is a file, text, or documentation view.
 * @property selector What `view.close` takes: a file's path, a text view's label, or a documentation
 *   view's function name.
 * @property tokens Roughly what holding it costs you, in tokens.
 * @property region The line window a paged file view covers; `null` for a whole-file view and for text
 *   views.
 */
public data class OpenView(
    val kind: ViewKind,
    val selector: String,
    val tokens: Int,
    val region: ViewRegion?,
)

/**
 * What a context reclaim actually freed from the live context window.
 *
 * @property items Context items dropped from the live window.
 * @property reclaimedTokens Approximately how many tokens that freed.
 * @property paths The workspace paths whose views were evicted. Empty for an archive.
 * @property detail The prose summary of what was reclaimed.
 */
public data class ReclaimReport(
    val items: Int,
    val reclaimedTokens: Int,
    val paths: List<String>,
    val detail: String,
)

/** Who said an archived message. */
public enum class MessageRole {
    /** The system prompt. */
    SYSTEM,

    /** A turn's input to you — a result, a view, or an operator's instruction. */
    USER,

    /** Something you said. */
    ASSISTANT,

    /** A tool result, on a session that made tool calls rather than writing programs. */
    TOOL,
}

/**
 * One archived message that matched a search.
 *
 * @property seq The archived message's sequence number.
 * @property role Who said it.
 * @property text The message text.
 */
public data class ArchiveHit(val seq: Int, val role: MessageRole, val text: String)

/**
 * What `context.searchArchive` found.
 *
 * @property archiveEmpty Nothing has been archived yet, so there was nothing to search. Deliberately
 *   distinct from a search that ran and matched nothing, so you do not archive again believing the first
 *   archive failed.
 * @property hits The matches, most recent first, at most 8.
 */
public data class ArchiveSearch(val archiveEmpty: Boolean, val hits: List<ArchiveHit>)
