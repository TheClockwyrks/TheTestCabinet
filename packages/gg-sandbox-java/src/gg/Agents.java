package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The {@code agents} object: handing scoped work to child agents.
 *
 * <p>{@code waitForSubagents} can dominate a turn's wall clock — it blocks while real agents run —
 * and the run's budget keeps ticking while it does. A program should therefore spawn broadly and
 * wait once, not spawn-and-wait in a loop.
 *
 * <p>The brief is where this arm's types earn their keep: a child is briefed either with a
 * self-contained {@link Brief#prompt} or with a board {@link Brief#issue}, and because that choice
 * is a type rather than two optional arguments, "both" and "neither" are programs that do not
 * compile.
 */
public final class Agents extends ApiObject {
    Agents() {
        super("agents");
    }

    @Override
    JSObject target() {
        return Wire.agents();
    }

    /**
     * Delegate scoped work to a child agent and hand back its handle immediately — the child runs
     * in parallel while your program continues.
     *
     * <p>Name the agent to run it as (one of the agents you may spawn — the system prompt lists
     * them; it selects the child's model, tools, and instructions) and brief it with either
     * {@code Brief.prompt("self-contained instructions")} or {@code Brief.issue("AUTH-1")}. The
     * child shares your workspace.
     *
     * @param agent The agent profile to run the child as, from the ones you may spawn. It selects
     *     the child's model, tools and instructions.
     * @param brief What the child is to do: {@code Brief.prompt} with self-contained instructions,
     *     or {@code Brief.issue} with the id of a board issue to brief it from.
     * @return the child's handle, to wait on or to message
     * @throws ToolError {@code LIMIT_EXCEEDED} at the delegation depth cap, and
     *     {@code INVALID_ARGUMENT} if {@code agent} is not one you may spawn.
     */
    public SubagentHandle spawnSubagent(String agent, Brief brief) {
        JSObject request = Wire.object();
        Wire.set(request, "agent", Wire.text(agent));
        Wire.set(request, brief.field(), Wire.text(brief.value()));
        return Read.subagentHandle(Wire.call("spawn_subagent", target(), object(),
                "spawnSubagent", Wire.args(request)));
    }

    /**
     * Block until the named children have finished — or, naming none, until every outstanding
     * child has — and collect their results in dispatch order.
     *
     * <p>The run's wall-clock budget keeps running while you wait, so wait once for many children
     * rather than once per child.
     *
     * @param ids The children to wait for, as {@code agents.spawnSubagent} returned them. Name
     *     none to wait for every one still outstanding.
     * @return every collected child's result, in dispatch order
     * @throws ToolError {@code NOT_FOUND} for an unknown id.
     */
    public List<SubagentResult> waitForSubagents(String... ids) {
        return Read.subagentResults(Wire.call("wait_for_subagents", target(), object(),
                "waitForSubagents", Wire.args(Wire.texts(ids))));
    }

    /**
     * Deliver a message to a running child agent's inbox; it reads the message at its next turn.
     *
     * @param agentId The child to deliver to, as {@code agents.spawnSubagent} returned it.
     * @param message What to put in its inbox. It reads it at its next turn.
     * @throws ToolError {@code NOT_FOUND} for an unknown agent id, and {@code CONFLICT} when that
     *     child has already returned.
     */
    public void sendMessage(String agentId, String message) {
        Wire.run("send_message", target(), object(), "sendMessage",
                Wire.args(Wire.text(agentId), Wire.text(message)));
    }

    /**
     * Move the process you are running inside on to another of its states, naming the state the
     * way you name an agent to spawn.
     *
     * <p>Bound only when a state machine is driving you and the state you are in has somewhere to
     * go. Like {@code context.compact} it is registered rather than performed: the call validates
     * the target, returns, and your program runs on to its end — the transition happens after
     * that, because replacing your agent (and your window) mid-program would pull every remaining
     * call out from under it. The FIRST declaration stands.
     *
     * @param state The state to move on to, named the way you name an agent to spawn.
     * @throws ToolError {@code INVALID_ARGUMENT} for a state you may not move to, and
     *     {@code REFUSED} for a second declaration in one turn.
     */
    public void transitionState(String state) {
        Wire.run("transition_state", target(), object(), "transitionState",
                Wire.args(Wire.text(state)));
    }

    /**
     * Move on to another state, telling the agent that takes over something as it starts.
     *
     * @param state The state to move on to, named the way you name an agent to spawn.
     * @param note The opening message the next state's agent sees.
     * @throws ToolError {@code INVALID_ARGUMENT} for a state you may not move to, and
     *     {@code REFUSED} for a second declaration in one turn.
     */
    public void transitionState(String state, String note) {
        Wire.run("transition_state", target(), object(), "transitionState",
                Wire.args(Wire.text(state), Wire.text(note)));
    }

    /**
     * Continue this session as a different agent: the named agent takes over from your next turn
     * with its own model, tools and instructions, keeping every capability the two of you both
     * have — your whole conversation above all, so it needs no catching up.
     *
     * <p>Registered rather than performed, exactly as {@code agents.transitionState} is and for
     * the same reason: your window would otherwise be pulled out from under the program still
     * composing into it. A session makes one succession per turn. Bound only when your agent may
     * make agent transitions and has agents it may become, and never while a state machine is
     * driving you.
     *
     * @param agent The agent to become, from the ones you may become.
     * @throws ToolError {@code INVALID_ARGUMENT} for an agent you may not become, and
     *     {@code REFUSED} for a second succession in one turn.
     */
    public void exec(String agent) {
        Wire.run("exec", target(), object(), "exec", Wire.args(Wire.text(agent)));
    }

    /**
     * Continue this session as a different agent, telling it what to do as it takes over.
     *
     * @param agent The agent to become, from the ones you may become.
     * @param prompt Its opening message. It already has your whole conversation, so this is the
     *     instruction rather than a briefing.
     * @throws ToolError {@code INVALID_ARGUMENT} for an agent you may not become, and
     *     {@code REFUSED} for a second succession in one turn.
     */
    public void exec(String agent, String prompt) {
        Wire.run("exec", target(), object(), "exec",
                Wire.args(Wire.text(agent), Wire.text(prompt)));
    }

    /**
     * Run a copy of yourself, in parallel, on something you will not do yourself.
     *
     * <p>The copy has your model, your tools and a private copy of your whole conversation, so
     * {@code prompt} is the <em>difference</em> rather than a briefing — everything you have
     * worked out is already there.
     *
     * <p>Its handle comes back immediately, but the copy itself starts once this turn's tool
     * results are recorded (the conversation it inherits has to be a complete one), so
     * {@code agents.waitForSubagents} can only collect it on a later turn — do not wait on it in
     * the program that made it.
     *
     * @param prompt What the copy is to do instead of what you are doing. It has your whole
     *     conversation already, so write the difference rather than a briefing.
     * @return the copy's handle, to collect on a later turn
     * @throws ToolError {@code LIMIT_EXCEEDED} at the delegation depth cap.
     */
    public SubagentHandle fork(String prompt) {
        return Read.subagentHandle(Wire.call("fork", target(), object(), "fork",
                Wire.args(Wire.text(prompt))));
    }
}
