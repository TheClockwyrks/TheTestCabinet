using System.Collections.Generic;

namespace Gg;

/// <summary>Durable memories, which survive a context compaction.</summary>
/// <remarks>
/// <para>
/// A run picks one of three memory strategies and binds only that strategy's calls: the scratchpad's
/// <see cref="WriteMemory"/> and <see cref="UpdateMemory"/>, or the file-shaped
/// <see cref="CreateMemory"/>, <see cref="ReadMemory"/> and <see cref="EditMemory"/> — plus
/// <see cref="SearchMemories"/> where there is no pinned index. <see cref="DeleteMemory"/> is bound
/// under all three, and the system prompt says which strategy is in force.
/// </para>
/// <para>
/// A memory may carry <c>code</c>, which is a module in this language bound at
/// <c>lib.&lt;name&gt;</c> in every later program — a helper written once. It costs no context
/// window and is never shown back.
/// </para>
/// </remarks>
/// <ggmodule>memories</ggmodule>
public static partial class Memories
{
    /// <summary>Record a new durable memory.</summary>
    /// <remarks>
    /// A duplicate name, or a body that would breach a limit, is a failure — the answer is to revise
    /// or evict rather than to accrue more.
    /// </remarks>
    /// <param name="name">The unique short name this memory is addressed by.</param>
    /// <param name="description">A one-line description of what it holds.</param>
    /// <param name="body">The memory itself.</param>
    /// <param name="code">
    /// Reusable C# bound at <c>lib.&lt;name&gt;</c> in every later program. It is not context: it
    /// costs no window, is never shown back, and counts against no body limit.
    /// </param>
    /// <param name="onUse">
    /// A program to run once, the moment this memory first comes into use. It runs after the program
    /// that loaded the memory has ended, so its views arrive on the next turn.
    /// </param>
    /// <returns>how full the memory budget now is.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Conflict"/> for a name already held, and
    /// <see cref="ApiErrorCode.LimitExceeded"/> for a body that would breach a cap.
    /// </exception>
    /// <ggop>memories.write_memory</ggop>
    public static MemoryUsage WriteMemory(
        string name,
        string description,
        string body,
        string? code = null,
        string? onUse = null) => Record(0, name, description, body, code, onUse);

    /// <summary>Replace an existing memory's description and body.</summary>
    /// <remarks>
    /// The whole memory is replaced, so everything it should still say has to be passed again.
    /// <see cref="EditMemory"/> is the call that changes part of one.
    /// </remarks>
    /// <param name="name">The memory to replace, by the name it was given.</param>
    /// <param name="description">Its new one-line description.</param>
    /// <param name="body">Its new body, in full.</param>
    /// <param name="code">Reusable C# bound at <c>lib.&lt;name&gt;</c>, replacing what it carried.</param>
    /// <param name="onUse">A program to run once, when this memory next comes into use.</param>
    /// <returns>how full the memory budget now is.</returns>
    /// <exception cref="ApiException"><see cref="ApiErrorCode.NotFound"/> for a memory not held.</exception>
    /// <ggop>memories.update_memory</ggop>
    public static MemoryUsage UpdateMemory(
        string name,
        string description,
        string body,
        string? code = null,
        string? onUse = null) => Record(1, name, description, body, code, onUse);

    /// <summary>Record a new memory file, whose contents stay out of the window until read.</summary>
    /// <remarks>
    /// The file-shaped strategies' way of writing one: what is pinned is the index line, and the
    /// body costs nothing until <see cref="ReadMemory"/> fetches it.
    /// </remarks>
    /// <param name="name">The unique short name this memory is addressed by.</param>
    /// <param name="description">A one-line description, which is the part that stays pinned.</param>
    /// <param name="body">The memory itself, which does not.</param>
    /// <param name="code">Reusable C# bound at <c>lib.&lt;name&gt;</c> in every later program.</param>
    /// <param name="onUse">A program to run once, on the read that first loads this memory.</param>
    /// <returns>how full the memory budget now is.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a blank field or a name carrying characters a
    /// slug may not hold, <see cref="ApiErrorCode.Conflict"/> for a name already held, and
    /// <see cref="ApiErrorCode.LimitExceeded"/> for contents, or an index entry, over a cap.
    /// </exception>
    /// <ggop>memories.create_memory</ggop>
    public static MemoryUsage CreateMemory(
        string name,
        string description,
        string body,
        string? code = null,
        string? onUse = null) => Record(2, name, description, body, code, onUse);

