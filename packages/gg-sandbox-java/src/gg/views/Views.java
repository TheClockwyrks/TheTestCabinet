package gg.views;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.files.Files;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;
import java.util.Optional;

/**
 * Put a file, a computed value or an entry's documentation into the context window.
 *
 * <p>A program's own output goes nowhere the model can read it. A view is how a program puts
 * something in front of the model that wrote it: one attributable item in the next prompt, closeable
 * once it has been read.
 *
 * <p>There are three kinds and the list is closed: a file, a computed string, and one entry's
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
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a missing path. The read is what fails,
     *     and nothing is opened when it does.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path) {
        return Read.fileRead(Coding.call("views.open_file", Value.of(path), Value.none(),
                Value.none()));
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
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a missing path, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} for an offset past the end of the file.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path, int offset, int limit) {
        return Read.fileRead(Coding.call("views.open_file", Value.of(path), Value.of(offset),
                Value.of(limit)));
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
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an empty label — a view with no
     *     selector could never be closed or attributed — and {@link ApiErrorCode#LIMIT_EXCEEDED},
     *     naming the cap, for a body or label over gg's caps. Nothing is silently truncated.
     * @ggop views.open_text
     */
    public static void openText(String label, String body) {
        Coding.call("views.open_text", Value.of(label), Value.of(body));
    }

    /**
     * Show the full documentation for one entry: a module, a function or a type.
     *
     * <p>Whatever a search can return can be read this way. It is a view rather than a return
     * value — the documentation arrives in the next prompt under a {@code Documentation} heading
     * keyed by the name, exactly as a file or a computed value arrives — so it is not available in
     * the turn that asks for it. Ask in one turn, use it in the next. Opening an entry already open
     * does nothing at all, neither moving it nor sending it again, and {@code gg.docs.Docs.close}
     * closes it — not {@link #close}, which does not reach documentation.
     *
     * @param name The entry to document, by the fully-qualified name its documentation is keyed
     *     by — {@code "gg.files.Files.readFile"}, and a module by its own path
     *     ({@code "gg.files.Files"}). The bare name it is called by ({@code "readFile"}) also
     *     resolves and is a fallback rather than the form to reach for: two modules are free to
     *     declare a {@code close}, and only the qualified name says which one is meant. Searching
     *     the documentation is what says which names exist.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for an unknown or unbound name.
     * @ggop views.open_docs_view
     */
    public static void openDocsView(String name) {
        Coding.call("views.open_docs_view", Value.of(name));
    }

    /**
     * Close every view carrying a selector, freeing the tokens they occupied.
     *
     * <p>For a file that is every page of that path, for a text view the one with that label, for
     * the results of a search the label {@code search results}. Closing a selector that is not open
     * hands back {@code 0} rather than failing, so a program that tidies up unconditionally needs
     * no guard. Closing a file view forgets what was read rather than what exists; closing a text
     * view discards the only copy of what it held.
     *
     * <p>Documentation views are not reached from here: {@code gg.docs.Docs.close} is what takes
     * one away, and it is bought by a capability of its own, `docview-close`. A sweep that included them would
     * hand back {@code 0} for an agent that may not close one, which reads as a selector that named
     * nothing.
     *
     * <p>Closing a view is context management, bought — with {@link #current()} — by the
     * {@code agent-managed-context} capability: an agent whose run did not enable it is refused.
     *
     * @param selector What the view is filed under: a file's path, a text view's label, or
     *     {@code search results}.
     * @return how many views were closed
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an empty selector, which names
     *     nothing rather than everything — no call here closes the window wholesale — and
     *     {@link ApiErrorCode#UNAVAILABLE} for an agent whose run did not buy
     *     {@code agent-managed-context}.
     * @ggop views.close
     */
    public static int close(String selector) {
        return Coding.call("views.close", Value.of(selector)).integer();
    }

    /**
     * List what is open in the context window right now, with what each costs.
     *
     * <p>Each entry carries its kind, the selector that closes it, roughly what it costs in tokens,
     * and — for a paged file view — the region it covers. What it enumerates is the context window's
     * contents, not any module's functions.
     *
     * <p>Listing what is open is context management, bought with {@link #close(String)} by the
     * {@code agent-managed-context} capability: an agent whose run did not enable it is refused.
     *
     * @return every view open in the context window
     * @throws ApiError {@link ApiErrorCode#UNAVAILABLE} for an agent whose run did not buy
     *     {@code agent-managed-context}.
     * @ggop views.current
     */
    public static List<OpenView> current() {
        return Read.openViews(Coding.call("views.current"));
    }

    // -------------------------------------------------------------------------------------------
    // The types a view hands back
    // -------------------------------------------------------------------------------------------

    /**
     * One view open in the context window, as the current set reports it.
     *
     * @param kind Whether it is a file, a text or a documentation view.
     * @param selector What closes it: a path, a label or {@code search results} for
     *     {@link Views#close}; a docs view's key goes to {@code Docs.close}.
     * @param tokens Roughly what holding it costs, in tokens.
     * @param region The line window a paged file view covers; empty for a whole-file view and for
     *     every text view.
     */
    public record OpenView(ViewKind kind, String selector, int tokens,
            Optional<ViewRegion> region) {

        /**
         * Close this view, which is {@link Views#close} on its own selector.
         *
         * <p>A documentation view is the one this does not take away, because {@link Views#close}
         * does not reach that band: {@code gg.docs.Docs.close} is the call for one of those.
         *
         * @return how many views were closed, which is one unless it had already gone
         * @throws ApiError {@link ApiErrorCode#UNAVAILABLE} for an agent whose run did not buy
         *     {@code agent-managed-context}, which is what buys closing a view.
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
        /** One entry's documentation, whose selector is that entry's key. */
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
