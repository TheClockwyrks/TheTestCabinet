using System.Collections.Generic;

namespace Gg;

/// <summary>Read, write, edit, list and walk the files of the workspace.</summary>
/// <remarks>Nothing here adds to the context window; a read hands bytes to the program.</remarks>
/// <ggmodule>files</ggmodule>
public static partial class Files
{
    /// <summary>Read a file, as either a <see cref="TextFile"/> or a <see cref="ImageFile"/>.</summary>
    /// <remarks>
    /// <para>
    /// Which of the two comes back is detected from the file's bytes, not from its extension. A
    /// relative path resolves against the workspace; an absolute path is read as given. Reading an
    /// image returns its label, media type and byte size; the pixels reach neither the program nor
    /// the context window.
    /// </para>
    /// <code>
    /// if (Files.ReadFile("logo.png") is Files.ImageFile picture)
    /// {
    ///     Files.WriteFile("kind.txt", $"{picture.Label}, {picture.Bytes} bytes");
    /// }
    /// </code>
    /// </remarks>
    /// <param name="path">The file to read, relative to the workspace or absolute.</param>
    /// <param name="offset">The 1-based first line. Left out, the read starts at the first line.</param>
    /// <param name="limit">How many lines to read. Left out, a capped read policy's default applies, or the read runs to the end.</param>
    /// <returns>the file's text window, or the picture's description.</returns>
    /// <exception cref="ApiException"><see cref="ApiErrorCode.NotFound"/> for a missing path.</exception>
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

    /// <summary>Write UTF-8 text to a file, creating parent directories and replacing what is there.</summary>
    /// <param name="path">Where to write, relative to the workspace or absolute.</param>
    /// <param name="contents">The UTF-8 text to write. It replaces the file entirely.</param>
    /// <returns>how many bytes were written.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for an empty path, and
    /// <see cref="ApiErrorCode.IOError"/> when creating the parent directories or the write itself
    /// failed.
    /// </exception>
    /// <ggop>files.write_file</ggop>
    public static ulong WriteFile(string path, string contents)
    {
        Internal.Wire.Check(Internal.Native.WriteFile(path, contents, out var written));
        return written;
    }

    /// <summary>Replace the one exact occurrence of some text in a file with something else.</summary>
    /// <param name="path">The file to edit.</param>
    /// <param name="oldString">The exact text to find, whitespace included. It must appear once.</param>
    /// <param name="newString">The text to put in its place. An empty string deletes the match.</param>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> when the text does not appear, and
    /// <see cref="ApiErrorCode.Conflict"/> — with the number of matches — when it appears more than
    /// once.
    /// </exception>
    /// <ggop>files.edit_file</ggop>
    public static void EditFile(string path, string oldString, string newString) =>
        Internal.Wire.Check(Internal.Native.EditFile(path, oldString, newString));

    /// <summary>List a directory, sorted by name.</summary>
    /// <remarks>An empty directory is an empty list rather than a failure.</remarks>
    /// <param name="path">The directory to list. Left out, the workspace root is listed.</param>
    /// <returns>the directory's immediate entries only; nothing here descends into a subdirectory.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for a directory that is not there, and
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a path that is given but empty.
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