    /// <summary>Read one memory's contents back, by name.</summary>
    /// <param name="name">The memory's slug, as the index lists it.</param>
    /// <returns>the memory's body alone; the description that indexes it is not part of it.</returns>
    /// <exception cref="ApiException"><see cref="ApiErrorCode.NotFound"/> for a memory not held.</exception>
    /// <ggop>memories.read_memory</ggop>
    public static string ReadMemory(string name)
    {
        Internal.Wire.Check(Internal.Native.ReadMemory(name, out var body));
        return body;
    }

    /// <summary>Revise a memory in place, replacing the one exact occurrence of some text.</summary>
    /// <param name="name">The memory to revise.</param>
    /// <param name="search">The exact text to replace. It must occur exactly once.</param>
    /// <param name="replace">What to put in its place; empty cuts the text out.</param>
    /// <returns>how full the memory budget now is.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> when the text is not there,
    /// <see cref="ApiErrorCode.Conflict"/> when it is there more than once,
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an edit that would leave the memory empty, and
    /// <see cref="ApiErrorCode.LimitExceeded"/> when the result would be over a cap.
    /// </exception>
    /// <ggop>memories.edit_memory</ggop>
    public static MemoryUsage EditMemory(string name, string search, string replace)
    {
        Internal.Wire.Check(Internal.Native.EditMemory(
            name,
            search,
            replace,
            out var count,
            out var maxCount,
            out var totalChars,
            out var maxTotalChars,
            out var indexChars,
            out var maxIndexChars));
        return Usage(count, maxCount, totalChars, maxTotalChars, indexChars, maxIndexChars);
    }

    /// <summary>Find the memories mentioning any of these keywords, best first.</summary>
    /// <remarks>
    /// Ranked by how many distinct keywords each memory matched, then by how often they occur in it.
    /// A search that matches nothing is an empty list rather than a failure.
    /// </remarks>
    /// <param name="keywords">
    /// The words to look for. At least one — an empty search is a failure rather than every memory.
    /// </param>
    /// <returns>the memories that matched, best first, each with an excerpt around its first match.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty keyword list.
    /// </exception>
    /// <ggop>memories.search_memories</ggop>
    public static IReadOnlyList<MemoryHit> SearchMemories(params string[] keywords)
    {
        Internal.Wire.Check(Internal.Native.SearchMemories(
            keywords,
            out var names,
            out var descriptions,
            out var matched,
            out var occurrences,
            out var excerpts));
        var hits = new MemoryHit[names.Length];
        for (var index = 0; index < names.Length; index++)
        {
            hits[index] = new MemoryHit(
                names[index],
                descriptions[index],
                matched[index],
                occurrences[index],
                excerpts[index]);
        }
        return hits;
    }

    /// <summary>Evict a memory by name, freeing room for new ones.</summary>
    /// <param name="name">The memory to drop.</param>
    /// <returns>how full the memory budget now is.</returns>
    /// <exception cref="ApiException"><see cref="ApiErrorCode.NotFound"/> for a memory not held.</exception>
    /// <ggop>memories.delete_memory</ggop>
    public static MemoryUsage DeleteMemory(string name)
    {
        Internal.Wire.Check(Internal.Native.DeleteMemory(
            name,
            out var count,
            out var maxCount,
            out var totalChars,
            out var maxTotalChars,
            out var indexChars,
            out var maxIndexChars));
        return Usage(count, maxCount, totalChars, maxTotalChars, indexChars, maxIndexChars);
    }

    // The three recording calls take one record and differ in nothing else.
    private static MemoryUsage Record(
        int strategy,
        string name,
        string description,
        string body,
        string? code,
        string? onUse)
    {
        Internal.Wire.Check(Internal.Native.RecordMemory(
            strategy,
            name,
            description,
            body,
            code,
            onUse,
            out var count,
            out var maxCount,
            out var totalChars,
            out var maxTotalChars,
            out var indexChars,
            out var maxIndexChars));
        return Usage(count, maxCount, totalChars, maxTotalChars, indexChars, maxIndexChars);
    }

    private static MemoryUsage Usage(
        uint count,
        long maxCount,
        uint totalChars,
        long maxTotalChars,
        long indexChars,
        long maxIndexChars) =>
        new(
            count,
            Internal.Wire.Count(maxCount),
            totalChars,
            Internal.Wire.Count(maxTotalChars),
            Internal.Wire.Count(indexChars),
            Internal.Wire.Count(maxIndexChars));
}
