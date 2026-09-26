/**
 * Read, write, edit, list and walk the files of the workspace.
 *
 * Nothing here places anything in the context window: a read hands bytes to the program.
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
 * Which of the two comes back is detected from the file's bytes rather than from the extension.
 * [FileRead] is sealed, so a `when` over the two arms needs no `else`.
 *
 * A relative path resolves against the workspace; an absolute one is read as given.
 *
 * The bytes go to the program and nothing is placed in the context window. A picture is described
 * rather than shown.
 *
 * The window is honoured under every read policy; a read that names no `limit` gets a capped
 * policy's default, or runs to the end of the file.
 *
 * @ggop files.read_file
 * @param path The file to read, relative to the workspace or absolute.
 * @param offset The 1-based line to start at. Left out, the read starts at the first line.
 * @param limit How many lines to return from `offset`. Left out, a capped read policy's default
 *   applies, or the read runs to the end.
 * @return the file's text, or the picture's description
 * @throws ApiError `NOT_FOUND` for a missing path.
 */
public fun readFile(path: String, offset: Int? = null, limit: Int? = null): FileRead =
    Read.fileRead(
        ggCall("files.read_file", ggText(path), ggNumber(offset), ggNumber(limit)),
    )

/**
 * Write text to a file, creating parent directories and replacing whatever was there.
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
 * Each entry carries a bare [DirEntry.name], with no directory part, and its [DirEntry.kind]. An
 * empty directory is an empty list rather than a failure.
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
 * Render the tree beneath a directory, skipping everything the ignore files exclude.
 *
 * One block of text: the root itself unnamed, each level indented two further spaces than its
 * parent, every level in path order, and directories suffixed `/`. A root with nothing beneath it
 * renders as `(empty directory)`.
 *
 * `depth` counts levels of children below the root, so `1` is the root's own entries. A directory
 * sitting at the bound is suffixed with how many entries it holds that were not walked, as
 * `assets/ (12 entries not shown)`.
 *
 * What `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude is never
 * walked and never rendered, nested ignore files and negations included, and `.git` itself is
 * skipped. No repository is needed for that to hold. Dotfiles are otherwise rendered like any other
 * entry, and symbolic links are not followed.
 *
 * The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut by
 * either ends with a line saying so.
 *
 * @ggop files.tree
 * @param path The directory to walk, relative to the workspace or absolute. Left out, the workspace
 *   root is walked.
 * @param depth How many levels of children below the root to render: 2 when left out, 10 at most —
 *   a larger request is answered at 10 — and zero is refused.
 * @return the rendered tree
 * @throws ApiError `NOT_FOUND` for a `path` that is not there, and `INVALID_ARGUMENT` for a `path`
 *   that is not a directory or a `depth` of zero.
 */
public fun tree(path: String? = null, depth: Int? = null): String {
    if (depth != null && depth < 1) {
        throw ApiError(
            "tree",
            gg.core.ApiErrorCode.INVALID_ARGUMENT,
            "depth must be at least 1 ($depth given); leave it out for gg's default",
        )
    }
    return ggCall("files.tree", ggText(path), ggNumber(depth)).text()
}

/**
 * Search the workspace's files for a pattern, and hand back every line that matched it.
 *
 * A `grep` over the workspace. The query is a regular expression in Rust syntax — `"foo|bar"`,
 * `"fn\\s+update"`, `"(?i)todo"` for a case-insensitive match — matched against each line on its
 * own. Each [SearchMatch] carries the file's path, the 1-based line number and the line itself, in
 * path order and then line order.
 *
 * The search honours ignore files: what `.gitignore`, `.ignore`, `.git/info/exclude` and the global
 * ignore file exclude is never scanned and never returned, nested ignore files and negations
 * included, and `.git` itself is skipped. No repository is needed for that to hold, and dotfiles are
 * searched like any other. A file that is not text — one carrying a NUL byte — is skipped, and a
 * matching line longer than 200 characters is cut there and annotated in place as
 * `foo (123 more chars...)`.
 *
 * A list exactly `limit` long may have been cut. There is no offset.
 *
 * @ggop files.search
 * @param query The regular expression to look for, in Rust syntax, matched line by line.
 * @param path The directory or file to search, relative to the workspace or absolute. A file
 *   searches that file alone. Left out, the workspace root is searched, and ignore files are
 *   honoured from the root down wherever the search is rooted.
 * @param limit How many matches to hand back at most: 50 when left out, 200 at most — a larger
 *   request is answered with the first 200 — and zero is refused.
 * @return every matching line, each with its path and 1-based line number
 * @throws ApiError `INVALID_ARGUMENT` for a query that is blank or not a valid pattern, or for a
 *   `limit` of zero, and `NOT_FOUND` for a `path` that is not there.
 */
public fun search(query: String, path: String? = null, limit: Int? = null): List<SearchMatch> {
    if (limit != null && limit < 1) {
        throw ApiError(
            "search",
            gg.core.ApiErrorCode.INVALID_ARGUMENT,
            "limit must be at least 1 ($limit given); leave it out for gg's default",
        )
    }
    return Read.searchMatches(ggCall("files.search", ggText(query), ggText(path), ggNumber(limit)))
}

/**
 * What a file read handed back: a text file's window, or a picture's description.
 *
 * Sealed over [TextFile] and [ImageFile]. Image bytes never enter the program; gg attaches the
 * picture to the turn.
 */
public sealed interface FileRead

/**
 * A text file's window, as the text arm of a read carries it.
 *
 * @property contents The file's text, or just the requested window where the read named one.
 * @property firstLine The 1-based first line returned.
 * @property lastLine The 1-based last line returned.
 * @property totalLines The file's total line count.
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
 * @property name The entry's bare name, with no directory part.
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

/**
 * One line a search matched.
 *
 * @property path The file's path with `/` separators, relative to the workspace root or absolute for
 *   a search rooted outside it.
 * @property line The 1-based line number of the match within that file.
 * @property text The matching line without its line ending, cut at 200 characters and annotated
 *   `(N more chars...)` where longer.
 */
public data class SearchMatch(val path: String, val line: Int, val text: String)

