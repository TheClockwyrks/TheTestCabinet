using System.Collections.Generic;

namespace Gg;

/// <summary>
/// read, write, and edit workspace files
/// </summary>
/// <remarks>
/// <para>
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is doing the right thing, while one that
/// rewrites forty large files in a single turn will exhaust its fuel budget.
/// </para>
/// <para>
/// Nothing here puts anything in your context window. <c>view.OpenFile</c> is the call that shows a
/// file to <i>you</i>.
/// </para>
/// </remarks>
public static class fs
{
    /// <inheritdoc cref="Internal.ObjectDirectory.List"/>
    public static IReadOnlyList<FunctionSummary> List() => Internal.ObjectDirectory.List("fs");

    /// <summary>
    /// Read a file, handing back a <see cref="TextFile"/> or an <see cref="ImageFile"/> — the format
    /// is detected from the file's bytes, never from its extension.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This gets bytes for your <i>program</i> and puts nothing in your context window;
    /// <c>view.OpenFile</c> is the call that shows the file to you. A relative path resolves against
    /// your workspace; an absolute one is read as given, so anything in this container — an offloaded
    /// command's output under <c>/tmp/gg-shell</c>, say — is readable.
    /// </para>
    /// <para>
    /// Reading an image describes it to your program — label, media type, byte size — and does not
    /// show it to you: the pixels reach neither your program nor your context window, so a file you
    /// only read is a file you have not looked at.
    /// </para>
    /// </remarks>
    /// <param name="path">
    /// The file to read. Relative to your workspace, or absolute for anything else in this container.
    /// </param>
    /// <param name="offset">
    /// The 1-based first line to read. Leave it out to start at the beginning. Honoured only under a
    /// capped read policy; under the unlimited policy the whole file comes back.
    /// </param>
    /// <param name="limit">How many lines to read. Leave it out to read to the end.</param>
    /// <returns>the file's text window, or the picture's description.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for a missing path.</exception>
    public static FileRead ReadFile(string path, uint? offset = null, uint? limit = null)
    {
        Internal.Wire.Check(Internal.Native.ReadFile(
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

    /// <summary>
    /// Read a text file and hand back its contents directly — <see cref="ReadFile"/> without the
    /// narrowing, for the common case.
    /// </summary>
    /// <remarks>
    /// The same read, the same window, the same cost. Reading is the cheap direction of this sandbox,
    /// so a program that reads a dozen files to decide what to change is doing the right thing.
    /// </remarks>
    /// <param name="path">The file to read. Relative to your workspace, or absolute.</param>
    /// <param name="offset">The 1-based first line to read. Leave it out to start at the beginning.</param>
    /// <param name="limit">How many lines to read. Leave it out to read to the end.</param>
    /// <returns>the file's text.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> when the path names a picture — use
    /// <see cref="ReadFile"/> to inspect one, and <c>view.OpenFile</c> to look at it.
    /// </exception>
    public static string ReadTextFile(string path, uint? offset = null, uint? limit = null)
    {
        Internal.Wire.Check(Internal.Native.ReadTextFile(path, Internal.Wire.Slot(offset), Internal.Wire.Slot(limit), out var contents));
        return contents;
    }

    /// <summary>
    /// Write UTF-8 text to a file, creating parent directories and replacing any existing file.
    /// </summary>
    /// <remarks>
    /// Writing is the expensive direction of this sandbox — rewriting more than a few dozen large
    /// files in one program exhausts its fuel budget, so split a large rewrite across several turns.
    /// </remarks>
    /// <param name="path">
    /// Where to write. Relative to your workspace, or absolute. Parent directories are created for you.
    /// </param>
    /// <param name="contents">The UTF-8 text to write. It replaces the file entirely.</param>
    /// <returns>how many bytes were written.</returns>
    public static ulong WriteFile(string path, string contents)
    {
        Internal.Wire.Check(Internal.Native.WriteFile(path, contents, out var written));
        return written;
    }

    /// <summary>Replace the one exact occurrence of some text in a file with something else.</summary>
    /// <remarks>
    /// Widen the surrounding context until the match is unique rather than counting occurrences.
    /// </remarks>
    /// <param name="path">The file to edit.</param>
    /// <param name="oldString">
    /// The exact text to find, including its whitespace. It must appear exactly once.
    /// </param>
    /// <param name="newString">The text to put in its place. An empty string deletes the match.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> when the text does not appear, and
    /// <see cref="ToolErrorCode.Conflict"/> — with the number of matches — when it appears more than once.
    /// </exception>
    public static void EditFile(string path, string oldString, string newString) =>
        Internal.Wire.Check(Internal.Native.EditFile(path, oldString, newString));

    /// <summary>List a directory, sorted by name.</summary>
    /// <remarks>
    /// Each entry carries a bare <see cref="DirEntry.Name"/> — join it with the directory you listed —
    /// and its <see cref="DirEntry.Kind"/>. An empty directory is an empty list, not a failure.
    /// </remarks>
    /// <param name="path">
    /// The directory to list, relative to your workspace or absolute. Leave it out to list your
    /// workspace root.
    /// </param>
    /// <returns>the directory's entries, sorted by name.</returns>
    public static IReadOnlyList<DirEntry> ListDir(string? path = null)
    {
        Internal.Wire.Check(Internal.Native.ListDir(path, out var names, out var kinds));
        var entries = new DirEntry[names.Length];
        for (var index = 0; index < names.Length; index++)
        {
            entries[index] = new DirEntry(names[index], (EntryKind)kinds[index]);
        }
        return entries;
    }
}
