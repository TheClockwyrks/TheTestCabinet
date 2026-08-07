import org.teavm.jso.JSObject
import org.teavm.jso.core.JSArray

/**
 * The `fs` object: reading, writing, editing and listing files in the workspace.
 *
 * Reading is the cheap direction of this sandbox and writing is the expensive one, so a program that
 * reads a dozen files to decide what to change is doing the right thing, while one that rewrites forty
 * large files in a single turn will exhaust its fuel budget.
 */
public class Fs internal constructor() : ApiObject("fs") {
    override fun target(): JSObject? = fsObject()

    /**
     * Read a file, handing back a [TextFile] or an [ImageFile] — the format is detected from the
     * file's bytes, never its extension.
     *
     * This gets bytes for your PROGRAM and puts NOTHING in your context window; `view.openFile` is the
     * call that shows the file to you. A relative path resolves against your workspace; an absolute one
     * is read as given, so anything in this container — an offloaded command's output under
     * `/tmp/gg-shell`, say — is readable.
     *
     * Reading an IMAGE describes it to your program — label, media type, byte size — and does not show
     * it to YOU: the pixels reach neither your program nor your context window, so a file you only
     * `fs.readFile` is a file you have not looked at. `view.openFile` is the one way to actually see a
     * picture.
     *
     * Name `offset` and `limit` to read a window of lines rather than the whole file; the window is
     * honoured only under a capped read policy, and where it is not, the whole file comes back and
     * `totalLines` says how much of it you were given.
     *
     * Narrow the two arms with `when`, which needs no `else` because [FileRead] is sealed:
     *
     * ```
     * when (val read = fs.readFile("logo.png")) {
     *     is TextFile -> view.openText("logo", read.contents)
     *     is ImageFile -> view.openText("logo", read.label)
     * }
     * ```
     *
     * @param path The file to read. Relative to your workspace, or absolute for anything else in this
     *   container.
     * @param offset The 1-based line to start at. Leave it out to read from the first line.
     * @param limit How many lines to return from `offset`. Leave it out to read to the end.
     * @return the file's text, or the picture's description
     * @throws ToolError `NOT_FOUND` for a missing path.
     */
    public fun readFile(path: String, offset: Int? = null, limit: Int? = null): FileRead =
        Read.fileRead(
            ggCall("read_file", target(), owner, "readFile", window(path, offset, limit)),
        )

    /**
     * Read a text file and hand back its contents directly — `fs.readFile` without the narrowing, for
     * the common case.
     *
     * @param path The file to read. Relative to your workspace, or absolute.
     * @param offset The 1-based line to start at. Leave it out to read from the first line.
     * @param limit How many lines to return from `offset`. Leave it out to read to the end.
     * @return the file's text
     * @throws ToolError `INVALID_ARGUMENT` when the path names a picture; use `fs.readFile` to inspect
     *   those, and `view.openFile` to look at one.
     */
    public fun readTextFile(path: String, offset: Int? = null, limit: Int? = null): String =
        ggAsString(
            ggCall("read_file", target(), owner, "readTextFile", window(path, offset, limit)),
        )

    /**
     * Write UTF-8 text to a file, creating parent directories and replacing any existing file, and hand
     * back the number of bytes written.
     *
     * Writing is the expensive direction of the sandbox — rewriting more than a few dozen large files
     * in one program exhausts its fuel budget, so split a large rewrite across several turns.
     *
     * @param path Where to write. Relative to your workspace, or absolute. Parent directories are
     *   created for you.
     * @param contents The UTF-8 text to write. It replaces the file entirely.
     * @return how many bytes were written
     */
    public fun writeFile(path: String, contents: String): Int =
        ggAsInteger(
            ggCall(
                "write_file",
                target(),
                owner,
                "writeFile",
                ggArgs(ggText(path), ggText(contents)),
            ),
        )

    /**
     * Replace the one exact occurrence of `oldString` in a file with `newString`.
     *
     * Widen the surrounding context until the match is unique rather than counting occurrences.
     *
     * @param path The file to edit.
     * @param oldString The exact text to find, including its whitespace. It must appear exactly once.
     * @param newString The text to put in its place. An empty string deletes the match.
     * @throws ToolError `NOT_FOUND` when the text does not appear, and `CONFLICT` — with the number of
     *   matches — when it appears more than once.
     */
    public fun editFile(path: String, oldString: String, newString: String) {
        ggRun(
            "edit_file",
            target(),
            owner,
            "editFile",
            ggArgs(ggText(path), ggText(oldString), ggText(newString)),
        )
    }

    /**
     * List a directory, sorted by name.
     *
     * Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
     * empty directory is an empty list, not a failure.
     *
     * @param path The directory to list, relative to your workspace or absolute. Leave it out to list
     *   your workspace root.
     * @return every entry in that directory
     * @throws ToolError `NOT_FOUND` for a directory that is not there.
     */
    public fun listDir(path: String? = null): List<DirEntry> =
        Read.dirEntries(
            ggCall(
                "list_dir",
                target(),
                owner,
                "listDir",
                if (path == null) ggArgs() else ggArgs(ggText(path)),
            ),
        )

    /** A path, and the window of lines a read covers, as the guest's own function takes them. */
    private fun window(path: String, offset: Int?, limit: Int?): JSArray<JSObject> {
        if (offset == null && limit == null) {
            return ggArgs(ggText(path))
        }
        val options = ggRecord()
        if (offset != null) {
            ggSet(options, "offset", ggNumber(offset))
        }
        if (limit != null) {
            ggSet(options, "limit", ggNumber(limit))
        }
        return ggArgs(ggText(path), options)
    }
}
