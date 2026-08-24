using System.Collections.Generic;

namespace Gg;

/// <summary>Put a file, a computed value or an entry's documentation into the context window.</summary>
/// <remarks>
/// <para>
/// A program's own output goes nowhere the model can read it. A view is how a program puts something
/// in front of the model that wrote it: one attributable item in the next prompt, closeable once it
/// has been read.
/// </para>
/// <para>
/// There are three kinds and the list is closed: a file, a computed string, and one entry's
/// documentation. A picture is not a fourth kind — it is a file view of an image file, and the view
/// carries the picture.
/// </para>
/// </remarks>
/// <ggmodule>views</ggmodule>
public static partial class Views
{
    /// <summary>Read a file and show it in the context window.</summary>
    /// <remarks>
    /// <para>
    /// The read's result comes back exactly as <c>Files.ReadFile</c> returns it, and the file is
    /// added to the window as its own item. The separation is the point: <c>Files.ReadFile</c> gets
    /// bytes for the program, this shows a file to the model, and a program that reads forty files
    /// to grep them still adds nothing to the window.
    /// </para>
    /// <para>
    /// The key is the path and the region together, so two pages of one file are two views and
    /// coexist. Opening the same page again replaces it rather than piling up a duplicate.
    /// </para>
    /// <para>
    /// A text view is capped at 65,536 bytes, and a file over it is refused rather than cut: the
    /// refusal names the size, and the way in is a smaller window through
    /// <paramref name="offset"/> and <paramref name="limit"/>, or <paramref name="maxLineChars"/>
    /// for a file whose lines are wider than they are useful — a minified bundle, a log. Each line
    /// of the view longer than that many characters is cut there and annotated in place as
    /// <c>foo (123 more chars...)</c>, and the cap is measured after the cut. Only the view is cut:
    /// what this call returns, and the file itself, are untouched. A picture is not subject to the
    /// cap.
    /// </para>
    /// </remarks>
    /// <param name="path">The file to read and show, relative to the workspace or absolute.</param>
    /// <param name="offset">The 1-based first line. Left out, the whole file is shown.</param>
    /// <param name="limit">How many lines. Left out, the view runs to the end.</param>
    /// <param name="maxLineChars">
    /// The width, in characters, past which each line of the view is cut, from 1 to 65,536. Left
    /// out, lines arrive whole.
    /// </param>
    /// <returns>the read itself, so the program can work with what the model is now being shown.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for a missing path,
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an offset past the end of the file or a
    /// width outside 1 to 65,536, and <see cref="ApiErrorCode.LimitExceeded"/>, naming the size,
    /// for a text view over 65,536 bytes. The read is what fails, and nothing is opened when it does.
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
    /// <remarks>
    /// <para>
    /// This is how the result of a program reaches the model that wrote it. Opening the same label
    /// again replaces what it showed, so a label names a thing rather than a moment.
    /// </para>
    /// <code>
    /// var tests = Shell.Run("cargo nextest run --workspace");
    /// Views.OpenText("tests", tests.Output);
    /// </code>
    /// </remarks>
    /// <param name="label">
    /// What to file it under: the view's selector, so an empty label is refused — a view with no
    /// selector could never be replaced or attributed.
    /// </param>
    /// <param name="body">
    /// The text to show. Empty is allowed, and is how a program says that something it was showing
    /// is now empty.
    /// </param>
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
    /// module's own path, <c>"Gg.Views"</c>. The name a program calls it by (<c>"OpenText"</c>) also
    /// resolves and is a fallback rather than the form to reach for: two modules are free to declare
    /// a <c>Close</c>, and only the qualified name says which one is meant. Searching the
    /// documentation is what says which names exist.
    /// </param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for a name nothing on this surface has.
    /// </exception>
    /// <ggop>views.open_docs_view</ggop>
    public static void OpenDocsView(string name) => Internal.Wire.Check(Internal.Native.OpenDocsView(name));

    /// <summary>Close every view whose selector matches, and hand back how many went.</summary>
    /// <remarks>
    /// For a file, every page of that path closes. Closing a selector that is not open returns zero
    /// rather than failing. Closing a view is context management, bought — with
    /// <see cref="Current"/> — by the <c>agent-managed-context</c> capability: an agent whose run
    /// did not enable it is refused.
    /// </remarks>
    /// <param name="selector">A file view's workspace path, or a text view's label.</param>
    /// <returns>how many views went, counting each page of a paged file separately.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty selector, which names nothing rather
    /// than everything — no call here closes the window wholesale — and
    /// <see cref="ApiErrorCode.Unavailable"/> for an agent whose run did not buy
    /// <c>agent-managed-context</c>.
    /// </exception>
    /// <ggop>views.close</ggop>
    public static uint Close(string selector)
    {
        Internal.Wire.Check(Internal.Native.CloseView(selector, out var closed));
        return closed;
    }

    /// <summary>List what is open in the context window right now.</summary>
    /// <remarks>
    /// Listing what is open is context management, bought with <see cref="Close"/> by the
    /// <c>agent-managed-context</c> capability: an agent whose run did not enable it is refused.
    /// </remarks>
    /// <returns>every open view, with what each of them costs.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.Unavailable"/> for an agent whose run did not buy
    /// <c>agent-managed-context</c>.
    /// </exception>
    /// <ggop>views.current</ggop>
    public static IReadOnlyList<OpenView> Current()
    {
        Internal.Wire.Check(Internal.Native.CurrentViews(
            out var kinds,
            out var selectors,
            out var tokens,
            out var offsets,
            out var limits));
        var views = new OpenView[kinds.Length];
        for (var index = 0; index < kinds.Length; index++)
        {
            var region = offsets[index] < 0
                ? null
                : new ViewRegion((uint)offsets[index], (uint)limits[index]);
            views[index] = new OpenView(
                (ViewKind)kinds[index],
                selectors[index],
                tokens[index],
                region);
        }
        return views;
    }
}
