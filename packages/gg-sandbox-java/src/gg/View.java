package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The {@code view} object: the only way material enters your own context window.
 *
 * <p>Under responses as code a whole program's output would otherwise collapse into one anonymous
 * blob of logs, charged to one band, attributable to nothing and closable by nothing. A view
 * restores what tool calling gave for free: one message per view, carrying the band it is charged
 * to and the selector it can be closed by. So {@code System.out.println} reaches the run's
 * <b>operator</b>, and a view reaches <b>you</b>.
 */
public final class View extends ApiObject {
    View() {
        super("view");
    }

    @Override
    JSObject target() {
        return Wire.view();
    }

    /**
     * Read a file AND show it to yourself: you get back exactly what {@code fs.readFile} returns,
     * and the file also becomes its own item in your context window, attributed to its path and
     * closable by it.
     *
     * <p>The split from {@code fs.readFile} is the point — {@code fs.readFile} gets bytes for your
     * PROGRAM, {@code view.openFile} shows a file to YOU — so a program that reads forty files to
     * grep them still puts nothing in your window. An image file is shown to you as a picture, and
     * is the ONLY way to look at one: {@code fs.readFile} of an image describes it without showing
     * it.
     *
     * <p>Pictures are the one thing this call can refuse. Only so many image-carrying views may be
     * open at once (your agent's {@code imageViewCap}); nothing is opened and nothing is shown
     * when you pass that cap, so close one with {@code view.close} and try again. Re-opening a
     * picture you already have open replaces it rather than adding one, and is never refused. Text
     * views are never refused by this cap.
     *
     * @param path The file to open. Relative to your workspace, or absolute.
     * @return the file's text, or the picture's description
     * @throws ToolError {@code LIMIT_EXCEEDED}, naming the cap, when opening a picture would pass
     *     your agent's image-view cap.
     */
    public FileRead openFile(String path) {
        return Read.fileRead(Wire.call("open_file", target(), object(), "openFile",
                Wire.args(Wire.text(path))));
    }

    /**
     * Show yourself one page of a file rather than the whole of it.
     *
     * <p>Two pages of one file are two views that coexist; re-opening the SAME page replaces what
     * it showed rather than piling up a duplicate.
     *
     * @param path The file to open. Relative to your workspace, or absolute.
     * @param offset The 1-based line to start at.
     * @param limit How many lines to show from {@code offset}.
     * @return the window of the file's text, or the picture's description
     * @throws ToolError {@code LIMIT_EXCEEDED}, naming the cap, when opening a picture would pass
     *     your agent's image-view cap.
     */
    public FileRead openFile(String path, int offset, int limit) {
        JSObject options = Wire.object();
        Wire.set(options, "offset", Wire.number(offset));
        Wire.set(options, "limit", Wire.number(limit));
        return Read.fileRead(Wire.call("open_file", target(), object(), "openFile",
                Wire.args(Wire.text(path), options)));
    }

    /**
     * Show yourself a value your program computed, under {@code label} — a directory listing, a
     * command's output, a child agent's answer, a table you assembled.
     *
     * <p>This is the channel into your context: {@code System.out.println} goes to the run's
     * operator, views come back to you on your next turn. Opening the same {@code label} again
     * replaces what it showed, so a program may refine a view in a loop without piling up a copy
     * per iteration.
     *
     * @param label What to file the view under. It is what {@code view.close} takes, and opening
     *     the same label again replaces what it showed. It may not be empty.
     * @param body What to show yourself. An empty body is allowed: it is how you say that
     *     something you were showing is now empty.
     * @throws ToolError {@code INVALID_ARGUMENT} for an empty label — a view with no selector
     *     could never be closed or attributed — and {@code LIMIT_EXCEEDED}, naming the cap, for a
     *     body or label over gg's caps; nothing is ever silently truncated.
     */
    public void openText(String label, String body) {
        Wire.run("open_text", target(), object(), "openText",
                Wire.args(Wire.text(label), Wire.text(body)));
    }

    /**
     * Show yourself the full documentation for one function: its signature, its description, and
     * the declarations of any types it refers to that you have not already been shown this
     * session.
     *
     * <p>This is how you read what a function does. It is a <b>view</b>, not a return value — the
     * documentation arrives in your next prompt under a {@code Documentation} heading keyed by the
     * function name, exactly as a file or a computed value arrives — so it is not available in the
     * turn you ask for it. Plan for that: ask in one turn, use it in the next. Opening the same
     * function's docs again replaces the view rather than adding a second copy, and
     * {@code view.close} closes it when you are done with it.
     *
     * @param name The function to document, by the name it is called on its object —
     *     {@code "readFile"} for {@code fs.readFile}. Every object's {@code list} is how you find
     *     out which names exist.
     * @throws ToolError {@code NOT_FOUND} for an unknown or unbound name.
     */
    public void openDocsView(String name) {
        Wire.run("open_docs_view", target(), object(), "openDocsView",
                Wire.args(Wire.text(name)));
    }

    /**
     * Close every view carrying {@code selector} and hand back how many were closed, freeing the
     * tokens they occupied.
     *
     * <p>For a file that is every page of that path, for a text view the one with that label, for
     * a documentation view the function's name. Closing a selector that is not open hands back
     * {@code 0} rather than failing, so a program that tidies up unconditionally does not have to
     * guard every call. Closing a file view forgets what you read, not what exists; closing a text
     * view discards the only copy of what it held, so write anything you will need later to a file
     * or a memory first.
     *
     * @param selector What the view is filed under: a file's path, a text view's label, or a
     *     documentation view's function name.
     * @return how many views were closed
     */
    public int close(String selector) {
        return Wire.asInteger(Wire.call("close", target(), object(), "close",
                Wire.args(Wire.text(selector))));
    }

    /**
     * List what is open in your context window right now: each view's {@code kind}, the
     * {@code selector} that closes it, roughly what it costs you in {@code tokens}, and — for a
     * paged file view — the {@code region} it covers.
     *
     * <p>It is called {@code current} rather than {@code list} because every API object already
     * carries a {@code list} that lists that object's own functions. Read it before deciding what
     * to close when your window is filling up.
     *
     * @return every view open in your context window
     */
    public List<OpenView> current() {
        return Read.openViews(
                Wire.call("current", target(), object(), "current", Wire.args()));
    }
}
