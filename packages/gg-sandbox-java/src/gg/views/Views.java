package gg.views;

import gg.ToolError;
import gg.ToolErrorCode;
import gg.files.Files;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import java.util.Optional;
import org.teavm.jso.JSObject;

/**
 * Put a file, a computed value or a function's documentation into the context window.
 *
 * <p>A program's own output goes nowhere the model can read it. A view is how a program puts
 * something in front of the model that wrote it: one attributable item in the next prompt, closeable
 * once it has been read.
 *
 * <p>There are three kinds and the list is closed: a file, a computed string, and one function's
 * documentation. A picture is not a fourth kind — it is a file view of an image file, and the view
 * carries the picture.
 *
 * @ggmodule views
 */
public final class Views {
    private Views() {
    }

    /**
     * Read a file and show it in the context window, keyed by its path.
     *
     * <p>The split from {@code Files.readFile} is the point: that call gets bytes for the program
     * and this one puts the file in front of the model, so a program that reads forty files to grep
     * them costs nothing. An image file is shown as a picture, and this is the only way to look at
     * one.
     *
     * <p>Re-opening a file already open replaces what it showed rather than piling up a duplicate,
     * so a program may open the same file every turn without the window growing.
     *
     * @param path The file to open, relative to the workspace or absolute.
     * @return the file's text, or the picture's description
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for a missing path. The read is what fails,
     *     and nothing is opened when it does.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path) {
        return Read.fileRead(Wire.call("open_file", Wire.view(), "view", "openFile",
                Wire.args(Wire.text(path))));
    }

    /**
     * Show one page of a file rather than the whole of it.
     *
     * <p>Two pages of one file are two views that coexist; re-opening the same page replaces what it
     * showed rather than piling up a duplicate.
     *
     * @param path The file to open, relative to the workspace or absolute.
     * @param offset The 1-based first line to show.
     * @param limit How many lines to show from {@code offset}.
     * @return the window of the file's text, or the picture's description
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for a missing path, and
     *     {@link ToolErrorCode#INVALID_ARGUMENT} for an offset past the end of the file.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path, int offset, int limit) {
        JSObject options = Wire.object();
        Wire.set(options, "offset", Wire.number(offset));
        Wire.set(options, "limit", Wire.number(limit));
        return Read.fileRead(Wire.call("open_file", Wire.view(), "view", "openFile",
                Wire.args(Wire.text(path), options)));
    }

    /**
     * Show a value the program computed, under a label.
     *
     * <p>A directory listing, a command's output, a child agent's answer, a table the program
     * assembled. Opening the same label again replaces what it showed, so a program may refine one
     * view in a loop without piling up a copy per iteration.
     *
     * @param label What to file the view under. It is what {@link #close} takes, and opening the
     *     same label again replaces what it showed. It may not be empty.
     * @param body What to show. An empty body is allowed: it is how a program says that something it
     *     was showing is now empty.
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} for an empty label — a view with no
     *     selector could never be closed or attributed — and {@link ToolErrorCode#LIMIT_EXCEEDED},
     *     naming the cap, for a body or label over gg's caps. Nothing is silently truncated.
     * @ggop views.open_text
     */
    public static void openText(String label, String body) {
        Wire.run("open_text", Wire.view(), "view", "openText",
                Wire.args(Wire.text(label), Wire.text(body)));
    }

    /**
     * Show the full documentation for one function: its signature, its description, and its types.
     *
     * <p>This is how a function is read. It is a view rather than a return value — the documentation
     * arrives in the next prompt under a {@code Documentation} heading keyed by the name, exactly as
     * a file or a computed value arrives — so it is not available in the turn that asks for it. Ask
     * in one turn, use it in the next. Opening the same function's documentation again replaces the
     * view rather than adding a second copy, and {@link #close} closes it.
     *
     * @param name The function to document, by the fully-qualified name its documentation is
     *     keyed by — {@code "gg.files.Files.readFile"}. The bare name it is called by
     *     ({@code "readFile"}) also resolves and is a fallback rather than the form to reach for:
     *     two modules are free to declare a {@code close}, and only the qualified name says which
     *     one is meant. Searching the documentation is what says which names exist.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for an unknown or unbound name.
     * @ggop views.open_docs_view
     */
    public static void openDocsView(String name) {
        Wire.run("open_docs_view", Wire.view(), "view", "openDocsView",
                Wire.args(Wire.text(name)));
    }

    /**
     * Close every view carrying a selector, freeing the tokens they occupied.
     *
     * <p>For a file that is every page of that path, for a text view the one with that label, for a
     * documentation view the function's name. Closing a selector that is not open hands back
     * {@code 0} rather than failing, so a program that tidies up unconditionally needs no guard.
     * Closing a file view forgets what was read rather than what exists; closing a text view
     * discards the only copy of what it held.
     *
     * @param selector What the view is filed under: a file's path, a text view's label, or a
     *     documentation view's function name.
     * @return how many views were closed
     * @ggop views.close
     */
    public static int close(String selector) {
        return Wire.asInteger(Wire.call("close", Wire.view(), "view", "close",
                Wire.args(Wire.text(selector))));
    }

    /**
     * List what is open in the context window right now, with what each costs.
     *
     * <p>Each entry carries its kind, the selector that closes it, roughly what it costs in tokens,
     * and — for a paged file view — the region it covers. What it enumerates is the context window's
     * contents, not any module's functions.
     *
     * @return every view open in the context window
     * @ggop views.current
     */
    public static List<OpenView> current() {
        return Read.openViews(
                Wire.call("current", Wire.view(), "view", "current", Wire.args()));
    }

    // -------------------------------------------------------------------------------------------
    // The types a view hands back
    // -------------------------------------------------------------------------------------------

    /**
     * One view open in the context window, as the current set reports it.
     *
     * @param kind Whether it is a file, a text or a documentation view.
     * @param selector What {@link Views#close} takes: a file's path, a text view's label, or a
     *     documentation view's function name.
     * @param tokens Roughly what holding it costs, in tokens.
     * @param region The line window a paged file view covers; empty for a whole-file view and for
     *     every text view.
     */
    public record OpenView(ViewKind kind, String selector, int tokens,
            Optional<ViewRegion> region) {

        /**
         * Close this view, which is {@link Views#close} on its own selector.
         *
         * @return how many views were closed, which is one unless it had already gone
         * @ggalias views.close
         */
        public int close() {
            return Views.close(selector);
        }
    }

    /**
     * Which of the three kinds a view is.
     *
     * <p>The taxonomy is closed at three deliberately: everything on disk is a file, everything a
     * program can compute is a string, and documentation is neither — gg holds it.
     */
    public enum ViewKind {
        /** A file, whose selector is its path. */
        FILE,
        /** A computed value, whose selector is the label it was opened under. */
        TEXT,
        /** One function's documentation, whose selector is that function's name. */
        DOCS
    }

    /**
     * The window of lines a paged file view covers.
     *
     * @param offset The 1-based first line the view shows.
     * @param limit How many lines it shows.
     */
    public record ViewRegion(int offset, int limit) {
    }
}
