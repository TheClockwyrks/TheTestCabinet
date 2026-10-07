package gg.delegation;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;
import java.util.Optional;

/**
 * Delegate work to child agents, and hand this session on to another agent.
 *
 * <p>A child runs in parallel with its own window and its own model. It sees the brief it was given
 * and nothing of the conversation that produced it.
 *
 * <p>A wait blocks while children run, and the run's wall-clock budget keeps ticking.
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
     * model, tools and instructions, and must be one this run may spawn; the brief is either
     * self-contained instructions or the id of a board issue. The child shares the workspace.
     *
     * @param agent The agent profile to run the child as, from the ones this run may spawn.
     * @param brief What the child is to do: {@code Delegation.Brief.prompt} with self-contained
     *     instructions, or {@code Delegation.Brief.issue} with a board issue's id.
     * @return the child's handle, to wait on or to message
     * @throws ApiError {@link ApiErrorCode#LIMIT_EXCEEDED} at the delegation depth cap, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} when {@code agent} is not one this run may spawn.
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
     * <p>Naming none waits for every child still outstanding.
     *
     * @param ids The children to wait for, as {@link #spawnSubagent} returned them. Naming none waits
     *     for every one still outstanding.
     * @return every collected child's result, in dispatch order
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown id.
     * @ggop delegation.wait_for_subagents
     */
    public static List<SubagentResult> waitForSubagents(String... ids) {
        // Naming none is the ABSENT list rather than an empty one: gg reads an absent `ids` as
        // "every child still outstanding" and a list as "exactly these", so lowering the empty
        // varargs as a list would ask gg to wait for nothing at all.
        Value named = ids.length == 0 ? Value.none() : Value.texts(ids);
        return Read.subagentResults(Coding.call("delegation.wait_for_subagents", named));
    }

    /**
     * Deliver a message to a running child agent's inbox, which it reads at its next turn.
     *
     * @param agentId The child to deliver to, as {@link #spawnSubagent} returned it.
     * @param message What to put in its inbox.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown agent id, and
     *     {@link ApiErrorCode#CONFLICT} when that child has already returned.
     * @ggop delegation.send_message
     */
    public static void sendMessage(String agentId, String message) {
        Coding.call("delegation.send_message", Value.of(agentId), Value.of(message));
    }

    /**
     * Move the process this session is running inside on to another of its states.
     *
     * <p>Bound only while a state machine is driving the session and the current state has somewhere
     * to go. The call validates the target and returns; the transition happens once the program has
     * ended. The first declaration in a turn stands.
     *
     * @param state The state to move on to, named the way an agent to spawn is named.
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a state this session may not move
     *     to, and {@link ApiErrorCode#REFUSED} for a second declaration in one turn.
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
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a state this session may not move
     *     to, and {@link ApiErrorCode#REFUSED} for a second declaration in one turn.
     * @ggop delegation.transition_state
     */
    public static void transitionState(String state, String note) {
        Coding.call("delegation.transition_state", Value.of(state), Value.of(note));
    }

    /**
     * Continue this session as a different agent, from the next turn.
     *
     * <p>The named agent takes over with its own model, tools and instructions, keeping every
     * capability the two of them share and the whole conversation.
     *
     * <p>The call is registered and takes effect once the program has ended. A session makes one
     * succession per turn. Bound only where this run may make transitions, has agents to become,
     * and is not being driven by a state machine.
     *
     * @param agent The agent to become, from the ones this run may become.
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an agent this run may not become,
     *     and {@link ApiErrorCode#REFUSED} for a second succession in one turn.
     * @ggop delegation.exec
     */
    public static void exec(String agent) {
        Coding.call("delegation.exec", Value.of(agent), Value.none());
    }

    /**
     * Continue this session as a different agent, telling it what to do as it takes over.
     *
     * @param agent The agent to become, from the ones this run may become.
     * @param prompt Its opening message. It already has the whole conversation, so this is the
     *     instruction rather than a briefing.
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an agent this run may not become,
     *     and {@link ApiErrorCode#REFUSED} for a second succession in one turn.
     * @ggop delegation.exec
     */
    public static void exec(String agent, String prompt) {
        Coding.call("delegation.exec", Value.of(agent), Value.of(prompt));
    }

    /**
     * Run a copy of this session, in parallel, on something it will not do itself.
     *
     * <p>The copy has the same model, the same tools and a private copy of the whole conversation.
     * Its handle comes back immediately; the copy starts once this turn's results are recorded, so
     * it can only be collected on a later turn.
     *
     * @param prompt What the copy is to do instead. It has the whole conversation already.
     * @return the copy's handle, to collect on a later turn
     * @throws ApiError {@link ApiErrorCode#LIMIT_EXCEEDED} at the delegation depth cap.
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
         * @throws ApiError {@link ApiErrorCode#CONFLICT} when the child has already returned.
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

    /** How a child agent's loop ended. */
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
     * <p>Exactly one of the two.
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
