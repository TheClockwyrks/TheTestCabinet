// What a reclaim freed and what the archive holds, nested in the module that reclaims and searches.

using System.Collections.Generic;

namespace Gg;

public static partial class Context
{
    /// <summary>What a reclaim actually freed from the live context window.</summary>
    /// <param name="Items">Context items dropped from the live window.</param>
    /// <param name="ReclaimedTokens">Approximately how many tokens that freed.</param>
    /// <param name="Paths">The workspace paths whose views were evicted. Empty for an archive.</param>
    /// <param name="Detail">The same prose the tool-calling path would have shown.</param>
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

        /// <summary>Something the agent was told — a prompt, a tool result, a view.</summary>
        User,

        /// <summary>Something the agent said.</summary>
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
    /// <remarks>
    /// An empty archive and a search that matched nothing are separate facts, deliberately:
    /// collapsing the two would make a program archive again in the belief its first archive failed.
    /// </remarks>
    /// <param name="ArchiveEmpty">Nothing has been archived yet, so there was nothing to search.</param>
    /// <param name="Hits">The matches, most recent first, capped at gg's eight-hit ceiling.</param>
    public sealed record ArchiveSearch(bool ArchiveEmpty, IReadOnlyList<ArchiveHit> Hits);

    /// <summary>An inclusive span of turn numbers, as read off the header on each result.</summary>
    /// <param name="From">The first turn in the span.</param>
    /// <param name="To">The last turn in the span, inclusive. Equal ends archive one turn.</param>
    public sealed record TurnRange(uint From, uint To);
}
