package gg.delegation;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;
import java.util.Optional;

/**
 * Delegate work to child agents, and hand this session on to another agent.
 *
 * <p>A child runs in parallel with its own window and its own model. It sees the brief it was given
 * and nothing of the conversation that produced it, so a brief has to be self-contained — which is
 * also why an issue, whose scope is written down, briefs a child better than a sentence does.
 *
 * <p>Waiting can dominate a turn's wall clock, because it blocks while real agents run and the run's
 * budget keeps ticking. Spawning broadly and waiting once beats spawning and waiting in a loop.
 *
 * @ggmodule delegation
 */
public final class Delegation {
    private Delegation() {
    }

    /**
     * Delegate scoped work to a child agent, and hand back its handle immediately.
     *
     * <p>The child runs in parallel while this program continues. The agent named selects the child's
     * model, tools and instructions, and must be one this agent may spawn; the brief is either
     * self-contained instructions or the id of a board issue. The child shares the workspace.
     *
     * @param agent The agent profile to run the child as, from the ones this agent may spawn.
     * @param brief What the child is to do: {@code Delegation.Brief.prompt} with self-contained
     *     instructions, or {@code Delegation.Brief.issue} with a board issue's id.
     * @return the child's handle, to wait on or to message
     * @throws ToolError {@link ToolErrorCode#LIMIT_EXCEEDED} at the delegation depth cap, and
     *     {@link ToolErrorCode#INVALID_ARGUMENT} when {@code agent} is not one this agent may spawn.
     * @ggop delegation.spawn_subagent
     */
    public static SubagentHandle spawnSubagent(String agent, Brief brief) {
        Value request = Value.record()
                .put("agent", Value.of(agent))
                .put("task", Value.variant(brief.field(), Value.of(brief.value())));
        return Read.subagentHandle(Coding.call("delegation.spawn_subagent", request));
    }

    /**
     * Block until the named children have finished, and collect their results in dispatch order.
     *
     * <p>Naming none waits for every child still outstanding, which is the shape worth reaching for:
     * the run's wall-clock budget keeps running while a program waits, so one wait for many children
     * costs far less than one wait per child.
     *
     * @param ids The children to wait for, as {@link #spawnSubagent} returned them. Naming none waits
     *     for every one still outstanding.
     * @return every collected child's result, in dispatch order
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown id.
     * @ggop delegation.wait_for_subagents
     */
    public static List<SubagentResult> waitForSubagents(String... ids) {
        return Read.subagentResults(
                Coding.call("delegation.wait_for_subagents", Value.texts(ids)));
    }

    /**
     * Deliver a message to a running child agent's inbox, which it reads at its next turn.
     *
     * @param agentId The child to deliver to, as {@link #spawnSubagent} returned it.
     * @param message What to put in its inbox.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown agent id, and
     *     {@link ToolErrorCode#CONFLICT} when that child has already returned.
     * @ggop delegation.send_message
     */
    public static void sendMessage(String agentId, String message) {
        Coding.call("delegation.send_message", Value.of(agentId), Value.of(message));
    }

    /**
     * Move the process this agent is running inside on to another of its states.
     *
     * <p>Bound only while a state machine is driving the session and the current state has somewhere
     * to go. Like a compaction it is registered rather than performed: the call validates the target
     * and returns, the program runs on to its end, and the transition happens after that — replacing
     * the agent, and its window, mid-program would pull every remaining call out from under it. The
     * first declaration in a turn stands.
     *
     * @param state The state to move on to, named the way an agent to spawn is named.
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for a state this agent may not move
     *     to, and {@link ToolErrorCode#REFUSED} for a second declaration in one turn.
     * @ggop delegation.transition_state
     */
    public static void transitionState(String state) {
        Coding.call("delegation.transition_state", Value.of(state), Value.none());
    }

    /**
     * Move on to another state, telling the agent that takes over something as it starts.
     *
     * @param state The state to move on to, named the way an agent to spawn is named.
     * @param note The opening message the next state's agent sees.
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for a state this agent may not move
     *     to, and {@link ToolErrorCode#REFUSED} for a second declaration in one turn.
     * @ggop delegation.transition_state
     */
    public static void transitionState(String state, String note) {
        Coding.call("delegation.transition_state", Value.of(state), Value.of(note));
    }

