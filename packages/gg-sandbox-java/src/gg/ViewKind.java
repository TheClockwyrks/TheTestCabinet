package gg;

/**
 * Which of the three kinds a view is.
 *
 * <p>The taxonomy is closed at three on purpose: everything on disk is a file, everything a
 * program can compute is a string, and documentation is neither — gg holds it.
 */
public enum ViewKind {
    /** A file you opened; its selector is the path. */
    FILE,
    /**
     * A value you showed yourself; its selector is the label you gave it. A directory listing, a
     * command's output, a child agent's answer and a table you assembled are all this.
     */
    TEXT,
    /** A function's documentation; its selector is the function's name. */
    DOCS
}
