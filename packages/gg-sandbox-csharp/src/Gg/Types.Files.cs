namespace Gg;

/// <summary>
/// What a read returned — either <see cref="TextFile"/> or <see cref="ImageFile"/>, and never both.
/// </summary>
/// <remarks>
/// <para>
/// A picture is a different kind of thing from text, so it is a different case: a program that
/// treated an image as text is caught by the type system here rather than silently writing an empty
/// string somewhere. The format is detected from the file's bytes, never from its extension.
/// </para>
/// <para>Narrow it the way you narrow any closed hierarchy in C#:</para>
/// <code>
/// if (fs.ReadFile("logo.png") is TextFile text)
/// {
///     view.OpenText("logo", text.Contents);
/// }
/// else if (fs.ReadFile("logo.png") is ImageFile picture)
/// {
///     view.OpenText("logo", $"{picture.Label}, {picture.Bytes} bytes");
/// }
/// </code>
/// </remarks>
public abstract record FileRead;

/// <summary>A file that turned out to be text, and the window of it this run's read policy returned.</summary>
/// <param name="Contents">
/// The file's text. Under a capped read policy this is the requested window only, with no
/// explanatory footer — the fields below describe the window instead.
/// </param>
/// <param name="FirstLine">The 1-based first line returned.</param>
/// <param name="LastLine">The 1-based last line returned.</param>
/// <param name="TotalLines">The file's total line count, so you know whether to page again.</param>
/// <param name="ByteTruncated">Whether gg's 256 KiB byte ceiling cut the returned text.</param>
public sealed record TextFile(
    string Contents,
    uint FirstLine,
    uint LastLine,
    uint TotalLines,
    bool ByteTruncated) : FileRead;

/// <summary>
/// A file that turned out to be a picture, described rather than decoded.
/// </summary>
/// <remarks>
/// The pixels never enter your program. Reading a picture tells you what it is; <c>view.OpenFile</c>
/// is what actually shows it to you, by attaching it to your next prompt.
/// </remarks>
/// <param name="MediaType">The IANA media type (<c>image/png</c>, <c>image/jpeg</c>, <c>image/gif</c>, <c>image/webp</c>).</param>
/// <param name="Label">The short format label (<c>PNG</c>, <c>JPEG</c>, <c>GIF</c>, <c>WebP</c>).</param>
/// <param name="Bytes">The file's size in bytes.</param>
/// <param name="Shown">Whether the picture is being attached to this turn for you to look at.</param>
/// <param name="NotShownReason">
/// Why it is not being shown — a text-only model, a provider refusal, gg's 8 MiB attach cap, or this
/// program's per-turn image budget. <c>null</c> when <paramref name="Shown"/> is true.
/// </param>
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

    /// <summary>A directory, which you can list in turn.</summary>
    Directory,

    /// <summary>Something else — a symlink, a socket, a device.</summary>
    Other,
}

/// <summary>One entry in a directory listing.</summary>
/// <param name="Name">The entry's bare name. It is not a path: join it with the directory you listed.</param>
/// <param name="Kind">Whether it is a file, a directory, or something else.</param>
public sealed record DirEntry(string Name, EntryKind Kind);
