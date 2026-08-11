using System.Collections.Generic;

namespace Gg;

/// <summary>Read, write, edit and list the files of the workspace.</summary>
/// <remarks>
/// <para>
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is well shaped, while one that rewrites forty
/// large files in a single turn will exhaust its fuel budget.
/// </para>
/// <para>
/// Nothing here places anything in the agent's context window. <c>Views.OpenFile</c> is the call
/// that does.
/// </para>
/// </remarks>
/// <ggmodule>files</ggmodule>
public static partial class Files
{
    /// <summary>Read a file, as either a <see cref="TextFile"/> or a <see cref="ImageFile"/>.</summary>
    /// <remarks>
    /// <para>
    /// Which of the two comes back is detected from the file's bytes, never from its extension, so a
    /// mislabelled picture is still a picture. Narrow the result before use:
    /// </para>
    /// <code>
    /// if (Files.ReadFile("logo.png") is Files.ImageFile picture)
    /// {
    ///     Views.OpenText("logo", $"{picture.Label}, {picture.Bytes} bytes");
    /// }
    /// </code>
    /// <para>
    /// A relative path resolves against the workspace; an absolute one is read as given, so anything
    /// else in this container is readable. Reading an image describes it — label, media type, byte
    /// size — and shows nothing: the pixels reach neither the program nor the context window.
    /// </para>
    /// </remarks>
    /// <param name="path">The file to read, relative to the workspace or absolute.</param>
    /// <param name="offset">The 1-based first line, honoured only under a capped read policy.</param>
    /// <param name="limit">How many lines to read. Left out, the read runs to the end.</param>
    /// <returns>the file's text window, or the picture's description.</returns>
    /// <exception cref="ToolException"><see cref="ToolErrorCode.NotFound"/> for a missing path.</exception>
    /// <ggop>files.read_file</ggop>
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

    /// <summary>Read a text file and hand back its contents directly.</summary>
    /// <remarks>
    /// <see cref="ReadFile"/> without the narrowing, for the common case: the same read, the same
    /// window, the same cost.
    /// </remarks>
    /// <param name="path">The file to read, relative to the workspace or absolute.</param>
    /// <param name="offset">The 1-based first line, honoured only under a capped read policy.</param>
    /// <param name="limit">How many lines to read. Left out, the read runs to the end.</param>
    /// <returns>the text alone, without the line counts <see cref="TextFile"/> reports beside it.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> when the path names a picture, which
    /// <see cref="ReadFile"/> inspects instead.
    /// </exception>
    /// <ggop>files.read_text_file</ggop>
    public static string ReadTextFile(string path, uint? offset = null, uint? limit = null)
    {
        Internal.Wire.Check(Internal.Native.ReadTextFile(path, Internal.Wire.Slot(offset), Internal.Wire.Slot(limit), out var contents));
        return contents;
    }

    /// <summary>Write UTF-8 text to a file, creating parent directories and replacing what is there.</summary>
    /// <remarks>
    /// Writing is the expensive direction of this sandbox: rewriting more than a few dozen large
    /// files in one program exhausts its fuel budget, so a large rewrite is best split across
    /// several turns.
    /// </remarks>
    /// <param name="path">Where to write, relative to the workspace or absolute.</param>
    /// <param name="contents">The UTF-8 text to write. It replaces the file entirely.</param>
    /// <returns>how many bytes were written.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.InvalidArgument"/> for an empty path, and
    /// <see cref="ToolErrorCode.IOError"/> when creating the parent directories or the write itself
    /// failed.
    /// </exception>
    /// <ggop>files.write_file</ggop>
    public static ulong WriteFile(string path, string contents)
    {
        Internal.Wire.Check(Internal.Native.WriteFile(path, contents, out var written));
        return written;
    }

    /// <summary>Replace the one exact occurrence of some text in a file with something else.</summary>
    /// <remarks>
    /// Widening the surrounding context until the match is unique is the way to disambiguate;
    /// counting occurrences is not.
    /// </remarks>
    /// <param name="path">The file to edit.</param>
    /// <param name="oldString">The exact text to find, whitespace included. It must appear once.</param>
    /// <param name="newString">The text to put in its place. An empty string deletes the match.</param>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> when the text does not appear, and
    /// <see cref="ToolErrorCode.Conflict"/> — with the number of matches — when it appears more than
    /// once.
    /// </exception>
    /// <ggop>files.edit_file</ggop>
    public static void EditFile(string path, string oldString, string newString) =>
        Internal.Wire.Check(Internal.Native.EditFile(path, oldString, newString));

    /// <summary>List a directory, sorted by name.</summary>
    /// <remarks>
    /// Each entry carries a bare <see cref="DirEntry.Name"/>, which has to be joined with the
    /// directory that was listed. An empty directory is an empty list rather than a failure.
    /// </remarks>
    /// <param name="path">The directory to list. Left out, the workspace root is listed.</param>
    /// <returns>the directory's immediate entries only — nothing here descends into a subdirectory.</returns>
    /// <exception cref="ToolException">
    /// <see cref="ToolErrorCode.NotFound"/> for a directory that is not there, and
    /// <see cref="ToolErrorCode.InvalidArgument"/> for a path that is given but empty — leaving it
    /// out altogether is what lists the workspace root.
    /// </exception>
    /// <ggop>files.list_dir</ggop>
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
