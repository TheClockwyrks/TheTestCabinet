package gg;

/** What a directory entry is. */
public enum EntryKind {
    /** An ordinary file. */
    FILE,
    /** A directory, which you can list in turn. */
    DIRECTORY,
    /** Everything that is neither, a symlink among them. */
    OTHER
}
