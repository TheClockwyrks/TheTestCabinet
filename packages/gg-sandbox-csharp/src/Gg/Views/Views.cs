using System.Collections.Generic;

namespace Gg;

/// <summary>Put a file, a computed value or a function's documentation into the context window.</summary>
/// <remarks>
/// <para>
/// A program's own output goes nowhere the model can read it. A view is how a program puts something
/// in front of the model that wrote it: one attributable item in the next prompt, closeable once it
/// has been read.
/// </para>
/// <para>
/// There are three kinds and the list is closed: a file, a computed string, and one function's
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
    /// </remarks>
    /// <param name="path">The file to read and show, relative to the workspace or absolute.</param>
    /// <param name="offset">The 1-based first line. Left out, the whole file is shown.</param>
    /// <param name="limit">How many lines. Left out, the view runs to the end.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a missing path, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an offset past the end of the file.
    /// </exception>
    /// <ggop>views.open_file</ggop>
    public static Files.FileRead OpenFile(string path, uint? offset = null, uint? limit = null)
    {
        Internal.Wire.Check(Internal.Native.OpenFileView(
            path,
            Internal.Wire.Slot(offset),
            Internal.Wire.Slot(limit),
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
    /// What to file it under. It is also what <see cref="Close"/> takes, so an empty label is
    /// refused: a view with no selector could never be closed or replaced.
    /// </param>
    /// <param name="body">
    /// The text to show. Empty is allowed, and is how a program says that something it was showing
    /// is now empty.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty label, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> naming the cap a body or label went over.
    /// </exception>
    /// <ggop>views.open_text</ggop>
    public static void OpenText(string label, string body) =>
        Internal.Wire.Check(Internal.Native.OpenTextView(label, body));

    /// <summary>Show the full documentation for one function in the context window.</summary>
    /// <remarks>
    /// Its signature, its description, what each argument takes, and the declarations of any types
    /// it refers to that the session has not already been shown. It is a view rather than a return
    /// value: the documentation arrives in the next prompt, under a <c>Documentation</c> heading,
    /// and closes like anything else.
    /// </remarks>
    /// <param name="name">
    /// The fully-qualified name the function's documentation is keyed by —
    /// <c>"Gg.Files.ReadFile"</c>. The name a program calls it by (<c>"ReadFile"</c>) also resolves
    /// and is a fallback rather than the form to reach for: two modules are free to declare a
    /// <c>Close</c>, and only the qualified name says which one is meant. Searching the
    /// documentation is what says which names exist.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a name no function on this surface has.
    /// </exception>
    /// <ggop>views.open_docs_view</ggop>
    public static void OpenDocsView(string name) => Internal.Wire.Check(Internal.Native.OpenDocsView(name));

    /// <summary>Close every view whose selector matches, and hand back how many went.</summary>
    /// <remarks>
    /// For a file, every page of that path closes. Closing a selector that is not open returns zero
    /// rather than failing.
    /// </remarks>
    /// <param name="selector">A file view's workspace path, or a text view's label.</param>
    /// <ggop>views.close</ggop>
    public static uint Close(string selector)
    {
        Internal.Wire.Check(Internal.Native.CloseView(selector, out var closed));
        return closed;
    }

    /// <summary>List what is open in the context window right now.</summary>
    /// <returns>every open view, with what each of them costs.</returns>
    /// <ggop>views.current</ggop>
    public static IReadOnlyList<OpenView> Current()
    {
        Internal.Native.CurrentViews(
            out var kinds,
            out var selectors,
            out var tokens,
            out var offsets,
            out var limits);
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
