using System.Collections.Generic;

namespace Gg;

/// <summary>How much of the memory budget is used.</summary>
/// <remarks>
/// Every maximum is nullable, because each limit is independently disableable and a strategy applies
/// only some of them: <c>null</c> says "nothing bounds this" rather than leaving a zero to be read as
/// either a limit or its absence.
/// </remarks>
/// <param name="Count">Memories currently held.</param>
/// <param name="MaxCount">The most memories this run allows, if it limits the count.</param>
/// <param name="TotalChars">Characters of body currently held, across every memory.</param>
/// <param name="MaxTotalChars">The most characters of body this run allows in total, if it limits the aggregate.</param>
/// <param name="IndexChars">Characters the pinned index occupies, under a strategy that keeps one.</param>
/// <param name="MaxIndexChars">The most characters the index may occupy, if it is limited.</param>
public sealed record MemoryUsage(
    uint Count,
    uint? MaxCount,
    uint TotalChars,
    uint? MaxTotalChars,
    uint? IndexChars,
    uint? MaxIndexChars);

/// <summary>One memory a search matched, and why it ranked where it did.</summary>
/// <param name="Name">The memory's slug — what <c>memory.ReadMemory</c> takes.</param>
/// <param name="Description">Its description, or empty when it was created without one.</param>
/// <param name="Matched">How many distinct keywords it matched — the primary ranking.</param>
/// <param name="Occurrences">How many times those keywords occur in it — the tiebreak.</param>
/// <param name="Excerpt">A short window of the memory around its first match.</param>
public sealed record MemoryHit(
    string Name,
    string Description,
    uint Matched,
    uint Occurrences,
    string Excerpt);

/// <summary>What a reclaim actually freed from your live context window.</summary>
/// <param name="Items">Context items dropped from the live window.</param>
/// <param name="ReclaimedTokens">Approximately how many tokens that freed.</param>
/// <param name="Paths">The workspace paths whose views were evicted. Empty for an archive.</param>
/// <param name="Detail">The same prose the tool-calling path would have shown you.</param>
public sealed record ReclaimReport(
    uint Items,
    uint ReclaimedTokens,
    IReadOnlyList<string> Paths,
    string Detail);

/// <summary>Who said an archived message.</summary>
public enum MessageRole
{
    /// <summary>The system prompt.</summary>
    System,

    /// <summary>You were told this — a prompt, a tool result, a view.</summary>
    User,

    /// <summary>You said it.</summary>
    Assistant,

    /// <summary>A tool result.</summary>
    Tool,
}

/// <summary>One archived message that matched a search.</summary>
/// <param name="Seq">The archived message's sequence number.</param>
/// <param name="Role">Who said it.</param>
/// <param name="Text">The message text.</param>
public sealed record ArchiveHit(uint Seq, MessageRole Role, string Text);

/// <summary>What a search of the archive found.</summary>
/// <param name="ArchiveEmpty">
/// Nothing has been archived yet, so there was nothing to search. Distinct from a search that ran
/// and matched nothing — collapsing the two would make a program archive again in the belief its
/// first archive failed.
/// </param>
/// <param name="Hits">The matches, most recent first, capped at gg's eight-hit ceiling.</param>
public sealed record ArchiveSearch(bool ArchiveEmpty, IReadOnlyList<ArchiveHit> Hits);

/// <summary>An inclusive span of turn numbers, as read off the header on each of your results.</summary>
/// <param name="From">The first turn in the span.</param>
/// <param name="To">The last turn in the span, inclusive. The same number as <paramref name="From"/> archives one turn.</param>
public sealed record TurnRange(uint From, uint To);

/// <summary>Which of the three kinds a view is.</summary>
public enum ViewKind
{
    /// <summary>A file view, keyed by its workspace path and, for a paged read, its region.</summary>
    File,

    /// <summary>A text view, keyed by the label you gave it.</summary>
    Text,

    /// <summary>A documentation view, keyed by the name of the function it documents.</summary>
    Docs,
}

/// <summary>The line window a paged file view covers.</summary>
/// <param name="Offset">The 1-based first line the view shows.</param>
/// <param name="Limit">How many lines it shows.</param>
public sealed record ViewRegion(uint Offset, uint Limit);

/// <summary>One view currently open in your context window.</summary>
/// <param name="Kind">Which of the three kinds it is.</param>
/// <param name="Selector">What <c>view.Close</c> takes: a file view's workspace path, or a text view's label.</param>
/// <param name="Tokens">Roughly what holding it costs, in tokens.</param>
/// <param name="Region">The window a paged file view covers; <c>null</c> for a whole-file view and for every text view.</param>
public sealed record OpenView(ViewKind Kind, string Selector, ulong Tokens, ViewRegion? Region);

/// <summary>One function in an API object's directory.</summary>
/// <param name="Name">The name you call it by — <c>ReadFile</c> in <c>fs.ReadFile(...)</c>.</param>
/// <param name="Summary">A one-line description of what it does.</param>
public sealed record FunctionSummary(string Name, string Summary);

/// <summary>One program you already ran, as your history lists it.</summary>
/// <remarks>
/// It carries the shape of the program rather than its source: a directory that inlined sixty lines
/// per entry would put the whole session back into the one place that exists to avoid re-reading it.
/// </remarks>
/// <param name="Turn">The turn it ran on — what <c>programs.Get</c> takes.</param>
/// <param name="Lines">How many lines of source it was.</param>
/// <param name="Chars">How many characters of source it was.</param>
/// <param name="Ok">
/// Whether it ran to its end: no uncaught exception, and no sandbox ceiling stopping it. A program
/// that failed is kept and can still be fetched.
/// </param>
/// <param name="Error">The error it ended with, when it did not run to its end.</param>
public sealed record ProgramSummary(uint Turn, uint Lines, uint Chars, bool Ok, string? Error);
