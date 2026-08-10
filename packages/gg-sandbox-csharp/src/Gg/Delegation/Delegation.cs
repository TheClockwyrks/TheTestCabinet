using System.Collections.Generic;

namespace Gg;

/// <summary>Delegate work to child agents, and hand this session on to another agent.</summary>
/// <remarks>
/// A child runs in parallel with its own window and its own model. It sees the brief it was given
/// and nothing of the conversation that produced it, so a brief has to be self-contained — which is
/// also why an issue, whose scope is written down, makes a better one than a sentence.
/// </remarks>
/// <ggmodule>delegation</ggmodule>
public static partial class Delegation
{
    /// <inheritdoc cref="Internal.ModuleDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ModuleDirectory.List(typeof(Delegation));

    /// <summary>Delegate scoped work to a child agent, and get its handle back immediately.</summary>
    /// <remarks>
    /// <para>
    /// The child runs in parallel and nothing here waits for it; <see cref="WaitForSubagents()"/>
    /// collects it later.
    /// </para>
    /// <code>
    /// var child = Delegation.SpawnSubagent("worker", Delegation.Brief.Issue("AUTH-1"));
    /// var results = Delegation.WaitForSubagents(child.Id);
    /// </code>
    /// </remarks>
    /// <param name="agent">
    /// The agent to run the child as, drawn from the spawnable set the system prompt lists. It
    /// selects the child's model, tools and instructions.
    /// </param>
    /// <param name="task">
    /// What the child should do: a written prompt, or a board issue whose scope becomes the brief.
    /// </param>
    /// <returns>the child's handle — its id, the profile it runs as, and the model bound to it.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an agent outside the spawnable set, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the delegation depth cap.
    /// </exception>
    /// <ggop>delegation.spawn_subagent</ggop>
    public static SubagentHandle SpawnSubagent(string agent, Brief task)
    {
        Internal.Wire.Check(Internal.Native.SpawnSubagent(
            agent,
            task.Kind,
            task.Value,
            out var id,
            out var slot,
            out var modelId));
        return new SubagentHandle(id, slot, modelId);
    }

    /// <summary>Wait for every outstanding child, and collect their results.</summary>
    /// <remarks>
    /// This blocks while it waits, and the run's wall-clock budget keeps running while it does.
    /// </remarks>
    /// <returns>one result per child, in the order they were collected.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for an id this agent never spawned, when ids are named.
    /// </exception>
    /// <ggop>delegation.wait_for_subagents</ggop>
    public static IReadOnlyList<SubagentResult> WaitForSubagents() => Collect(null);

    /// <summary>Wait for the named children, and collect their results.</summary>
    /// <remarks>
    /// This blocks while it waits, and the run's wall-clock budget keeps running while it does.
    /// Called with no ids at all, it waits for every outstanding child instead.
    /// </remarks>
    /// <param name="ids">The child ids to wait for, as <see cref="SpawnSubagent"/> handed them back.</param>
    /// <returns>one result per named child.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for an id this agent never spawned.
    /// </exception>
    /// <ggop>delegation.wait_for_subagents</ggop>
    public static IReadOnlyList<SubagentResult> WaitForSubagents(params string[] ids) => Collect(ids);

    /// <summary>Deliver a message to a running child's inbox, which it reads at its next turn.</summary>
    /// <param name="agentId">The child to write to.</param>
    /// <param name="message">What to tell it.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for an unknown child, and
    /// <see cref="ToolErrorCode.Conflict"/> for one that has already returned.
    /// </exception>
    /// <ggop>delegation.send_message</ggop>
    public static void SendMessage(string agentId, string message) =>
        Internal.Wire.Check(Internal.Native.SendMessage(agentId, message));

