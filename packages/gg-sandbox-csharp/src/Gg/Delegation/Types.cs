// What a child agent is asked to do, and what comes back from one.
//
// `SubagentHandle.Send` is the one MEMBER function this arm binds: a second, idiomatic way to reach
// `delegation.send_message`, spelled on the value that already carries the id the free function
// would otherwise be passed. It is catalogued as an alias, so it counts toward no coverage.

namespace Gg;

public static partial class Delegation
{
    /// <summary>What a child agent is asked to do: a written brief, or a board issue.</summary>
    /// <remarks>
    /// <para>
    /// It is exactly one of the two, and that is the whole reason it is a type rather than two
    /// nullable arguments: gg can carry out neither "both" nor "neither", and this type makes both
    /// of those a compile error rather than a refusal at run time.
    /// </para>
    /// <code>
    /// Delegation.SpawnSubagent("reviewer", Delegation.Brief.Issue("AUTH-3"));
    /// Delegation.SpawnSubagent("worker", Delegation.Brief.Prompt("port the fixtures"));
    /// </code>
    /// </remarks>
    public readonly struct Brief
    {
        /// <summary>Which of the two this is: 0 a written prompt, 1 a board issue.</summary>
        internal readonly int Kind;

        /// <summary>The prompt, or the issue id.</summary>
        internal readonly string Value;

        private Brief(int kind, string value)
        {
            Kind = kind;
            Value = value;
        }

        /// <summary>Brief the child with instructions written here.</summary>
        /// <param name="prompt">
        /// The whole of what the child is to do. It sees none of the spawning conversation, so
        /// anything it needs has to be in here.
        /// </param>
        /// <returns>a brief carrying those instructions.</returns>
        public static Brief Prompt(string prompt) => new(0, prompt);

        /// <summary>Brief the child with a board issue.</summary>
        /// <param name="issueId">
        /// The issue's id. Its scope and completion criteria become the brief.
        /// </param>
        /// <returns>a brief naming that issue.</returns>
        public static Brief Issue(string issueId) => new(1, issueId);
    }

    /// <summary>A child agent that was spawned.</summary>
    /// <param name="Id">The child's id — what <see cref="WaitForSubagents(string[])"/> takes.</param>
    /// <param name="Slot">The agent profile it runs as.</param>
    /// <param name="ModelId">The model actually bound to that agent.</param>
    public sealed record SubagentHandle(string Id, string Slot, string ModelId)
    {
        /// <summary>Deliver a message to this child's inbox, which it reads at its next turn.</summary>
        /// <remarks>
        /// <see cref="SendMessage"/> with the id already supplied, for the common case where the
        /// handle is in hand.
        /// </remarks>
        /// <param name="message">What to tell it.</param>
        /// <exception cref="ToolException">
        /// <see cref="ToolErrorCode.Conflict"/> for a child that has already returned.
        /// </exception>
        /// <ggop alias="true">delegation.send_message</ggop>
        public void Send(string message) => SendMessage(Id, message);
    }

    /// <summary>How a child agent finished.</summary>
    public enum AgentStatus
    {
        /// <summary>It ended its own session, so its summary is its answer.</summary>
        Completed,

        /// <summary>It ran out of turns before it ended.</summary>
        Exhausted,

        /// <summary>Its wall-clock budget ran out.</summary>
        TimedOut,

        /// <summary>Its model failed.</summary>
        ModelError,

        /// <summary>Its provider refused the credentials.</summary>
        AuthError,

        /// <summary>An execution ceiling stopped it — errors, cost, turns or runtime.</summary>
        /// <remarks>
        /// Like <see cref="Exhausted"/>, it means the child was cut off partway rather than that it
        /// failed at the work.
        /// </remarks>
        LimitExceeded,
    }

    /// <summary>One collected child result.</summary>
    /// <param name="Id">The child's id.</param>
    /// <param name="Status">How it finished; <c>null</c> where it produced no return value at all.</param>
    /// <param name="Summary">Its final message — the whole of what it hands back.</param>
    public sealed record SubagentResult(string Id, AgentStatus? Status, string Summary);
}
