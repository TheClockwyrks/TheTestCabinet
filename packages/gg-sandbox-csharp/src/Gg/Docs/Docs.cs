namespace Gg;

/// <summary>Search this surface's own documentation, and take a documentation view back out.</summary>
/// <remarks>
/// <para>
/// Nothing names the functions of this surface up front, so <see cref="Search"/> is where a program
/// starts: it answers with briefs and with the fully-qualified names
/// <c>Views.OpenDocsView</c> takes, which is the whole of the loop from "what do I have" to reading
/// one entry in full.
/// </para>
/// <para>
/// A search only ever returns what this agent may actually call. The compiler is less careful — the
/// SDK is one library and every module of it compiles — so a program can write a call that a search
/// would never have shown it, and what happens then is a
/// <see cref="ToolErrorCode.Unavailable"/> naming the capability the run withheld.
/// </para>
/// </remarks>
/// <ggmodule>docs</ggmodule>
public static partial class Docs
{
    /// <summary>Find what this agent can call, by keyword or by module, and read the briefs.</summary>
    /// <remarks>
    /// <para>
    /// Matching is case-insensitive substring over names, signatures, briefs and detailed
    /// descriptions, so <c>"foobar"</c> finds <c>GetFoobar</c>. Hits are ranked by what matched: an
    /// entry whose own name carries the word comes before one that merely mentions it in a
    /// paragraph.
    /// </para>
    /// <para>
    /// The filters compose with the query and with each other, and <paramref name="module"/> is a
    /// lookup rather than a search — an empty query with a module named is that module's whole
    /// directory. An empty query with no filter at all is refused, because a search that asked for
    /// nothing and a search that found nothing are different answers.
    /// </para>
    /// <para>
    /// The page comes back as a value <em>and</em> is opened as a view, so the next turn can read it
    /// without the program showing it to itself. The next search replaces that view: it names what
    /// is being worked from rather than keeping a record.
    /// </para>
    /// <code>
    /// var found = Docs.Search("memory", limit: 5);
    /// foreach (var hit in found.Hits)
    /// {
    ///     Views.OpenDocsView(hit.Key);
    /// }
    /// </code>
    /// </remarks>
    /// <param name="query">
    /// The words to look for. Empty is allowed only alongside a filter, and is how a module's whole
    /// directory is listed.
    /// </param>
    /// <param name="module">
    /// One module, by gg's own id (<c>"views"</c>) or by the path this arm writes it as
    /// (<c>"Gg.Views"</c>). Exact and case-insensitive: a module filter is a lookup, so a name no
    /// module has matches nothing rather than failing.
    /// </param>
    /// <param name="type">
    /// One type's name, which narrows to that type and to the functions taking or returning it.
    /// </param>
    /// <param name="kind">
    /// Narrow to modules, to functions or to types. Left out, all three are searched.
    /// </param>
    /// <param name="offset">How many hits to skip. Left out, the page starts at the first.</param>
    /// <param name="limit">
    /// How many hits to return: 20 where it is left out, 100 at most, and zero refused. Compare it
    /// against <see cref="DocPage.Total"/> to see how much of the answer this page is.
    /// </param>
    /// <returns>one page of matches, best first, and the total behind it.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty query with no filter beside it, and
    /// for a <paramref name="limit"/> of zero, which is a page that could answer nothing.
    /// </exception>
    /// <ggop>docs.search</ggop>
    public static DocPage Search(
        string query,
        string? module = null,
        string? type = null,
        DocKind? kind = null,
        uint? offset = null,
        uint? limit = null)
    {
        Internal.Wire.Check(Internal.Native.SearchDocs(
            query,
            module,
            type,
            Internal.Wire.Word(kind),
            Internal.Wire.Slot(offset),
            Internal.Wire.Slot(limit),
            out var page,
            out var keys,
            out var kinds,
            out var modules,
            out var names,
            out var summaries));
        var hits = new DocHit[keys.Length];
        for (var index = 0; index < keys.Length; index++)
        {
            hits[index] = new DocHit(
                keys[index],
                Internal.Wire.Kind(kinds[index]),
                modules[index],
                names[index],
                summaries[index]);
        }
        return new DocPage(page[0], page[1], hits);
    }

    /// <summary>Take one documentation view back out of the context window, by its key.</summary>
    /// <remarks>
    /// A plain removal with no cascade: closing a function's view leaves the views of the types it
    /// mentions exactly where they are, and closing a type's leaves the functions. A key that is not
    /// open closes zero rather than failing, so a program that tidies up unconditionally needs no
    /// guard, and a type closed here is opened again by the next function that mentions it.
    /// </remarks>
    /// <param name="key">
    /// The fully-qualified name the view was opened under, as <see cref="DocHit.Key"/> reports it.
    /// </param>
    /// <returns>how many views were closed, which is one unless it had already gone.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when this agent may not close documentation views.
    /// </exception>
    /// <ggop>docs.close</ggop>
    public static uint Close(string key)
    {
        Internal.Wire.Check(Internal.Native.CloseDocView(key, out var closed));
        return closed;
    }

    /// <summary>Take every documentation view out of the context window at once.</summary>
    /// <remarks>
    /// The blanket form of <see cref="Close"/>, on the same terms: no cascade to worry about, and
    /// nothing open is not a failure.
    /// </remarks>
    /// <returns>how many views went.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.Unavailable"/> when this agent may not close documentation views.
    /// </exception>
    /// <ggop>docs.close_all</ggop>
    public static uint CloseAll()
    {
        Internal.Wire.Check(Internal.Native.CloseDocViews(out var closed));
        return closed;
    }
}
