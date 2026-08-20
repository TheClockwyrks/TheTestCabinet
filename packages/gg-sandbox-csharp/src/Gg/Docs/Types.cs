// What a documentation search found, nested in the module that searches.

using System.Collections.Generic;

namespace Gg;

public static partial class Docs
{
    /// <summary>Which of the three things a documentation entry describes.</summary>
    /// <remarks>
    /// The taxonomy is closed at three because a surface is the modules a program imports, the
    /// functions inside them and the types their signatures name, and nothing else is documented
    /// separately: a parameter is documented on the function that takes it.
    /// </remarks>
    public enum DocKind
    {
        /// <summary>One module a program imports, whose functions live inside it.</summary>
        Module,

        /// <summary>One callable function.</summary>
        Function,

        /// <summary>One type a function's signature names.</summary>
        Type,
    }

    /// <summary>One entry a search matched: enough to choose from, and no more.</summary>
    /// <param name="Key">
    /// The fully-qualified name <see cref="Views.OpenDocsView"/> takes to read the whole entry.
    /// </param>
    /// <param name="Kind">Whether it is a module, a function or a type.</param>
    /// <param name="Module">
    /// The module it lives in: the one publishing a function, the one declaring a type, and itself
    /// for a module. Always one.
    /// </param>
    /// <param name="Name">The name a program calls it by, the type's own name, or the module's path.</param>
    /// <param name="Summary">Its one-line brief, and only that.</param>
    public sealed record DocHit(
        string Key,
        DocKind Kind,
        string Module,
        string Name,
        string Summary);

    /// <summary>One page of search results, with the total behind it.</summary>
    /// <remarks>
    /// <see cref="Total"/> counts what matched before paging, so a capped page and a complete answer
    /// are told apart without guessing at the page size.
    /// </remarks>
    /// <param name="Total">How many entries matched in all, before this page was cut from them.</param>
    /// <param name="Offset">The offset this page starts at, echoed back.</param>
    /// <param name="Hits">The page itself, best first.</param>
    public sealed record DocPage(uint Total, uint Offset, IReadOnlyList<DocHit> Hits);
}