    /// <summary>Render the tree beneath a directory, skipping everything the ignore files exclude.</summary>
    /// <remarks>
    /// <para>
    /// One block of text: the root itself unnamed, each level indented two further spaces than its
    /// parent, every level in path order, and directories suffixed <c>/</c>. A root with nothing
    /// beneath it renders as <c>(empty directory)</c>.
    /// </para>
    /// <para>
    /// <paramref name="depth"/> counts levels of children below the root, so <c>1</c> is the root's
    /// own entries. A directory sitting at the bound is suffixed with how many entries it holds
    /// that were not walked, as <c>assets/ (12 entries not shown)</c>.
    /// </para>
    /// <para>
    /// What <c>.gitignore</c>, <c>.ignore</c>, <c>.git/info/exclude</c> and the global ignore file
    /// exclude is never walked and never rendered, nested ignore files and negations included, and
    /// <c>.git</c> itself is skipped. No repository is needed for that to hold. Dotfiles are
    /// otherwise rendered like any other entry, and symbolic links are not followed.
    /// </para>
    /// <para>
    /// The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut by
    /// either ends with a line saying so.
    /// </para>
    /// </remarks>
    /// <param name="path">
    /// The directory to walk, relative to the workspace or absolute. Left out, the workspace root is
    /// walked.
    /// </param>
    /// <param name="depth">
    /// How many levels of children below the root to render: 2 when left out, 10 at most — a larger
    /// request is answered at 10 — and zero is refused.
    /// </param>
    /// <returns>the rendered tree.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.NotFound"/> for a path that is not there, and
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a path that is not a directory or a depth of
    /// zero.
    /// </exception>
    /// <ggop>files.tree</ggop>
    public static string Tree(string? path = null, uint? depth = null)
    {
        if (depth == 0)
        {
            throw new ApiException(
                ApiErrorCode.InvalidArgument,
                "tree",
                "depth must be at least 1 (0 given); leave it out for gg's default");
        }
        Internal.Wire.Check(Internal.Native.Tree(path, Internal.Wire.Slot(depth), out var rendered));
        return rendered;
    }

    /// <summary>Search the workspace's files for a pattern, and hand back every line that matched it.</summary>
    /// <remarks>
    /// <para>
    /// A <c>grep</c> over the workspace. The query is a regular expression in Rust syntax —
    /// <c>"foo|bar"</c>, <c>@"fn\s+update"</c>, <c>"(?i)todo"</c> for a case-insensitive match —
    /// matched against each line on its own. Each <see cref="SearchMatch"/> carries the file's
    /// path, the 1-based line number and the line itself, in path order and then line order.
    /// </para>
    /// <para>
    /// The search honours ignore files: what <c>.gitignore</c>, <c>.ignore</c>,
    /// <c>.git/info/exclude</c> and the global ignore file exclude is never scanned and never
    /// returned, nested ignore files and negations included, and <c>.git</c> itself is skipped. No
    /// repository is needed for that to hold, and dotfiles are searched like any other. A file that
    /// is not text — one carrying a NUL byte — is skipped, and a matching line longer than 200
    /// characters is cut there and annotated in place as <c>foo (123 more chars...)</c>.
    /// </para>
    /// <para>
    /// A result exactly <paramref name="limit"/> long may have been cut. There is no offset
    /// argument.
    /// </para>
    /// </remarks>
    /// <param name="query">The regular expression to look for, in Rust syntax, matched line by line.</param>
    /// <param name="path">
    /// The directory or file to search, relative to the workspace or absolute. A file searches that
    /// file alone. Left out, the workspace root is searched, and ignore files are honoured from the
    /// root down wherever the search is rooted.
    /// </param>
    /// <param name="limit">
    /// How many matches to hand back at most: 50 when left out, 200 at most — a larger request is
    /// answered with the first 200 — and zero is refused.
    /// </param>
    /// <returns>every matching line, each with its path and 1-based line number.</returns>
    /// <exception cref="ApiException">
    /// <see cref="ApiErrorCode.InvalidArgument"/> for a query that is blank or not a valid pattern,
    /// or for a limit of zero, and <see cref="ApiErrorCode.NotFound"/> for a path that is not there.
    /// </exception>
    /// <ggop>files.search</ggop>
    public static IReadOnlyList<SearchMatch> Search(string query, string? path = null, uint? limit = null)
    {
        if (limit == 0)
        {
            throw new ApiException(
                ApiErrorCode.InvalidArgument,
                "search",
                "limit must be at least 1 (0 given); leave it out for gg's default");
        }
        Internal.Wire.Check(Internal.Native.Search(
            query,
            path,
            Internal.Wire.Slot(limit),
            out var paths,
            out var lines,
            out var texts));
        var matches = new SearchMatch[paths.Length];
        for (var index = 0; index < paths.Length; index++)
        {
            matches[index] = new SearchMatch(paths[index], lines[index], texts[index]);
        }
        return matches;
    }
}
