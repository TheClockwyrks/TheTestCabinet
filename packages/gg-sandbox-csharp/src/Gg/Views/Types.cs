// What an open view is, nested in the module that opens one, and the method that closes it again.

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

        /// <summary>A documentation view, keyed by the fully-qualified name of the entry it documents.</summary>
        Docs,
    }

    /// <summary>The line window a paged file view covers.</summary>
    /// <param name="Offset">The 1-based first line the view shows.</param>
    /// <param name="Limit">How many lines it shows.</param>
    public sealed record ViewRegion(uint Offset, uint Limit);

    /// <summary>One view currently open in the context window.</summary>
    /// <param name="Kind">Which of the three kinds it is.</param>
    /// <param name="Selector">What <see cref="Views.Close(string)"/> takes: a file view's path, or a text view's label.</param>
    /// <param name="Tokens">Roughly what holding it costs, in tokens.</param>
    /// <param name="Region">The window a paged file view covers; <c>null</c> for every other view.</param>
    public sealed record OpenView(ViewKind Kind, string Selector, ulong Tokens, ViewRegion? Region)
    {
        /// <summary>Close this view, and any other view sharing its selector.</summary>
        /// <remarks>
        /// <see cref="Views.Close"/> with the selector already supplied, which is the call this
        /// listing exists to feed. A <see cref="ViewKind.Docs"/> view is the one it does not reach,
        /// so closing one here returns zero.
        /// </remarks>
        /// <returns>how many views went, counting each page of a paged file separately.</returns>
        /// <exception cref="ApiException">
        /// <see cref="ApiErrorCode.Unavailable"/> for an agent whose run did not buy
        /// <c>agent-managed-context</c>, which is what buys closing a view.
        /// </exception>
        /// <ggop alias="true">views.close</ggop>
        public uint Close() => Views.Close(Selector);
    }
}
