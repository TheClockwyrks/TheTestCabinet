
namespace Gg;

/// <summary>Put a file, a computed value or an entry's documentation into the context window.</summary>
/// <remarks>
/// A view is one item in the next prompt, keyed by a selector and closeable. There are three kinds:
/// a file, a computed string, and one entry's documentation. An image file opened as a file view
/// carries the picture.
/// </remarks>
/// <ggmodule>views</ggmodule>
public static partial class Views
{
    /// <summary>Read a file and show it in the context window.</summary>
    /// <remarks>
    /// <para>
    /// The read's result is returned as well as shown. A view is keyed by the path and the region
    /// together, so two pages of one file are two views; opening the same page again replaces it.
    /// </para>
    /// <para>
    /// A text view is capped at 65,536 bytes, and a file over the cap is refused rather than cut;
    /// the refusal names the size. Each line of the view longer than
    /// <paramref name="maxLineChars"/> characters is cut there and annotated in place as
    /// <c>foo (123 more chars...)</c>, and the cap is measured after the cut. Only the view is cut:
    /// the returned value and the file itself are untouched. A picture is not subject to the cap.
    /// </para>
    /// </remarks>
    /// <param name="path">The file to read and show, relative to the workspace or absolute.</param>
    /// <param name="offset">The 1-based first line. Left out, the whole file is shown.</param>
    /// <param name="limit">How many lines. Left out, the view runs to the end.</param>
    /// <param name="maxLineChars">
    /// The width, in characters, past which each line of the view is cut, from 1 to 65,536. Left
    /// out, lines arrive whole.
    /// </param>
    /// <returns>the file's text window, or the picture's description.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for a missing path,
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an offset past the end of the file or a
    /// width outside 1 to 65,536, and <see cref="ApiErrorCode.LimitExceeded"/>, naming the size,
    /// for a text view over 65,536 bytes. Nothing is opened when the read fails.
    /// </exception>
    /// <ggop>views.open_file</ggop>
    public static Files.FileRead OpenFile(
        string path,
        uint? offset = null,
        uint? limit = null,
        uint? maxLineChars = null)
    {
        Internal.Wire.Check(Internal.Native.OpenFileView(
            path,
            Internal.Wire.Slot(offset),
            Internal.Wire.Slot(limit),
            Internal.Wire.Slot(maxLineChars),
            out var kind,
            out var contents,
            out var mediaType,
            out var label,
            out var notShownReason,
            out var numbers));
        return kind == 0
            ? new Files.TextFile(
                contents,
                (uint)numbers[0],
                (uint)numbers[1],
                (uint)numbers[2],
                numbers[3] != 0)
            : new Files.ImageFile(mediaType, label, (ulong)numbers[4], numbers[5] != 0, notShownReason);
    }

    /// <summary>Show a computed value in the context window, under a label.</summary>
    /// <remarks>Opening the same label again replaces what it showed.</remarks>
    /// <param name="label">What to file it under: the view's selector. An empty label is refused.</param>
    /// <param name="body">The text to show. Empty is allowed.</param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty label, and
    /// <see cref="ApiErrorCode.LimitExceeded"/> naming the cap a body or label went over.
    /// </exception>
    /// <ggop>views.open_text</ggop>
    public static void OpenText(string label, string body) =>
        Internal.Wire.Check(Internal.Native.OpenTextView(label, body));

    /// <summary>Show the full documentation for one module, function or type in the context window.</summary>
    /// <remarks>
    /// Its declaration, its description, a line per argument where it takes any, and the
    /// declarations of any types it refers to that the session has not already been shown. It is a
    /// view rather than a return value: the documentation arrives in the next prompt, under a
    /// <c>Documentation</c> heading, and is not available in the turn that asks for it. Opening an
    /// entry already open does nothing at all, neither moving it nor sending it again.
    /// </remarks>
    /// <param name="name">
    /// The fully-qualified name the documentation is keyed by — <c>"Gg.Views.OpenText"</c>, or a
    /// module's own path, <c>"Gg.Views"</c>. The unqualified name (<c>"OpenText"</c>) also resolves,
    /// and is ambiguous where two modules declare it.
    /// </param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for a name nothing on this surface has.
    /// </exception>
    /// <ggop>views.open_docs_view</ggop>
    public static void OpenDocsView(string name) => Internal.Wire.Check(Internal.Native.OpenDocsView(name));

    /// <summary>Close every view whose selector matches, and hand back how many went.</summary>
    /// <remarks>
    /// For a file, every page of that path closes. Closing a selector that is not open returns zero
    /// rather than failing.
    /// </remarks>
    /// <param name="selector">A file view's workspace path, or a text view's label.</param>
    /// <returns>how many views went, counting each page of a paged file separately.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty selector, and
    /// <see cref="ApiErrorCode.Unavailable"/> where this run does not offer the call.
    /// </exception>
    /// <ggop>views.close</ggop>
    public static uint Close(string selector)
    {
        Internal.Wire.Check(Internal.Native.CloseView(selector, out var closed));
        return closed;
    }

}
