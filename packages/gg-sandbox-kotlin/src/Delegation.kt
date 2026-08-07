/**
 * What a child agent is briefed with.
 *
 * The choice is a **sealed** type rather than a pair of optional arguments, so "both" and "neither" are
 * programs that do not compile instead of calls that fail at run time:
 * `agents.spawnSubagent("builder", Brief.Prompt("write the parser"))` or
 * `agents.spawnSubagent("builder", Brief.Issue("AUTH-1"))`.
 */
public sealed interface Brief {
    /**
     * Brief the child with self-contained instructions, so it needs no other context.
     *
     * @property instructions Everything the child needs to know, written for a reader with no other
     *   context.
     */
    public data class Prompt(val instructions: String) : Brief

    /**
     * Brief the child from a board issue, as `project.createIssue` returned its id.
     *
     * @property issueId The id of the issue to brief the child from.
     */
    public data class Issue(val issueId: String) : Brief
}

/**
 * Which field of the spawn request this brief fills, and what it fills it with.
 *
 * An extension rather than two members of [Brief], because a Kotlin interface has no `internal` members
 * — and a public one would put gg's own wire spelling on a type a model reads.
 */
internal fun Brief.lowered(): Pair<String, String> =
    when (this) {
        is Brief.Prompt -> "prompt" to instructions
        is Brief.Issue -> "issueId" to issueId
    }

/**
 * A child agent that was spawned and is now running in parallel.
 *
 * @property id The child's id — pass it to `agents.waitForSubagents` or `agents.sendMessage`.
 * @property slot The agent profile it runs as.
 * @property modelId The model actually bound to that agent.
 */
public data class SubagentHandle(val id: String, val slot: String, val modelId: String)

/** How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them. */
public enum class AgentEnding {
    /** It finished normally: it called `harness.finish`, and its summary is what it returned. */
    COMPLETED,

    /** It hit the per-run turn ceiling. */
    EXHAUSTED,

    /** It passed its wall-clock deadline. */
    TIMED_OUT,

    /** A model turn failed. */
    MODEL_ERROR,

    /** The run's credential was refused. */
    AUTH_ERROR,

    /** An execution ceiling stopped it — consecutive errors, error rate, or cost. */
    LIMIT_EXCEEDED,
}

/**
 * One child agent's collected result.
 *
 * @property id The child's id.
 * @property status How it finished; `null` when it produced no return value at all.
 * @property summary Its final message.
 */
public data class SubagentResult(val id: String, val status: AgentEnding?, val summary: String)

/**
 * One program you have already run, as `programs.history` lists it.
 *
 * It describes the program's **shape**, never its source: a directory that inlined every program would
 * put the whole session back in front of you, which is the one thing the library exists to avoid. Fetch
 * the source you actually want with `programs.get`.
 *
 * @property turn The turn it ran on — what `programs.get` takes.
 * @property lines How many lines of source it was.
 * @property chars How many characters of source it was.
 * @property ok Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
 * @property error The error it ended with, when it did not run to its end.
 */
public data class ProgramSummary(
    val turn: Int,
    val lines: Int,
    val chars: Int,
    val ok: Boolean,
    val error: String?,
)
