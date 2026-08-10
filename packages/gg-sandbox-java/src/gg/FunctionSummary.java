package gg;

/**
 * One function in a module's directory: its name, and the line it is summarized by.
 *
 * <p>The whole documentation of a function — every shape it may be called in, what to put in each
 * argument, and the types it names — is a view rather than a value, opened with
 * {@code Views.openDocsView}.
 *
 * @param name The name a program calls it by, as it is written after the module.
 * @param summary The one line saying what it does.
 */
public record FunctionSummary(String name, String summary) {
}
