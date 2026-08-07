import org.teavm.jso.JSObject

/**
 * The `agents` object: handing scoped work to child agents.
 *
 * `waitForSubagents` can dominate a turn's wall clock — it blocks while real agents run — and the run's
 * budget keeps ticking while it does. A program should therefore spawn broadly and wait once, not
 * spawn-and-wait in a loop.
 *
 * The brief is where this arm's types earn their keep: a child is briefed either with a self-contained
 * [Brief.Prompt] or with a board [Brief.Issue], and because that choice is a **sealed** type rather than
 * two optional arguments, "both" and "neither" are programs that do not compile.
 */
public class Agents internal constructor() : ApiObject("agents") {
    override fun target(): JSObject? = agentsObject()

    /**
     * Delegate scoped work to a child agent and hand back its handle immediately — the child runs in
     * parallel while your program continues.
     *
     * Name the agent to run it as (one of the agents you may spawn — the system prompt lists them; it
     * selects the child's model, tools, and instructions) and brief it with either
     * `Brief.Prompt("self-contained instructions")` or `Brief.Issue("AUTH-1")`. The child shares your
     * workspace.
     *
     * @param agent The agent profile to run the child as, from the ones you may spawn. It selects the
     *   child's model, tools and instructions.
     * @param brief What the child is to do: [Brief.Prompt] with self-contained instructions, or
     *   [Brief.Issue] with the id of a board issue to brief it from.
     * @return the child's handle, to wait on or to message
     * @throws ToolError `LIMIT_EXCEEDED` at the delegation depth cap, and `INVALID_ARGUMENT` if `agent`
     *   is not one you may spawn.
     */
    public fun spawnSubagent(agent: String, brief: Brief): SubagentHandle {
        val request = ggRecord()
        val (field, briefed) = brief.lowered()
        ggSet(request, "agent", ggText(agent))
        ggSet(request, field, ggText(briefed))
        return Read.subagentHandle(
            ggCall("spawn_subagent", target(), owner, "spawnSubagent", ggArgs(request)),
        )
    }

    /**
     * Block until the named children have finished — or, naming none, until every outstanding child has —
     * and collect their results in dispatch order.
     *
     * The run's wall-clock budget keeps running while you wait, so wait once for many children rather
     * than once per child.
     *
     * @param ids The children to wait for, as `agents.spawnSubagent` returned them. Name none to wait for
     *   every one still outstanding.
     * @return every collected child's result, in dispatch order
     * @throws ToolError `NOT_FOUND` for an unknown id.
     */
    public fun waitForSubagents(vararg ids: String): List<SubagentResult> =
        Read.subagentResults(
            ggCall(
                "wait_for_subagents",
                target(),
                owner,
                "waitForSubagents",
                ggArgs(ggTexts(ids.asIterable())),
            ),
        )

    /**
     * Deliver a message to a running child agent's inbox; it reads the message at its next turn.
     *
     * @param agentId The child to deliver to, as `agents.spawnSubagent` returned it.
     * @param message What to put in its inbox. It reads it at its next turn.
     * @throws ToolError `NOT_FOUND` for an unknown agent id, and `CONFLICT` when that child has already
     *   returned.
     */
    public fun sendMessage(agentId: String, message: String) {
        ggRun(
            "send_message",
            target(),
            owner,
            "sendMessage",
            ggArgs(ggText(agentId), ggText(message)),
        )
    }

    /**
     * Move the process you are running inside on to another of its states, naming the state the way you
     * name an agent to spawn.
     *
     * Bound only when a state machine is driving you and the state you are in has somewhere to go. Like
     * `context.compact` it is registered rather than performed: the call validates the target, returns,
     * and your program runs on to its end — the transition happens after that, because replacing your
     * agent (and your window) mid-program would pull every remaining call out from under it. The FIRST
     * declaration stands.
     *
     * @param state The state to move on to, named the way you name an agent to spawn.
     * @param note The opening message the next state's agent sees. Leave it out to say nothing.
     * @throws ToolError `INVALID_ARGUMENT` for a state you may not move to, and `REFUSED` for a second
     *   declaration in one turn.
     */
    public fun transitionState(state: String, note: String? = null) {
        ggRun(
            "transition_state",
            target(),
            owner,
            "transitionState",
            if (note == null) ggArgs(ggText(state)) else ggArgs(ggText(state), ggText(note)),
        )
    }

    /**
     * Continue this session as a different agent: the named agent takes over from your next turn with its
     * own model, tools and instructions, keeping every capability the two of you both have — your whole
     * conversation above all, so it needs no catching up.
     *
     * Registered rather than performed, exactly as `agents.transitionState` is and for the same reason:
     * your window would otherwise be pulled out from under the program still composing into it. A session
     * makes one succession per turn. Bound only when your agent may make agent transitions and has agents
     * it may become, and never while a state machine is driving you.
     *
     * @param agent The agent to become, from the ones you may become.
     * @param prompt Its opening message. It already has your whole conversation, so this is the
     *   instruction rather than a briefing. Leave it out to say nothing.
     * @throws ToolError `INVALID_ARGUMENT` for an agent you may not become, and `REFUSED` for a second
     *   succession in one turn.
     */
    public fun exec(agent: String, prompt: String? = null) {
        ggRun(
            "exec",
            target(),
            owner,
            "exec",
            if (prompt == null) ggArgs(ggText(agent)) else ggArgs(ggText(agent), ggText(prompt)),
        )
    }

    /**
     * Run a copy of yourself, in parallel, on something you will not do yourself.
     *
     * The copy has your model, your tools and a private copy of your whole conversation, so `prompt` is
     * the *difference* rather than a briefing — everything you have worked out is already there.
     *
     * Its handle comes back immediately, but the copy itself starts once this turn's tool results are
     * recorded (the conversation it inherits has to be a complete one), so `agents.waitForSubagents` can
     * only collect it on a later turn — do not wait on it in the program that made it.
     *
     * @param prompt What the copy is to do instead of what you are doing. It has your whole conversation
     *   already, so write the difference rather than a briefing.
     * @return the copy's handle, to collect on a later turn
     * @throws ToolError `LIMIT_EXCEEDED` at the delegation depth cap.
     */
    public fun fork(prompt: String): SubagentHandle =
        Read.subagentHandle(
            ggCall("fork", target(), owner, "fork", ggArgs(ggText(prompt))),
        )
}
