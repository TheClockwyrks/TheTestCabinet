using System.Collections.Generic;

namespace Gg;

/// <summary>
/// delegate work to child agents
/// </summary>
/// <remarks>
/// A child runs in parallel with its own window and its own model. It sees the brief you give it and
/// nothing of your conversation, so a brief has to be self-contained — which is also why an issue,
/// whose scope is written down, makes a better one than a sentence.
/// </remarks>
public static class agents
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("agents");

    /// <summary>Delegate scoped work to a child agent, and get its handle back immediately.</summary>
    /// <remarks>
    /// <para>
    /// The child runs in parallel; nothing here waits for it. Collect it later with
    /// <see cref="WaitForSubagents()"/>.
    /// </para>
    /// <code>
    /// var child = agents.SpawnSubagent("worker", Brief.Issue("AUTH-1"));
    /// var results = agents.WaitForSubagents(child.Id);
    /// </code>
    /// </remarks>
    /// <param name="agent">
    /// The agent to run the child as — one of the agents you may spawn, which your system prompt
    /// lists. It selects the child's model, tools and instructions.
    /// </param>
    /// <param name="task">
    /// What the child should do: <c>Brief.Prompt(...)</c> for instructions you write here, or
    /// <c>Brief.Issue(...)</c> for a board issue whose scope becomes the brief.
    /// </param>
    /// <returns>the child's handle — its id, the profile it runs as, and the model bound to it.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an agent you may not spawn, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the delegation depth cap.
    /// </exception>
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
    public static IReadOnlyList<SubagentResult> WaitForSubagents() => Collect(null);

    /// <summary>Wait for the named children, and collect their results.</summary>
    /// <remarks>
    /// This blocks while it waits, and the run's wall-clock budget keeps running while it does. Call
    /// it with no ids at all to wait for every outstanding child instead.
    /// </remarks>
    /// <param name="ids">The child ids to wait for, as <see cref="SpawnSubagent"/> handed them back.</param>
    /// <returns>one result per named child.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for an id you never spawned.</exception>
    public static IReadOnlyList<SubagentResult> WaitForSubagents(params string[] ids) => Collect(ids);

    /// <summary>Deliver a message to a running child's inbox; it receives it at its next turn.</summary>
    /// <param name="agentId">The child to write to.</param>
    /// <param name="message">What to tell it.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for an unknown child, and
    /// <see cref="ToolErrorCode.Conflict"/> for one that has already returned.
    /// </exception>
    public static void SendMessage(string agentId, string message) =>
        Internal.Wire.Check(Internal.Native.SendMessage(agentId, message));

    /// <summary>Move the process you are running inside on to another of its states.</summary>
    /// <remarks>
    /// <para>
    /// It is <b>registered, not performed</b>: the call validates the target against the states you
    /// may move to, returns, and your program carries on to its end; the transition happens after
    /// that. Replacing the agent — and its window — while its own program is still running would pull
    /// every remaining call out from under it.
    /// </para>
    /// <para>
    /// The first declaration stands and a second is refused: a silently replaced successor is a change
    /// you cannot see. Bound only when a state machine is driving you and the state you are in has
    /// somewhere to go.
    /// </para>
    /// </remarks>
    /// <param name="state">The state to move to, named the way you name an agent to spawn.</param>
    /// <param name="note">The opening message the next state's agent sees.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> names a state you may not move to,
    /// <see cref="ToolErrorCode.Refused"/> means you already declared a succession this turn, and
    /// <see cref="ToolErrorCode.Unavailable"/> means no machine is driving you.
    /// </exception>
    public static void TransitionState(string state, string? note = null) =>
        Internal.Wire.Check(Internal.Native.TransitionState(state, note));

    /// <summary>Continue this session as a different agent.</summary>
    /// <remarks>
    /// <para>
    /// It takes over from your next turn with its own model, tools and instructions, keeping every
    /// capability the two of you both have — your whole conversation above all. Registered exactly as
    /// <see cref="TransitionState"/> is, and for the same reason.
    /// </para>
    /// <para>
    /// The first declaration of a succession stands, so an <c>Exec</c> after a
    /// <see cref="TransitionState"/>, or a second <c>Exec</c>, is refused.
    /// </para>
    /// </remarks>
    /// <param name="agent">The agent to become. It must be one you may become.</param>
    /// <param name="prompt">The opening message it sees.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> names an agent you may not become, and
    /// <see cref="ToolErrorCode.Refused"/> means you already declared a succession this turn.
    /// </exception>
    public static void Exec(string agent, string? prompt = null) =>
        Internal.Wire.Check(Internal.Native.Exec(agent, prompt));

    /// <summary>Run a copy of yourself, in parallel, on something you will not do yourself.</summary>
    /// <remarks>
    /// <para>
    /// The copy has your model, your tools and a private copy of your whole conversation, so the
    /// prompt is the <i>difference</i> rather than a briefing.
    /// </para>
    /// <para>
    /// Its handle comes back immediately, but the copy itself starts once this turn's results are
    /// recorded — the conversation it inherits has to be a complete one — so
    /// <see cref="WaitForSubagents()"/> can only collect it on a later turn.
    /// </para>
    /// </remarks>
    /// <param name="prompt">What this copy is to do differently from you.</param>
    /// <returns>the copy's handle.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.LimitExceeded"/> at the delegation depth cap, and
    /// <see cref="ToolErrorCode.Unavailable"/> with no delegation runtime to collect the copy with.
    /// </exception>
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
