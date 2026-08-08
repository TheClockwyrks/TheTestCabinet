namespace Gg;

/// <summary>
/// What a child agent is asked to do: either a brief you write here, or a board issue whose scope
/// and completion criteria become the brief.
/// </summary>
/// <remarks>
/// <para>
/// It is exactly one of the two, and that is the whole reason it is a type rather than two nullable
/// arguments — "neither" and "both" are not requests gg can carry out, and neither of them compiles.
/// </para>
/// <code>
/// agents.SpawnSubagent("reviewer", Brief.Issue("AUTH-3"));
/// agents.SpawnSubagent("worker", Brief.Prompt("port the fixtures to the new schema"));
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

    /// <summary>Brief the child with instructions you write here.</summary>
    /// <param name="prompt">
    /// The whole of what the child is to do. It sees none of your conversation, so anything it needs
    /// to know has to be in here.
    /// </param>
    /// <returns>a brief carrying those instructions.</returns>
    public static Brief Prompt(string prompt) => new(0, prompt);

    /// <summary>Brief the child with a board issue.</summary>
    /// <param name="issueId">The issue's id (<c>AUTH-1</c>). Its scope and completion criteria become the brief.</param>
    /// <returns>a brief naming that issue.</returns>
    public static Brief Issue(string issueId) => new(1, issueId);
}

/// <summary>A child agent you spawned.</summary>
/// <param name="Id">The child's id — what <c>agents.WaitForSubagents</c> and <c>agents.SendMessage</c> take.</param>
/// <param name="Slot">The agent profile it runs as.</param>
/// <param name="ModelId">The model actually bound to that agent.</param>
public sealed record SubagentHandle(string Id, string Slot, string ModelId);

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

    /// <summary>
    /// An execution ceiling stopped it — consecutive errors, error rate, cost, turns or runtime.
    /// Like <see cref="Exhausted"/>, it means the child was cut off partway rather than that it
    /// failed at the work.
    /// </summary>
    LimitExceeded,
}

/// <summary>One collected child result.</summary>
/// <param name="Id">The child's id.</param>
/// <param name="Status">How it finished; <c>null</c> when it produced no return value at all.</param>
/// <param name="Summary">Its final message — the whole of what it hands back to you.</param>
public sealed record SubagentResult(string Id, AgentStatus? Status, string Summary);
