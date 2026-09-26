// What a documentation search found, nested in the module that searches.

using System.Collections.Generic;

namespace Gg;

public static partial class Docs
{
    /// <summary>Which of the three things a documentation entry describes.</summary>
    public enum DocKind
    {
        /// <summary>One module a program imports, whose functions live inside it.</summary>
        Module,

        /// <summary>One callable function.</summary>
        Function,

        /// <summary>One type a function's signature names.</summary>
        Type,
    }

    /// <summary>One entry a search matched.</summary>
    /// <param name="Key">
    /// The entry's fully-qualified name, which a documentation view is opened by.
    /// </param>
    /// <param name="Kind">Whether it is a module, a function or a type.</param>
    /// <param name="Module">
    /// The module it lives in: the one publishing a function, the one declaring a type, and itself
    /// for a module.
    /// </param>
    /// <param name="Name">The name a program calls it by, the type's own name, or the module's path.</param>
    /// <param name="Summary">Its one-line brief.</param>
    public sealed record DocHit(
        string Key,
        DocKind Kind,
        string Module,
        string Name,
        string Summary);

    /// <summary>One page of search results, with the total behind it.</summary>
    /// <param name="Total">How many entries matched in all, before this page was cut from them.</param>
    /// <param name="Offset">The offset this page starts at, echoed back.</param>
    /// <param name="Hits">The page itself, best first.</param>
    public sealed record DocPage(uint Total, uint Offset, IReadOnlyList<DocHit> Hits);
}
