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
 * <p>A view is one attributable item in the next prompt, closeable once it has been read.
 *
 * <p>There are three kinds and the list is closed: a file, a computed string, and one entry's
 * documentation. An image file opens as a file view that carries the picture.
 *
 * @ggmodule views
 */
public final class Views {
    private Views() {
    }

    /**
     * Read a file and show it in the context window, keyed by its path.
     *
     * <p>An image file is shown as a picture.
     *
     * <p>Re-opening a file already open replaces what it showed.
     *
     * <p>A text view is capped at 65,536 bytes; a file over it is refused rather than cut. A
     * picture is not subject to the cap.
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
     * assembled. Opening the same label again replaces what it showed.
     *
     * @param label What to file the view under: the view's selector. It may not be empty.
     * @param body What to show. An empty body is allowed: it is how a program says that something it
     *     was showing is now empty.
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an empty label, and
     *     {@link ApiErrorCode#LIMIT_EXCEEDED}, naming the cap, for a body or label over gg's caps.
     *     Nothing is silently truncated.
     * @ggop views.open_text
     */
    public static void openText(String label, String body) {
        Coding.call("views.open_text", Value.of(label), Value.of(body));
    }

    /**
     * Show the full documentation for one entry: a module, a function or a type.
     *
     * <p>The documentation arrives in the next prompt under a {@code Documentation} heading keyed
     * by the name, rather than in the turn that asks for it. Opening an entry already open does
     * nothing, neither moving it nor sending it again.
     *
     * @param name The entry to document, by the fully-qualified name its documentation is keyed
     *     by — {@code "gg.views.Views.openText"}, and a module by its own path
     *     ({@code "gg.views.Views"}). A bare name ({@code "openText"}) also resolves, and is
     *     ambiguous where two modules declare it.
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
     * hands back {@code 0} rather than failing. Closing a file view forgets what was read rather
     * than what exists; closing a text view discards the only copy of what it held.
     *
     * <p>Documentation views are not closed from here.
     *
     * @param selector What the view is filed under: a file's path, a text view's label, or
     *     {@code search results}.
     * @return how many views were closed
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an empty selector, and
     *     {@link ApiErrorCode#UNAVAILABLE} where this run did not enable
     *     {@code agent-managed-context}.
     * @ggop views.close
     */
    public static int close(String selector) {
        return Coding.call("views.close", Value.of(selector)).integer();
    }
}
