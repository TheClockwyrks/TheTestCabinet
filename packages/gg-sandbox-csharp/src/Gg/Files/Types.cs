// The values the filesystem module hands back. Nested in `Files` so that a name is qualified by the
// module that produces it, which is what keeps two modules free to declare a type of one name.

namespace Gg;

public static partial class Files
{
    /// <summary>What a read returned — either a <see cref="TextFile"/> or a <see cref="ImageFile"/>.</summary>
    public abstract record FileRead;

    /// <summary>A file that turned out to be text, and the window of it the read policy returned.</summary>
    /// <param name="Contents">The file's text, or under a capped policy the requested window alone.</param>
    /// <param name="FirstLine">The 1-based first line returned.</param>
    /// <param name="LastLine">The 1-based last line returned.</param>
    /// <param name="TotalLines">The file's total line count.</param>
    /// <param name="ByteTruncated">Whether gg's 256 KiB byte ceiling cut the returned text.</param>
    public sealed record TextFile(
        string Contents,
        uint FirstLine,
        uint LastLine,
        uint TotalLines,
        bool ByteTruncated) : FileRead;

    /// <summary>A file that turned out to be a picture, described rather than decoded.</summary>
    /// <remarks>
    /// The pixels never enter the program. A picture that is not attached names its reason: a
    /// text-only model, a provider refusal, gg's 8 MiB attach cap, or the program's per-turn image
    /// budget.
    /// </remarks>
    /// <param name="MediaType">The IANA media type — <c>image/png</c>, <c>image/jpeg</c>.</param>
    /// <param name="Label">The short format label — <c>PNG</c>, <c>JPEG</c>, <c>GIF</c>, <c>WebP</c>.</param>
    /// <param name="Bytes">The file's size in bytes.</param>
    /// <param name="Shown">Whether the picture is being attached to this turn to be looked at.</param>
    /// <param name="NotShownReason">Why it is not being shown; <c>null</c> when it is.</param>
    public sealed record ImageFile(
        string MediaType,
        string Label,
        ulong Bytes,
        bool Shown,
        string? NotShownReason) : FileRead;

    /// <summary>What a directory entry turned out to be.</summary>
    public enum EntryKind
    {
        /// <summary>An ordinary file.</summary>
        File,

        /// <summary>A directory, which can be listed in turn.</summary>
        Directory,

        /// <summary>Something else — a symlink, a socket, a device.</summary>
        Other,
    }

    /// <summary>One entry in a directory listing.</summary>
    /// <param name="Name">The entry's bare name, which is not a path.</param>
    /// <param name="Kind">Whether it is a file, a directory, or something else.</param>
    public sealed record DirEntry(string Name, EntryKind Kind);

    /// <summary>One line a search matched.</summary>
    /// <param name="Path">
    /// The file's path with <c>/</c> separators, relative to the workspace root or absolute for a
    /// search rooted outside it.
    /// </param>
    /// <param name="Line">The 1-based line number of the match within that file.</param>
    /// <param name="Text">
    /// The matching line without its line ending, cut at 200 characters and annotated
    /// <c>(N more chars...)</c> where longer.
    /// </param>
    public sealed record SearchMatch(string Path, uint Line, string Text);
}
