// What an open view is, nested in the module that opens one.

namespace Gg;

public static partial class Views
{
    /// <summary>Which of the three kinds a view is.</summary>
    public enum ViewKind
    {
        /// <summary>A file view, keyed by its workspace path and, for a paged read, its region.</summary>
        File,

        /// <summary>A text view, keyed by the label it was opened under.</summary>
        Text,

        /// <summary>A documentation view, keyed by the name of the function it documents.</summary>
        Docs,
    }

    /// <summary>The line window a paged file view covers.</summary>
    /// <param name="Offset">The 1-based first line the view shows.</param>
    /// <param name="Limit">How many lines it shows.</param>
    public sealed record ViewRegion(uint Offset, uint Limit);

    /// <summary>One view currently open in the context window.</summary>
    /// <param name="Kind">Which of the three kinds it is.</param>
    /// <param name="Selector">What <see cref="Close"/> takes: a file view's path, or a text view's label.</param>
    /// <param name="Tokens">Roughly what holding it costs, in tokens.</param>
    /// <param name="Region">The window a paged file view covers; <c>null</c> for every other view.</param>
    public sealed record OpenView(ViewKind Kind, string Selector, ulong Tokens, ViewRegion? Region);
}
