package gg;

/**
 * One function in an API object's directory, as {@code list} returns it.
 *
 * <p>The summary is one line; the whole documentation of a function — every shape it may be called
 * in, what to put in each argument, and the types it refers to — is a view, opened with
 * {@code view.openDocsView}.
 *
 * @param name The function name on its object — {@code readFile} in {@code fs.readFile}.
 * @param summary One line saying what it does: the first sentence of its documentation.
 */
public record FunctionSummary(String name, String summary) {
}
