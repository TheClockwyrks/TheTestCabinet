/**
 * The only way material enters the agent's own context window.
 *
 * Under responses as code a whole program's output would otherwise collapse into one anonymous blob
 * of logs, charged to one band, attributable to nothing and closable by nothing. A view restores what
 * tool calling gave for free: one message per view, carrying the band it is charged to and the
 * selector it can be closed by.
 *
 * So `println` reaches the run's operator and a view reaches the model, which is the whole reason a
 * program that computes something also has to show it.
 *
 * @ggmodule views
 */
package gg.views

import gg.core.ToolError
import gg.files.FileRead
import gg.internal.Read
import gg.internal.ggArgs
import gg.internal.ggAsInteger
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggRecord
import gg.internal.ggRun
import gg.internal.ggSet
import gg.internal.ggText
import gg.internal.viewObject


/**
 * Read a file and show it: the read's own answer comes back, and the file becomes its own view.
 *
 * The split from `gg.files.readFile` is the point — that call gets bytes for the program, this one
 * shows a file to the model — so a program that reads forty files to grep them still places nothing
 * in the window. An image file is shown as a picture, and this is the only way to look at one.
 *
 * Naming a window shows one page rather than the whole file. Two pages of one file are two views that
 * coexist; re-opening the same page replaces what it showed rather than piling up a duplicate.
 *
 * @ggop views.open_file
 * @param path The file to open, relative to the workspace or absolute.
 * @param offset The 1-based line to start at. Left out, the whole file is shown.
 * @param limit How many lines to show from `offset`. Left out, the view runs to the end.
 * @return the file's text, or the picture's description
 * @throws ToolError `NOT_FOUND` for a missing path, and `INVALID_ARGUMENT` for an offset past the
 *   end of the file. The read is what fails, and nothing is opened when it does.
 */
public fun openFile(path: String, offset: Int? = null, limit: Int? = null): FileRead {
    val args =
        if (offset == null && limit == null) {
            ggArgs(ggText(path))
        } else {
            val options = ggRecord()
            if (offset != null) {
                ggSet(options, "offset", ggNumber(offset))
            }
            if (limit != null) {
                ggSet(options, "limit", ggNumber(limit))
            }
            ggArgs(ggText(path), options)
        }
    return Read.fileRead(ggCall("open_file", viewObject(), "gg.views", "openFile", args))
}

/**
 * Show a value the program computed, filed under `label`.
 *
 * A directory listing, a command's output, a child agent's answer and a table the program assembled
 * are all this. Opening the same label again replaces what it showed, so a program may refine one
 * view in a loop without piling up a copy per iteration.
 *
 * @ggop views.open_text
 * @param label What to file the view under. Closing takes it, opening the same label again replaces
 *   what it showed, and it may not be empty.
 * @param body What to show. An empty body is allowed: it is how a program says that something it was
 *   showing is now empty.
 * @throws ToolError `INVALID_ARGUMENT` for an empty label, and `LIMIT_EXCEEDED`, naming the cap, for
 *   a body or label over gg's caps; nothing is ever silently truncated.
 */
public fun openText(label: String, body: String) {
    ggRun("open_text", viewObject(), "gg.views", "openText", ggArgs(ggText(label), ggText(body)))
}

/**
 * Show the full documentation for one function: its signature, its description, and the types it
 * names.
 *
 * The name is the fully-qualified one this documentation is keyed by, such as `gg.files.readFile`.
 * What comes back is a view rather than a return value, so it arrives in the next prompt under a
 * `Documentation` heading and is not available in the turn it was asked for. Opening the same name
 * again replaces the view rather than adding a second copy.
 *
 * @ggop views.open_docs_view
 * @param name The function to document, by its fully-qualified name.
 * @throws ToolError `NOT_FOUND` for an unknown or unbound name.
 */
public fun openDocsView(name: String) {
    ggRun("open_docs_view", viewObject(), "gg.views", "openDocsView", ggArgs(ggText(name)))
}

/**
 * Close every view carrying `selector`, freeing the tokens they occupied.
 *
 * For a file that is every page of that path, for a text view the one with that label, and for the
 * results of a search the label `search results`. Closing a selector that is not open hands back `0`
 * rather than failing, so a program that tidies up unconditionally needs no guard. Closing a file
 * view forgets what was read rather than what exists; closing a text view discards the only copy of
 * what it held.
 *
 * Documentation views are not reached from here: `gg.docs.close` is what takes one away, and it is
 * bought by a capability this call is not. A sweep that included them would hand back `0` for an
 * agent that may not close one, which reads as a selector that named nothing.
 *
 * @ggop views.close
 * @param selector What the view is filed under: a file's path, a text view's label, or
 *   `search results`.
 * @return how many views were closed
 * @throws ToolError `INVALID_ARGUMENT` for an empty selector.
 */
public fun close(selector: String): Int =
    ggAsInteger(ggCall("close", viewObject(), "gg.views", "close", ggArgs(ggText(selector))))

/**
 * List what is open in the context window right now.
 *
 * Each view carries its [OpenView.kind], the [OpenView.selector] that closes it, roughly what it
 * costs in [OpenView.tokens], and — for a paged file view — the [OpenView.region] it covers. It is
 * what a program reads before deciding what to close when the window is filling up.
 *
 * @ggop views.current
 * @return every view open in the context window
 * @throws ToolError `UNAVAILABLE` when this run bound no view functions at all.
 */
public fun current(): List<OpenView> =
    Read.openViews(ggCall("current", viewObject(), "gg.views", "current", ggArgs()))

/**
 * One view open in the context window.
 *
 * @property kind Whether it is a file, text, or documentation view.
 * @property selector What closes it.
 *
 *   A path, a label or `search results` for `gg.views.close`, and for a documentation view the key
 *   `gg.docs.close` takes.
 * @property tokens Roughly what holding it costs, in tokens.
 * @property region The line window a paged file view covers; `null` for a whole-file view and for
 *   text views.
 */
public data class OpenView(
    val kind: ViewKind,
    val selector: String,
    val tokens: Int,
    val region: ViewRegion?,
) {
    /**
     * Close this view, with its selector already supplied.
     *
     * `gg.views.close` for the common case where the listed view is in hand, written as a member so
     * that the value carrying the selector is what the call hangs off.
     *
     * A documentation view is the one this does not take away, because `gg.views.close` does not
     * reach that band: `gg.docs.close(selector)` is the call for one of those.
     *
     * @ggalias views.close
     * @return how many views were closed, which is `0` when this one has already gone
     * @throws ToolError `INVALID_ARGUMENT` for an empty selector.
     */
    public fun close(): Int = gg.views.close(selector)
}

/**
 * Which of the three kinds a view is.
 *
 * The taxonomy is closed at three deliberately: everything on disk is a file, everything a program
 * can compute is a string, and documentation is neither, because gg holds it.
 */
public enum class ViewKind {
    /** A file that was opened; its selector is the path. */
    FILE,

    /** A value that was shown; its selector is the label it was given. */
    TEXT,

    /** A function's documentation; its selector is the function's name. */
    DOCS,
}

/**
 * The window of lines a paged file view covers.
 *
 * @property offset The 1-based first line the view shows.
 * @property limit How many lines it shows.
 */
public data class ViewRegion(val offset: Int, val limit: Int)
