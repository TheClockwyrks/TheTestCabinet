/**
 * Read, write, edit and list the files of the workspace.
 *
 * Reading is the cheap direction of this sandbox and writing is the expensive one, so a program that
 * reads a dozen files to decide what to change is well shaped, while one that rewrites forty large
 * files in a single turn will exhaust its fuel budget.
 *
 * Nothing here places anything in the agent's context window. `gg.views.openFile` is the call that
 * does.
 *
 * @ggmodule files
 */
package gg.files

import gg.core.ApiError
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggRun
import gg.internal.ggText


/**
 * Read a file, as either a [TextFile] or an [ImageFile].
 *
 * Which of the two comes back is detected from the file's bytes rather than from the extension, so a
 * mislabelled picture is still a picture. [FileRead] is sealed, so a `when` over the two arms needs no
 * `else`:
 *
 * ```
 * when (val read = gg.files.readFile("logo.png")) {
 *     is gg.files.TextFile -> gg.views.openText("logo", read.contents)
 *     is gg.files.ImageFile -> gg.views.openText("logo", read.label)
 * }
 * ```
 *
 * A relative path resolves against the workspace; an absolute one is read as given, so anything else
 * in this container — an offloaded command's output under `/tmp/gg-shell`, say — is readable. This
 * call hands bytes to the program and places nothing in the context window, and reading a picture
 * describes it without showing it, so a file only read here is a file nobody has looked at.
 *
 * The window is honoured only under a capped read policy; where it is not, the whole file comes back
 * and [TextFile.totalLines] says how much of it was returned.
 *
 * @ggop files.read_file
 * @param path The file to read, relative to the workspace or absolute.
 * @param offset The 1-based line to start at. Left out, the read starts at the first line.
 * @param limit How many lines to return from `offset`. Left out, the read runs to the end.
 * @return the file's text, or the picture's description
 * @throws ApiError `NOT_FOUND` for a missing path.
 */
public fun readFile(path: String, offset: Int? = null, limit: Int? = null): FileRead =
    Read.fileRead(
        ggCall("files.read_file", ggText(path), ggNumber(offset), ggNumber(limit)),
    )

/**
 * Read a text file and hand back its contents directly.
 *
 * `gg.files.readFile` without the narrowing, for the common case where the file is known to be text.
 *
 * @ggop files.read_text_file
 * @param path The file to read, relative to the workspace or absolute.
 * @param offset The 1-based line to start at. Left out, the read starts at the first line.
 * @param limit How many lines to return from `offset`. Left out, the read runs to the end.
 * @return the file's text
 * @throws ApiError `INVALID_ARGUMENT` when the path names a picture, which `gg.files.readFile`
 *   inspects and `gg.views.openFile` shows.
 */
public fun readTextFile(path: String, offset: Int? = null, limit: Int? = null): String =
    ggCall("files.read_text_file", ggText(path), ggNumber(offset), ggNumber(limit)).text()

/**
 * Write text to a file, creating parent directories and replacing whatever was there.
 *
 * Writing is the expensive direction of the sandbox: rewriting more than a few dozen large files in
 * one program exhausts its fuel budget, so a large rewrite is better split across several turns.
 *
 * @ggop files.write_file
 * @param path Where to write, relative to the workspace or absolute. Parent directories are created.
 * @param contents The text to write. It replaces the file entirely.
 * @return how many bytes were written
 * @throws ApiError `INVALID_ARGUMENT` for an empty path, and `IO_ERROR` when creating the parent
 *   directories or the write itself failed.
 */
public fun writeFile(path: String, contents: String): Int =
    ggCall("files.write_file", ggText(path), ggText(contents)).integer()

/**
 * Replace the one exact occurrence of `oldString` in a file with `newString`.
 *
 * Widening the surrounding context until the match is unique is the way to a single occurrence;
 * counting them is not, because the count is what the failure reports.
 *
 * @ggop files.edit_file
 * @param path The file to edit.
 * @param oldString The exact text to find, whitespace included. It must appear exactly once.
 * @param newString The text to put in its place. An empty string deletes the match.
 * @throws ApiError `NOT_FOUND` when the text does not appear, and `CONFLICT` — carrying the number
 *   of matches — when it appears more than once.
 */
public fun editFile(path: String, oldString: String, newString: String) {
    ggRun("files.edit_file", ggText(path), ggText(oldString), ggText(newString))
}

/**
 * List a directory, sorted by name.
 *
 * Each entry carries a bare [DirEntry.name] to join with the directory that was listed, and its
 * [DirEntry.kind]. An empty directory is an empty list rather than a failure.
 *
 * @ggop files.list_dir
 * @param path The directory to list, relative to the workspace or absolute. Left out, the workspace
 *   root is listed.
 * @return every entry in that directory
 * @throws ApiError `NOT_FOUND` for a directory that is not there, and `INVALID_ARGUMENT` for a
 *   path that is given but empty — leaving it out is what lists the workspace root.
 */
public fun listDir(path: String? = null): List<DirEntry> =
    Read.dirEntries(ggCall("files.list_dir", ggText(path)))

/**
 * What a file read handed back: a text file's window, or a picture's description.
 *
 * A picture is a different kind of thing from text, so it is a different arm rather than a string
 * that happens to be binary — a program that treats an image as text is caught by the `when` instead
 * of silently writing an empty string somewhere. Image bytes never enter the program: gg attaches the
 * picture to the turn so the model can look at it directly, which is worth more than base64 in a
 * variable.
 *
 * The interface is sealed, so the compiler knows the two arms are all there are.
 */
public sealed interface FileRead

/**
 * A text file's window, as the text arm of a read carries it.
 *
 * @property contents The file's text, or just the requested window under a capped read policy.
 * @property firstLine The 1-based first line returned.
 * @property lastLine The 1-based last line returned.
 * @property totalLines The file's total line count, so a caller knows whether to page again.
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
 * A picture's description, as the image arm of a read carries it.
 *
 * @property mediaType The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
 * @property label The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
 * @property bytes The file's size in bytes.
 * @property shown Whether the picture is being attached to this turn to be looked at.
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
 * One entry a directory listing found.
 *
 * @property name The entry's bare name, with no directory part. Join it with the directory listed.
 * @property kind What the entry is.
 */
public data class DirEntry(val name: String, val kind: EntryKind)

/** What a directory entry is. */
public enum class EntryKind {
    /** An ordinary file. */
    FILE,

    /** A directory, which can be listed in turn. */
    DIRECTORY,

    /** Everything that is neither, a symbolic link among them. */
    OTHER,
}

