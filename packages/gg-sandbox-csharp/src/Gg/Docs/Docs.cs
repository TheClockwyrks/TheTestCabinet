namespace Gg;

/// <summary>Search this surface's own documentation, and take a documentation view back out.</summary>
/// <remarks>
/// A search returns only the calls this run offers. The SDK compiles as one library, so a call the
/// search did not return still compiles and fails at run time with
/// <see cref="ApiErrorCode.Unavailable"/>, naming the capability the run withheld.
/// </remarks>
/// <ggmodule>docs</ggmodule>
public static partial class Docs
{
    /// <summary>Find the calls this run offers, by keyword or by module, and read the briefs.</summary>
    /// <remarks>
    /// <para>
    /// Matching is case-insensitive substring over names, signatures, briefs and detailed
    /// descriptions, so <c>"foobar"</c> finds <c>GetFoobar</c>. Hits are ranked by what matched: an
    /// entry whose own name carries the word comes before one that merely mentions it.
    /// </para>
    /// <para>
    /// The filters compose with the query and with each other, and <paramref name="modules"/> is a
    /// lookup rather than a search. A call with no query and no filter at all is refused. The page
    /// is returned as a value and is also opened as a view, and the next search replaces that view.
    /// </para>
    /// </remarks>
    /// <param name="query">
    /// The words to look for. Left out, the filters beside it are the whole of the search.
    /// </param>
    /// <param name="modules">
    /// The modules to look in, each by gg's own id (<c>"views"</c>) or by the path this arm writes
    /// it as (<c>"Gg.Views"</c>). Several are a union: an entry in any one of them is a hit. Exact
    /// and case-insensitive; a name no module has matches nothing rather than failing. Left out, or
    /// empty, no module filter at all.
    /// </param>
    /// <param name="type">
    /// One type's name, which narrows to that type and to the functions taking or returning it.
    /// </param>
    /// <param name="kind">
    /// Narrow to modules, to functions or to types. Left out, all three are searched.
    /// </param>
    /// <param name="offset">How many hits to skip. Left out, the page starts at the first.</param>
    /// <param name="limit">
    /// How many hits to return: 20 where it is left out, 100 at most, and zero refused.
    /// </param>
    /// <returns>one page of matches, best first, and the total behind it.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a call with no query and no filter beside it,
    /// and for a <paramref name="limit"/> of zero.
    /// </exception>
    /// <ggop>docs.search</ggop>
    public static DocPage Search(
        string? query = null,
        string[]? modules = null,
        string? type = null,
        DocKind? kind = null,
        uint? offset = null,
        uint? limit = null)
    {
        Internal.Wire.Check(Internal.Native.SearchDocs(
            query,
            Internal.Wire.Or(modules),
            type,
            Internal.Wire.Word(kind),
            Internal.Wire.Slot(offset),
            Internal.Wire.Slot(limit),
            out var page,
            out var keys,
            out var kinds,
            out var hitModules,
            out var names,
            out var summaries));
        var hits = new DocHit[keys.Length];
        for (var index = 0; index < keys.Length; index++)
        {
            hits[index] = new DocHit(
                keys[index],
                Internal.Wire.Kind(kinds[index]),
                hitModules[index],
                names[index],
                summaries[index]);
        }
        return new DocPage(page[0], page[1], hits);
    }

    /// <summary>Take one documentation view back out of the context window, by its key.</summary>
    /// <remarks>
    /// A plain removal with no cascade: closing a function's view leaves the views of the types it
    /// mentions open, and closing a type's leaves the functions. A key that is not open closes zero
    /// rather than failing. A type closed here is opened again by the next function that mentions
    /// it.
    /// </remarks>
    /// <param name="key">The fully-qualified name the view was opened under.</param>
    /// <returns>how many views were closed, which is one unless it had already gone.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> where this run does not offer the call.
    /// </exception>
    /// <ggop>docs.close</ggop>
    public static uint Close(string key)
    {
        Internal.Wire.Check(Internal.Native.CloseDocView(key, out var closed));
        return closed;
    }

    /// <summary>Take every documentation view out of the context window at once.</summary>
    /// <remarks>
    /// Only documentation views go, and having none open returns zero rather than failing.
    /// </remarks>
    /// <returns>how many views went.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> where this run does not offer the call.
    /// </exception>
    /// <ggop>docs.close_all</ggop>
    public static uint CloseAll()
    {
        Internal.Wire.Check(Internal.Native.CloseDocViews(out var closed));
        return closed;
    }
}
