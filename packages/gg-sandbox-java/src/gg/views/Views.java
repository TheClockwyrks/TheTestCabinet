package gg.views;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.files.Files;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;

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
     * <p>Unlike {@code Files.readFile}, which gets bytes for the program, this puts the file in
     * front of the model. An image file is shown as a picture, and this is the only way to look at
     * one.
     *
     * <p>Re-opening a file already open replaces what it showed, so a program may open the same
     * file every turn without the window growing.
     *
     * <p>A text view is capped at 65,536 bytes; a file over it is refused rather than cut, and the
     * way in is a page of it or cut lines. A picture is not subject to the cap.
     *
     * @param path The file to open, relative to the workspace or absolute.
     * @return the file's text, or the picture's description
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a missing path, and
     *     {@link ApiErrorCode#LIMIT_EXCEEDED}, naming the size, for a view over the cap. The read
     *     is what fails, and nothing is opened when it does.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path) {
        return Read.fileRead(Coding.call("views.open_file", Value.of(path), Value.none(),
                Value.none(), Value.none()));
    }

    /**
     * Show a whole file with its long lines cut.
     *
     * <p>Each line over {@code maxLineChars} characters is cut in the view and annotated as
     * {@code foo (123 more chars...)}; the cap is measured after the cut, and neither the return
     * value nor the file is cut.
     *
     * @param path The file to open, relative to the workspace or absolute.
     * @param maxLineChars The width, in characters, past which each line of the view is cut. From 1
     *     to 65,536.
     * @return the file's text, or the picture's description
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a width outside 1 to 65,536, and
     *     what the one-argument overload throws.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path, int maxLineChars) {
        return Read.fileRead(Coding.call("views.open_file", Value.of(path), Value.none(),
                Value.none(), Value.of(maxLineChars)));
    }

    /**
     * Show one page of a file rather than the whole of it.
     *
     * <p>Two pages of one file are two views that coexist; re-opening the same page replaces what it
     * showed.
     *
     * @param path The file to open, relative to the workspace or absolute.
     * @param offset The 1-based first line to show.
     * @param limit How many lines to show from {@code offset}.
     * @return the window of the file's text, or the picture's description
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an offset past the end of the
     *     file, and what the one-argument overload throws.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path, int offset, int limit) {
        return Read.fileRead(Coding.call("views.open_file", Value.of(path), Value.of(offset),
                Value.of(limit), Value.none()));
    }

    /**
     * Show one page of a file with its long lines cut.
     *
     * <p>The page {@code offset} and {@code limit} name, with each line over {@code maxLineChars}
     * cut as the two-argument overload cuts it.
     *
     * @param path The file to open, relative to the workspace or absolute.
     * @param offset The 1-based first line to show.
     * @param limit How many lines to show from {@code offset}.
     * @param maxLineChars The width, in characters, past which each line of the view is cut. From 1
     *     to 65,536.
     * @return the window of the file's text, or the picture's description
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an offset past the end of the
     *     file or a width outside 1 to 65,536, and what the one-argument overload throws.
     * @ggop views.open_file
     */
    public static Files.FileRead openFile(String path, int offset, int limit, int maxLineChars) {
        return Read.fileRead(Coding.call("views.open_file", Value.of(path), Value.of(offset),
                Value.of(limit), Value.of(maxLineChars)));
    }

    /**
     * Show a value the program computed, under a label.
     *
     * <p>A directory listing, a command's output, a child agent's answer, a table the program
     * assembled. Opening the same label again replaces what it showed, so a program may refine one
     * view in a loop without piling up a copy per iteration.
     *
     * @param label What to file the view under: the view's selector, so opening the same label
     *     again replaces what it showed. It may not be empty.
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
     * does nothing at all, neither moving it nor sending it again.
     *
     * @param name The entry to document, by the fully-qualified name its documentation is keyed
     *     by — {@code "gg.views.Views.openText"}, and a module by its own path
     *     ({@code "gg.views.Views"}). The bare name it is called by ({@code "openText"}) also
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
     * <p>Documentation views are not reached from here: taking one away is bought by a capability
     * of its own, and a sweep that included them would hand back {@code 0} for an agent that may
     * not close one, which reads as a selector that named nothing.
     *
     * <p>Closing a view is context management, bought by the
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
}