    /// <summary>Move the process this agent runs inside on to another of its states.</summary>
    /// <remarks>
    /// <para>
    /// It is registered rather than performed: the call validates the target against the reachable
    /// states, returns, and the program carries on to its end; the transition happens after that.
    /// Replacing the agent, and its window, while its own program is still running would pull every
    /// remaining call out from under it.
    /// </para>
    /// <para>
    /// The first declaration stands and a second is refused, because a silently replaced successor
    /// is a change nobody can see. It is bound only where a state machine is driving the agent and
    /// the current state has somewhere to go.
    /// </para>
    /// </remarks>
    /// <param name="state">The state to move to, named the way an agent to spawn is named.</param>
    /// <param name="note">The opening message the next state's agent sees.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> names an unreachable state,
    /// <see cref="ToolErrorCode.Refused"/> means a succession was already declared this turn, and
    /// <see cref="ToolErrorCode.Unavailable"/> means no machine is driving this agent.
    /// </exception>
    /// <ggop>delegation.transition_state</ggop>
    public static void TransitionState(string state, string? note = null) =>
        Internal.Wire.Check(Internal.Native.TransitionState(state, note));

    /// <summary>Continue this session as a different agent.</summary>
    /// <remarks>
    /// <para>
    /// The successor takes over from the next turn with its own model, tools and instructions,
    /// keeping every capability the two share — the whole conversation above all. Registered exactly
    /// as <see cref="TransitionState"/> is, and for the same reason.
    /// </para>
    /// <para>
    /// The first declaration of a succession stands, so an <c>Exec</c> after a
    /// <see cref="TransitionState"/>, or a second <c>Exec</c>, is refused.
    /// </para>
    /// </remarks>
    /// <param name="agent">The agent to become, drawn from the set this agent may become.</param>
    /// <param name="prompt">The opening message it sees.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> names an agent outside that set,
    /// <see cref="ToolErrorCode.Refused"/> means a succession was already declared this turn, and
    /// <see cref="ToolErrorCode.Unavailable"/> means this agent is running inside a machine, which
    /// leaves by <see cref="TransitionState"/> instead.
    /// </exception>
    /// <ggop>delegation.exec</ggop>
    public static void Exec(string agent, string? prompt = null) =>
        Internal.Wire.Check(Internal.Native.Exec(agent, prompt));

    /// <summary>Run a copy of this agent, in parallel, on something it will not do itself.</summary>
    /// <remarks>
    /// <para>
    /// The copy has this agent's model, its tools and a private copy of its whole conversation, so
    /// the prompt is the difference rather than a briefing.
    /// </para>
    /// <para>
    /// Its handle comes back immediately, and the copy itself starts once this turn's results are
    /// recorded — the conversation it inherits has to be a complete one — so
    /// <see cref="WaitForSubagents()"/> can only collect it on a later turn.
    /// </para>
    /// </remarks>
    /// <param name="prompt">What this copy is to do differently.</param>
    /// <returns>the copy's handle.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for a blank prompt,
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the delegation depth cap, and
    /// <see cref="ToolErrorCode.Unavailable"/> with no delegation runtime to collect the copy with.
    /// </exception>
    /// <ggop>delegation.fork</ggop>
    public static SubagentHandle Fork(string prompt)
    {
        Internal.Wire.Check(Internal.Native.Fork(prompt, out var id, out var slot, out var modelId));
        return new SubagentHandle(id, slot, modelId);
    }

    // Both shapes of the wait: `null` is the wire's "every outstanding child".
    private static IReadOnlyList<SubagentResult> Collect(string[]? ids)
    {
        Internal.Wire.Check(Internal.Native.WaitForSubagents(
            ids,
            out var resultIds,
            out var statuses,
            out var summaries));
        var results = new SubagentResult[resultIds.Length];
        for (var index = 0; index < resultIds.Length; index++)
        {
            var status = statuses[index] < 0 ? (AgentStatus?)null : (AgentStatus)statuses[index];
            results[index] = new SubagentResult(resultIds[index], status, summaries[index]);
        }
        return results;
    }
}