    /**
     * Continue this session as a different agent, from the next turn.
     *
     * <p>The named agent takes over with its own model, tools and instructions, keeping every
     * capability the two of them share — the whole conversation above all, so it needs no catching
     * up. Registered rather than performed, exactly as a state transition is and for the same
     * reason. A session makes one succession per turn, and this is bound only where the agent may
     * make transitions, has agents it may become, and is not being driven by a state machine.
     *
     * @param agent The agent to become, from the ones this agent may become.
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for an agent this one may not become,
     *     and {@link ToolErrorCode#REFUSED} for a second succession in one turn.
     * @ggop delegation.exec
     */
    public static void exec(String agent) {
        Coding.call("delegation.exec", Value.of(agent), Value.none());
    }

    /**
     * Continue this session as a different agent, telling it what to do as it takes over.
     *
     * @param agent The agent to become, from the ones this agent may become.
     * @param prompt Its opening message. It already has the whole conversation, so this is the
     *     instruction rather than a briefing.
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for an agent this one may not become,
     *     and {@link ToolErrorCode#REFUSED} for a second succession in one turn.
     * @ggop delegation.exec
     */
    public static void exec(String agent, String prompt) {
        Coding.call("delegation.exec", Value.of(agent), Value.of(prompt));
    }

    /**
     * Run a copy of this agent, in parallel, on something it will not do itself.
     *
     * <p>The copy has the same model, the same tools and a private copy of the whole conversation, so
     * the prompt is the difference rather than a briefing. Its handle comes back immediately, but the
     * copy starts once this turn's results are recorded — the conversation it inherits has to be a
     * complete one — so it can only be collected on a later turn.
     *
     * @param prompt What the copy is to do instead. It has the whole conversation already, so this is
     *     the difference rather than a briefing.
     * @return the copy's handle, to collect on a later turn
     * @throws ToolError {@link ToolErrorCode#LIMIT_EXCEEDED} at the delegation depth cap.
     * @ggop delegation.fork
     */
    public static SubagentHandle fork(String prompt) {
        return Read.subagentHandle(Coding.call("delegation.fork", Value.of(prompt)));
    }

    // -------------------------------------------------------------------------------------------
    // The types delegation takes and hands back
    // -------------------------------------------------------------------------------------------

    /**
     * A child agent that was spawned and is now running in parallel.
     *
     * @param id The child's id, which is what waits on it or messages it.
     * @param slot The agent profile it runs as.
     * @param modelId The model actually bound to that agent.
     */
    public record SubagentHandle(String id, String slot, String modelId) {

        /**
         * Deliver a message to this child, which is {@link Delegation#sendMessage} on its own id.
         *
         * @param message What to put in its inbox. It reads it at its next turn.
         * @throws ToolError {@link ToolErrorCode#CONFLICT} when the child has already returned.
         * @ggalias delegation.send_message
         */
        public void send(String message) {
            Delegation.sendMessage(id, message);
        }
    }

    /**
     * One child agent's collected result.
     *
     * @param id The child's id.
     * @param status How it finished; empty when it produced no return value at all.
     * @param summary Its final message.
     */
    public record SubagentResult(String id, Optional<AgentEnding> status, String summary) {
    }

    /** How a child agent's loop ended, in gg's own six words. */
    public enum AgentEnding {
        /** It finished normally, and its summary is what it returned. */
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
        LIMIT_EXCEEDED
    }

    /**
     * What a child agent is asked to do: written instructions, or a board issue.
     *
     * <p>It is exactly one of the two, and that is the whole reason it is a type rather than two
     * optional arguments: gg can carry out neither "both" nor "neither", and this makes both of them
     * a compile error rather than a refusal at run time.
     *
     * <pre>{@code
     * Delegation.spawnSubagent("reviewer", Delegation.Brief.issue("AUTH-3"));
     * Delegation.spawnSubagent("worker", Delegation.Brief.prompt("port the fixtures"));
     * }</pre>
     */
    public static final class Brief {
        private final String field;
        private final String value;

        private Brief(String field, String value) {
            this.field = field;
            this.value = value;
        }

        /**
         * Brief the child with instructions written here, so it needs no other context.
         *
         * @param instructions Everything the child needs to know, written for a reader with no other
         *     context.
         * @return the brief to hand to a spawn
         */
        public static Brief prompt(String instructions) {
            return new Brief("prompt", instructions);
        }

        /**
         * Brief the child with a board issue, whose scope and criteria it is briefed from.
         *
         * @param issueId The id of the issue to brief the child from.
         * @return the brief to hand to a spawn
         */
        public static Brief issue(String issueId) {
            return new Brief("issue", issueId);
        }

        /** Which field of the request this brief fills. */
        String field() {
            return field;
        }

        /** What it fills it with. */
        String value() {
            return value;
        }
    }
}
