// What the memory budget looks like, what a keyword search matched, and how to read one of those.

namespace Gg;

public static partial class Memories
{
    /// <summary>How much of the memory budget is used.</summary>
    /// <remarks>
    /// Every maximum is nullable, because each limit is independently disableable and a strategy
    /// applies only some of them: <c>null</c> says that nothing bounds this, rather than leaving a
    /// zero to be read as either a limit or its absence.
    /// </remarks>
    /// <param name="Count">Memories currently held.</param>
    /// <param name="MaxCount">The most memories this run allows, where it limits the count.</param>
    /// <param name="TotalChars">Characters of body currently held, across every memory.</param>
    /// <param name="MaxTotalChars">The most characters of body allowed in total, where it is limited.</param>
    /// <param name="IndexChars">Characters the pinned index occupies, under a strategy that keeps one.</param>
    /// <param name="MaxIndexChars">The most characters the index may occupy, where it is limited.</param>
    public sealed record MemoryUsage(
        uint Count,
        uint? MaxCount,
        uint TotalChars,
        uint? MaxTotalChars,
        uint? IndexChars,
        uint? MaxIndexChars);

    /// <summary>One memory a search matched, and why it ranked where it did.</summary>
    /// <param name="Name">The memory's slug — what <see cref="ReadMemory"/> takes.</param>
    /// <param name="Description">Its description, or empty where it was created without one.</param>
    /// <param name="Matched">How many distinct keywords it matched, which is the primary ranking.</param>
    /// <param name="Occurrences">How many times those keywords occur in it, which is the tiebreak.</param>
    /// <param name="Excerpt">A short window of the memory around its first match.</param>
    public sealed record MemoryHit(
        string Name,
        string Description,
        uint Matched,
        uint Occurrences,
        string Excerpt)
    {
        /// <summary>Read the memory this hit found, in full.</summary>
        /// <remarks>
        /// <see cref="ReadMemory"/> with the name already supplied. The excerpt is a window around
        /// the first match and is there to rank on rather than to read from, so this is the call
        /// that follows a search worth following up.
        /// </remarks>
        /// <returns>the memory's body alone; the description that indexes it is not part of it.</returns>
        /// <exception cref="ApiException">
        /// <see cref="ApiErrorCode.NotFound"/> for a memory deleted since the search ran.
        /// </exception>
        /// <ggop alias="true">memories.read_memory</ggop>
        public string Read() => ReadMemory(Name);
    }
}
