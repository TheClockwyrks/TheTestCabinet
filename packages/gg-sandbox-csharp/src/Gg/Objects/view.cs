using System.Collections.Generic;

namespace Gg;

/// <summary>
/// show yourself a file, a value, or a function's documentation — the only way material enters your
/// context
/// </summary>
/// <remarks>
/// <para>
/// A program's own output goes nowhere you can read: <c>Console.WriteLine</c> reaches the run's
/// operator, not you. A <b>view</b> is how a program puts something in front of the model that wrote
/// it — one attributable item in your next prompt, which you can close when you are done with it.
/// </para>
/// <para>
/// There are three kinds and the list is closed: a file, a computed string, and one function's
/// documentation. A picture is not a fourth kind — it is a file view of an image file, and the view
/// carries the picture.
/// </para>
/// </remarks>
public static class view
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("view");

    /// <summary>Read a file and show it to yourself.</summary>
    /// <remarks>
    /// <para>
    /// The read's result comes back exactly as <c>fs.ReadFile</c> returns it, and the file is added to
    /// your context window as its own item. The separation is the point: <c>fs.ReadFile</c> gets bytes
    /// for your program, this shows a file to you, and a program that reads forty files to grep them
    /// still puts nothing in your window.
    /// </para>
    /// <para>
    /// The key is the path and the region together, so two pages of one file are two views and
    /// coexist. Opening the same page again replaces it rather than piling up a duplicate.
    /// </para>
    /// </remarks>
    /// <param name="path">The file to read and show. Relative to your workspace, or absolute.</param>
    /// <param name="offset">The 1-based first line. Leave it out to show the whole file.</param>
    /// <param name="limit">How many lines. Leave it out to show to the end.</param>
    /// <returns>the same read <c>fs.ReadFile</c> would have returned.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a missing path, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> when a view cap this program has spent refuses it.
    /// </exception>
    public static FileRead OpenFile(string path, uint? offset = null, uint? limit = null)
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
            ? new TextFile(
                contents,
                (uint)numbers[0],
                (uint)numbers[1],
                (uint)numbers[2],
                numbers[3] != 0)
            : new ImageFile(mediaType, label, (ulong)numbers[4], numbers[5] != 0, notShownReason);
    }

    /// <summary>Show yourself a value you computed, under a label.</summary>
    /// <remarks>
    /// <para>
    /// This is the call that answers "how do I see the result of my own program". Opening the same
    /// label again replaces what it showed, so a label names a thing rather than a moment.
    /// </para>
    /// <code>
    /// var failed = system.Shell("cargo nextest run --workspace");
    /// view.OpenText("tests", failed.Output);
    /// </code>
    /// </remarks>
    /// <param name="label">
    /// What to file it under. It is also what <see cref="Close"/> takes, so an empty label is refused:
    /// a view with no selector could never be closed or replaced.
    /// </param>
    /// <param name="body">
    /// The text to show. Empty is allowed — it is how a program says that something it was showing is
    /// now empty.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty label, and
    /// <see cref="ToolErrorCode.LimitExceeded"/> naming the cap a body or label went over.
    /// </exception>
    public static void OpenText(string label, string body) =>
        Internal.Wire.Check(Internal.Native.OpenTextView(label, body));

    /// <summary>Show yourself the full documentation for one function.</summary>
    /// <remarks>
    /// <para>
    /// Its signature, its description, what to put in each argument, and the declarations of any types
    /// it refers to that you have not already been shown. It is a view rather than a return value: the
    /// documentation reaches you in your next prompt, under a <c>Documentation</c> heading, and can be
    /// closed like anything else.
    /// </para>
    /// <code>
    /// view.OpenDocsView("CreateIssue");
    /// </code>
    /// </remarks>
    /// <param name="name">
    /// The name you call the function by — <c>ReadFile</c>, <c>CreateIssue</c>, <c>Finish</c>.
    /// </param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a name no function on this surface has.
    /// </exception>
    public static void OpenDocsView(string name) => Internal.Wire.Check(Internal.Native.OpenDocsView(name));

    /// <summary>Close every view whose selector matches, and hand back how many went.</summary>
    /// <remarks>
    /// For a file, every page of that path closes. Closing a selector that is not open returns zero;
    /// it is not a failure.
    /// </remarks>
    /// <param name="selector">A file view's workspace path, or a text view's label.</param>
    /// <returns>how many views were closed.</returns>
    public static uint Close(string selector)
    {
        Internal.Wire.Check(Internal.Native.CloseView(selector, out var closed));
        return closed;
    }

    /// <summary>What is open in your window right now.</summary>
    /// <remarks>
    /// It is called <c>Current</c> rather than <c>List</c> because every API object already carries a
    /// <see cref="List"/> that lists the object's own functions.
    /// </remarks>
    /// <returns>every view you hold, with what each of them costs you.</returns>
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
