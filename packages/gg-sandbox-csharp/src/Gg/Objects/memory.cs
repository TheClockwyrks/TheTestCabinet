using System.Collections.Generic;

namespace Gg;

/// <summary>
/// durable memories that survive context compaction
/// </summary>
/// <remarks>
/// <para>
/// This run picks one of three memory strategies, and only that strategy's calls are bound: the
/// scratchpad's <see cref="WriteMemory"/> and <see cref="UpdateMemory"/>, or the file-shaped
/// <see cref="CreateMemory"/>, <see cref="ReadMemory"/> and <see cref="EditMemory"/> — plus
/// <see cref="SearchMemories"/> where there is no pinned index. <see cref="DeleteMemory"/> is bound
/// under all three. Your system prompt says which you have, and <see cref="List"/> is the directory
/// of what you really got.
/// </para>
/// <para>
/// A memory may carry <c>code</c>, which is a module in this language bound at
/// <c>lib.&lt;name&gt;</c> in every later program of yours — a helper you write once and never write
/// again. It costs you no context window and is never shown back to you.
/// </para>
/// </remarks>
public static class memory
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("memory");

    /// <summary>Record a new durable memory.</summary>
    /// <remarks>
    /// A duplicate name, or a body that would breach a limit, is a failure — revise or evict rather
    /// than accruing more.
    /// </remarks>
    /// <param name="name">The unique short name this memory is addressed by.</param>
    /// <param name="description">A one line description of what it holds.</param>
    /// <param name="body">The memory itself.</param>
    /// <param name="code">
    /// Reusable C# bound at <c>lib.&lt;name&gt;</c> in every later program of yours. It is not
    /// context: it costs you no window, is never shown back to you, and counts against no body limit.
    /// </param>
    /// <param name="onUse">
    /// A program to run once, the moment this memory first comes into use. It runs after the program
    /// that loaded the memory has ended, so whatever views it opens reach you on your next turn.
    /// </param>
    /// <returns>how full your memory budget now is.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Conflict"/> for a name you already hold, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> for a body that would breach a cap.
    /// </exception>
    public static MemoryUsage WriteMemory(
        string name,
        string description,
        string body,
        string? code = null,
        string? onUse = null) => Record(0, name, description, body, code, onUse);

    /// <summary>Replace an existing memory's description and body.</summary>
    /// <remarks>
    /// The whole memory is replaced, so hand back everything it should still say.
    /// <see cref="EditMemory"/> is the call that changes part of one.
    /// </remarks>
    /// <param name="name">The memory to replace, by the name you gave it.</param>
    /// <param name="description">Its new one line description.</param>
    /// <param name="body">Its new body, in full.</param>
    /// <param name="code">Reusable C# bound at <c>lib.&lt;name&gt;</c>, replacing whatever it carried before.</param>
    /// <param name="onUse">A program to run once, when this memory next comes into use.</param>
    /// <returns>how full your memory budget now is.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for a memory you do not hold.</exception>
    public static MemoryUsage UpdateMemory(
        string name,
        string description,
        string body,
        string? code = null,
        string? onUse = null) => Record(1, name, description, body, code, onUse);

    /// <summary>Record a new memory file, whose contents stay out of your context window until read.</summary>
    /// <remarks>
    /// The file-shaped strategies' way of writing one: what is pinned is the index line, and the body
    /// costs you nothing until <see cref="ReadMemory"/> fetches it.
    /// </remarks>
    /// <param name="name">The unique short name this memory is addressed by.</param>
    /// <param name="description">A one line description — this is the part that stays in your window.</param>
    /// <param name="body">The memory itself, which does not.</param>
    /// <param name="code">Reusable C# bound at <c>lib.&lt;name&gt;</c> in every later program of yours.</param>
    /// <param name="onUse">A program to run once, on the read that first loads this memory.</param>
    /// <returns>how full your memory budget now is.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.Conflict"/> for a name you already hold.</exception>
    public static MemoryUsage CreateMemory(
        string name,
        string description,
        string body,
        string? code = null,
        string? onUse = null) => Record(2, name, description, body, code, onUse);

    /// <summary>Read one memory's contents back, by name.</summary>
    /// <param name="name">The memory's slug, as your index lists it.</param>
    /// <returns>the memory's body.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for a memory you do not hold.</exception>
    public static string ReadMemory(string name)
    {
        Internal.Wire.Check(Internal.Native.ReadMemory(name, out var body));
        return body;
    }

    /// <summary>Revise a memory in place, replacing the one exact occurrence of some text.</summary>
    /// <param name="name">The memory to revise.</param>
    /// <param name="search">The exact text to replace. It must occur exactly once.</param>
    /// <param name="replace">What to put in its place; empty cuts the text out.</param>
    /// <returns>how full your memory budget now is.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> when the text is not there,
    /// <see cref="ToolErrorCode.Conflict"/> when it is there more than once, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an edit that would leave the memory empty.
    /// </exception>
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
    /// <exception cref="ToolException"><see cref="ToolErrorCode.InvalidArgument"/> for an empty keyword list.</exception>
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
    /// <returns>how full your memory budget now is.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for a memory you do not hold.</exception>
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
