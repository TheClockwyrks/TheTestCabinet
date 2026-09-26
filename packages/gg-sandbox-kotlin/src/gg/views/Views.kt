/**
 * The only way material enters the context window.
 *
 * Each view is its own message, carrying the band it is charged to and the selector it is filed
 * under. Nothing a program prints is shown back.
 *
 * @ggmodule views
 */
package gg.views

import gg.core.ApiError
import gg.files.FileRead
import gg.internal.Read
import gg.internal.ggCall
import gg.internal.ggNumber
import gg.internal.ggRun
import gg.internal.ggText


/**
 * Read a file and show it: the read's own answer comes back, and the file becomes its own view.
 *
 * An image file is shown as a picture. Naming a window shows one page rather than the whole file.
 * Two pages of one file are two views that coexist; re-opening the same page replaces what it showed.
 *
 * A text view is capped at 65,536 bytes, and a file over it is refused rather than cut, the refusal
 * naming the size. Each line of the view longer than `maxLineChars` is cut there and annotated in
 * place as `foo (123 more chars...)`, and the cap is measured after the cut. Only the view is cut:
 * what this call returns, and the file itself, are untouched. A picture is not subject to the cap.
 *
 * @ggop views.open_file
 * @param path The file to open, relative to the workspace or absolute.
 * @param offset The 1-based line to start at. Left out, the whole file is shown.
 * @param limit How many lines to show from `offset`. Left out, the view runs to the end.
 * @param maxLineChars The width, in characters, past which each line of the view is cut, from 1 to
 *   65,536. Left out, lines arrive whole.
 * @return the file's text, or the picture's description
 * @throws ApiError `NOT_FOUND` for a missing path, `INVALID_ARGUMENT` for an offset past the end of
 *   the file or a `maxLineChars` outside 1 to 65,536, and `LIMIT_EXCEEDED`, naming the size, for a
 *   text view over 65,536 bytes. The read is what fails, and nothing is opened when it does.
 */
public fun openFile(
    path: String,
    offset: Int? = null,
    limit: Int? = null,
    maxLineChars: Int? = null,
): FileRead =
    Read.fileRead(
        ggCall("views.open_file", ggText(path), ggNumber(offset), ggNumber(limit), ggNumber(maxLineChars)),
    )

/**
 * Show a value the program computed, filed under `label`.
 *
 * Opening the same label again replaces what it showed.
 *
 * @ggop views.open_text
 * @param label What to file the view under: the view's selector, so opening the same label again
 *   replaces what it showed. It may not be empty.
 * @param body What to show. An empty body is allowed: it is how a program says that something it was
 *   showing is now empty.
 * @throws ApiError `INVALID_ARGUMENT` for an empty label, and `LIMIT_EXCEEDED`, naming the cap, for
 *   a body or label over gg's caps; nothing is ever silently truncated.
 */
public fun openText(label: String, body: String) {
    ggRun("views.open_text", ggText(label), ggText(body))
}

/**
 * Show the full documentation for one module, function or type: everything a search's brief left out.
 *
 * The name is the fully-qualified one this documentation is keyed by, such as `gg.views.openText`, or
 * for a module its own path, `gg.views`. What comes back is a view rather than a return value, so it
 * arrives in the next prompt under a `Documentation` heading and is not available in the turn it was
 * asked for. Opening a name that is already open does nothing.
 *
 * @ggop views.open_docs_view
 * @param name What to document, by the fully-qualified name it is keyed under.
 * @throws ApiError `NOT_FOUND` for an unknown or unbound name.
 */
public fun openDocsView(name: String) {
    ggRun("views.open_docs_view", ggText(name))
}

/**
 * Close every view carrying `selector`, freeing the tokens they occupied.
 *
 * For a file that is every page of that path, for a text view the one with that label, and for the
 * results of a search the label `search results`. Closing a selector that is not open hands back `0`
 * rather than failing. Closing a file view forgets what was read rather than what exists; closing a
 * text view discards the only copy of what it held.
 *
 * Documentation views are not reached from here.
 *
 * @ggop views.close
 * @param selector What the view is filed under: a file's path, a text view's label, or
 *   `search results`.
 * @return how many views were closed
 * @throws ApiError `INVALID_ARGUMENT` for an empty selector, and `UNAVAILABLE` when this run does
 *   not offer `agent-managed-context`.
 */
public fun close(selector: String): Int =
    ggCall("views.close", ggText(selector)).integer()
