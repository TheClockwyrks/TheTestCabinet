/**
 * What `fs.readFile` returned: a text file's window, or a picture's description.
 *
 * A picture is a different kind of thing from text, so it is a different arm rather than a string that
 * happens to be binary — a program that treats an image as text is caught by the `when` instead of
 * silently writing an empty string somewhere. Image *bytes* never enter the program: gg attaches the
 * picture to the turn so you can look at it directly, which is worth far more than base64 in a variable.
 *
 * It is a **sealed** interface, so the compiler knows the two arms are all there are and a `when` over
 * them needs no `else`:
 *
 * ```
 * when (val read = fs.readFile("logo.png")) {
 *     is TextFile -> view.openText("logo", read.contents)
 *     is ImageFile -> view.openText("logo", read.label)
 * }
 * ```
 */
public sealed interface FileRead

/**
 * A text file's window, as the [TextFile] arm of a read carries it.
 *
 * @property contents The file's text, or just the requested window under a capped read policy.
 * @property firstLine The 1-based first line returned.
 * @property lastLine The 1-based last line returned.
 * @property totalLines The file's total line count, so you know whether to page again.
 * @property byteTruncated Whether a 256 KiB byte ceiling cut the returned text.
 */
public data class TextFile(
    val contents: String,
    val firstLine: Int,
    val lastLine: Int,
    val totalLines: Int,
    val byteTruncated: Boolean,
) : FileRead

/**
 * A picture's description, as the [ImageFile] arm of a read carries it.
 *
 * @property mediaType The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
 * @property label The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
 * @property bytes The file's size in bytes.
 * @property shown Whether the picture is being attached to this turn for you to look at.
 * @property notShownReason Why it is not being shown; `null` when `shown` is true.
 */
public data class ImageFile(
    val mediaType: String,
    val label: String,
    val bytes: Int,
    val shown: Boolean,
    val notShownReason: String?,
) : FileRead

/**
 * One entry `fs.listDir` found.
 *
 * @property name The entry's bare name, with no directory part. Join it with the directory you listed.
 * @property kind What the entry is.
 */
public data class DirEntry(val name: String, val kind: EntryKind)

/** What a directory entry is. */
public enum class EntryKind {
    /** An ordinary file. */
    FILE,

    /** A directory, which you can list in turn. */
    DIRECTORY,

    /** Everything that is neither, a symlink among them. */
    OTHER,
}

/**
 * What a command `system.shell` ran reported when it finished.
 *
 * @property exitCode The process's exit status; `null` when a signal killed it. Zero means success.
 * @property output Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads shell
 *   output, at the configured line/character ceiling, with a note naming the files holding the whole of
 *   it. Under the default `adaptive` mode a command that succeeded returns just that note.
 * @property truncated Whether the cap cut `output`, dropping the head and keeping the tail.
 */
public data class ShellOutput(val exitCode: Int?, val output: String, val truncated: Boolean)

/**
 * One function in an API object's directory, as `list` returns it.
 *
 * The summary is one line; the whole documentation of a function — every shape it may be called in, what
 * to put in each argument, and the types it refers to — is a view, opened with `view.openDocsView`.
 *
 * @property name The function name on its object — `readFile` in `fs.readFile`.
 * @property summary One line saying what it does: the first sentence of its documentation.
 */
public data class FunctionSummary(val name: String, val summary: String)
