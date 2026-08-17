/**
 * Handing scoped work to child agents, and handing this session on to another agent.
 *
 * Waiting for children can dominate a turn's wall clock — it blocks while real agents run — and the
 * run's budget keeps ticking while it does, so a program does better to spawn broadly and wait once
 * than to spawn and wait in a loop.
 *
 * The brief is where this arm's types earn their keep: a child is briefed either with a self-contained
 * prompt or with a board issue, and because that choice is a sealed type rather than two optional
 * arguments, "both" and "neither" are programs that do not compile.
 *
 * @ggmodule delegation
 */
package gg.delegation

import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggText
import gg.internal.ggTexts
import gg.internal.lowered


/**
 * Delegate scoped work to a child agent and hand back its handle immediately.
 *
 * The child runs in parallel while the program continues. The agent named is one of those this agent
 * may spawn — the system prompt lists them — and it selects the child's model, tools and
 * instructions. The child shares this workspace.
 *
 * @ggop delegation.spawn_subagent
 * @param agent The agent profile to run the child as, from the ones this agent may spawn.
 * @param brief What the child is to do: `Brief.Prompt` with self-contained instructions, or
 *   `Brief.Issue` with the id of a board issue to brief it from.
 * @return the child's handle, to wait on or to message
 * @throws ApiError `LIMIT_EXCEEDED` at the delegation depth cap, and `INVALID_ARGUMENT` for an agent
 *   this one may not spawn.
 */
public fun spawnSubagent(agent: String, brief: Brief): SubagentHandle {
    val request = ggRecord().put("agent", ggText(agent)).put("task", brief.lowered())
    return Read.subagentHandle(ggCall("delegation.spawn_subagent", request))
}

/**
 * Block until the named children have finished, and collect their results in dispatch order.
 *
 * Naming none waits for every child still outstanding. The run's wall-clock budget keeps running
 * while the wait does, so one wait for many children costs less than one wait per child.
 *
 * @ggop delegation.wait_for_subagents
 * @param ids The children to wait for, as spawning returned them. Naming none waits for every one
 *   still outstanding.
 * @return every collected child's result, in dispatch order
 * @throws ApiError `NOT_FOUND` for an unknown id.
 */
public fun waitForSubagents(vararg ids: String): List<SubagentResult> =
    Read.subagentResults(
        ggCall("delegation.wait_for_subagents", ggTexts(ids.asIterable())),
    )

/**
 * Deliver a message to a running child agent's inbox, which it reads at its next turn.
 *
 * @ggop delegation.send_message
 * @param agentId The child to deliver to, as spawning returned it.
 * @param message What to put in its inbox.
 * @throws ApiError `NOT_FOUND` for an unknown agent id, and `CONFLICT` when that child has already
 *   returned.
 */
public fun sendMessage(agentId: String, message: String) {
    ggRun("delegation.send_message", ggText(agentId), ggText(message))
}

/**
 * Move the state machine driving this session on to another of its states.
 *
 * The state is named the way an agent to spawn is named. It is bound only when a state machine is
 * driving the session and the current state has somewhere to go.
 *
 * Like compaction it is registered rather than performed: the call validates the target, returns, and
 * the program runs on to its end — the transition happens after that, because replacing the agent and
 * its window mid-program would pull every remaining call out from under it. The first declaration in
 * a turn stands.
 *
 * @ggop delegation.transition_state
 * @param state The state to move on to, named the way an agent to spawn is named.
 * @param note The opening message the next state's agent sees. Left out, it sees nothing.
 * @throws ApiError `INVALID_ARGUMENT` for a state this session may not move to, and `REFUSED` for a
 *   second declaration in one turn.
 */
public fun transitionState(state: String, note: String? = null) {
    ggRun("delegation.transition_state", ggText(state), ggText(note))
}

/**
 * Continue this session as a different agent, from the next turn on.
 *
 * The named agent takes over with its own model, tools and instructions, keeping every capability the
 * two of them both have — the whole conversation above all, so it needs no catching up.
 *
 * Registered rather than performed, exactly as a state transition is and for the same reason: the
 * window would otherwise be pulled out from under the program still composing into it. A session
 * makes one succession per turn. It is bound only when this agent may make agent transitions and has
 * agents it may become, and never while a state machine is driving the session.
 *
 * @ggop delegation.exec
 * @param agent The agent to become, from the ones this agent may become.
 * @param prompt The opening message for it. It already holds the whole conversation, so this is the
 *   instruction rather than a briefing. Left out, it is given nothing.
 * @throws ApiError `INVALID_ARGUMENT` for an agent this one may not become, and `REFUSED` for a
 *   second succession in one turn.
 */
public fun exec(agent: String, prompt: String? = null) {
    ggRun("delegation.exec", ggText(agent), ggText(prompt))
}

/**
 * Run a copy of this agent, in parallel, on something it will not do itself.
 *
 * The copy has the same model, the same tools and a private copy of the whole conversation, so the
 * prompt is the difference rather than a briefing: everything already worked out is already there.
 *
 * Its handle comes back immediately, but the copy itself starts once this turn's tool results are
 * recorded, because the conversation it inherits has to be a complete one. So a wait can only collect
 * it on a later turn, and waiting on it in the program that made it never returns anything.
 *
 * @ggop delegation.fork
 * @param prompt What the copy is to do instead. It holds the whole conversation already, so this is
 *   the difference rather than a briefing.
 * @return the copy's handle, to collect on a later turn
 * @throws ApiError `LIMIT_EXCEEDED` at the delegation depth cap.
 */
public fun fork(prompt: String): SubagentHandle =
    Read.subagentHandle(ggCall("delegation.fork", ggText(prompt)))

/**
 * What a child agent is briefed with.
 *
 * The choice is a sealed type rather than a pair of optional arguments, so "both" and "neither" are
 * programs that do not compile instead of calls that fail at run time.
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
     * Brief the child from a board issue, as creating one returned its id.
     *
     * @property issueId The id of the issue to brief the child from.
     */
    public data class Issue(val issueId: String) : Brief
}

/**
 * A child agent that was spawned and is now running in parallel.
 *
 * @property id The child's id, which waiting for it and messaging it both take.
 * @property slot The agent profile it runs as.
 * @property modelId The model actually bound to that agent.
 */
public data class SubagentHandle(val id: String, val slot: String, val modelId: String) {
    /**
     * Deliver a message to this child's inbox, with its id already supplied.
     *
     * `gg.delegation.sendMessage` for the common case where the handle is in hand, written as a
     * member so that the value carrying the id is what the call hangs off.
     *
     * @ggalias delegation.send_message
     * @param message What to put in its inbox, which it reads at its next turn.
     * @throws ApiError `CONFLICT` when this child has already returned.
     */
    public fun send(message: String) {
        sendMessage(id, message)
    }
}

/**
 * One child agent's collected result.
 *
 * @property id The child's id.
 * @property status How it finished; `null` when it produced no return value at all.
 * @property summary Its final message.
 */
public data class SubagentResult(val id: String, val status: AgentEnding?, val summary: String)

/** How a child agent's loop ended — gg's own six words, as the tool-calling path reports them too. */
public enum class AgentEnding {
    /** It finished normally, and its summary is what it returned. */
    COMPLETED,

    /** It reached the per-run turn ceiling. */
    EXHAUSTED,

    /** It passed its wall-clock deadline. */
    TIMED_OUT,

    /** A model turn failed. */
    MODEL_ERROR,

    /** The run's credential was refused. */
    AUTH_ERROR,

    /** An execution ceiling stopped it: consecutive errors, error rate, or cost. */
    LIMIT_EXCEEDED,
}

