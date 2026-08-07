import org.teavm.jso.JSObject

/**
 * The `view` object: the only way material enters your own context window.
 *
 * Under responses as code a whole program's output would otherwise collapse into one anonymous blob of
 * logs, charged to one band, attributable to nothing and closable by nothing. A view restores what tool
 * calling gave for free: one message per view, carrying the band it is charged to and the selector it
 * can be closed by. So `println` reaches the run's **operator**, and a view reaches **you**.
 */
public class View internal constructor() : ApiObject("view") {
    override fun target(): JSObject? = viewObject()

    /**
     * Read a file AND show it to yourself: you get back exactly what `fs.readFile` returns, and the file
     * also becomes its own item in your context window, attributed to its path and closable by it.
     *
     * The split from `fs.readFile` is the point — `fs.readFile` gets bytes for your PROGRAM,
     * `view.openFile` shows a file to YOU — so a program that reads forty files to grep them still puts
     * nothing in your window. An image file is shown to you as a picture, and is the ONLY way to look at
     * one: `fs.readFile` of an image describes it without showing it.
     *
     * Name `offset` and `limit` to show yourself one page rather than the whole file. Two pages of one
     * file are two views that coexist; re-opening the SAME page replaces what it showed rather than
     * piling up a duplicate.
     *
     * Pictures are the one thing this call can refuse. Only so many image-carrying views may be open at
     * once (your agent's `imageViewCap`); nothing is opened and nothing is shown when you pass that cap,
     * so close one with `view.close` and try again. Re-opening a picture you already have open replaces
     * it rather than adding one, and is never refused. Text views are never refused by this cap.
     *
     * @param path The file to open. Relative to your workspace, or absolute.
     * @param offset The 1-based line to start at. Leave it out to show the whole file.
     * @param limit How many lines to show from `offset`. Leave it out to show to the end.
     * @return the file's text, or the picture's description
     * @throws ToolError `LIMIT_EXCEEDED`, naming the cap, when opening a picture would pass your agent's
     *   image-view cap.
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
        return Read.fileRead(ggCall("open_file", target(), owner, "openFile", args))
    }

    /**
     * Show yourself a value your program computed, under `label` — a directory listing, a command's
     * output, a child agent's answer, a table you assembled.
     *
     * This is the channel into your context: `println` goes to the run's operator, views come back to you
     * on your next turn. Opening the same `label` again replaces what it showed, so a program may refine
     * a view in a loop without piling up a copy per iteration.
     *
     * @param label What to file the view under. It is what `view.close` takes, and opening the same label
     *   again replaces what it showed. It may not be empty.
     * @param body What to show yourself. An empty body is allowed: it is how you say that something you
     *   were showing is now empty.
     * @throws ToolError `INVALID_ARGUMENT` for an empty label — a view with no selector could never be
     *   closed or attributed — and `LIMIT_EXCEEDED`, naming the cap, for a body or label over gg's caps;
     *   nothing is ever silently truncated.
     */
    public fun openText(label: String, body: String) {
        ggRun("open_text", target(), owner, "openText", ggArgs(ggText(label), ggText(body)))
    }

    /**
     * Show yourself the full documentation for one function: its signature, its description, and the
     * declarations of any types it refers to that you have not already been shown this session.
     *
     * This is how you read what a function does. It is a **view**, not a return value — the documentation
     * arrives in your next prompt under a `Documentation` heading keyed by the function name, exactly as
     * a file or a computed value arrives — so it is not available in the turn you ask for it. Plan for
     * that: ask in one turn, use it in the next. Opening the same function's docs again replaces the view
     * rather than adding a second copy, and `view.close` closes it when you are done with it.
     *
     * @param name The function to document, by the name it is called on its object — `"readFile"` for
     *   `fs.readFile`. Every object's `list` is how you find out which names exist.
     * @throws ToolError `NOT_FOUND` for an unknown or unbound name.
     */
    public fun openDocsView(name: String) {
        ggRun("open_docs_view", target(), owner, "openDocsView", ggArgs(ggText(name)))
    }

    /**
     * Close every view carrying `selector` and hand back how many were closed, freeing the tokens they
     * occupied.
     *
     * For a file that is every page of that path, for a text view the one with that label, for a
     * documentation view the function's name. Closing a selector that is not open hands back `0` rather
     * than failing, so a program that tidies up unconditionally does not have to guard every call.
     * Closing a file view forgets what you read, not what exists; closing a text view discards the only
     * copy of what it held, so write anything you will need later to a file or a memory first.
     *
     * @param selector What the view is filed under: a file's path, a text view's label, or a
     *   documentation view's function name.
     * @return how many views were closed
     */
    public fun close(selector: String): Int =
        ggAsInteger(ggCall("close", target(), owner, "close", ggArgs(ggText(selector))))

    /**
     * List what is open in your context window right now: each view's `kind`, the `selector` that closes
     * it, roughly what it costs you in `tokens`, and — for a paged file view — the `region` it covers.
     *
     * It is called `current` rather than `list` because every API object already carries a `list` that
     * lists that object's own functions. Read it before deciding what to close when your window is
     * filling up.
     *
     * @return every view open in your context window
     */
    public fun current(): List<OpenView> =
        Read.openViews(ggCall("current", target(), owner, "current", ggArgs()))
}
