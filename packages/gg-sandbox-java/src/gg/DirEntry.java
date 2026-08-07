package gg;

/**
 * One entry {@code fs.listDir} found.
 *
 * @param name The entry's bare name, with no directory part. Join it with the directory you
 *     listed.
 * @param kind What the entry is.
 */
public record DirEntry(String name, EntryKind kind) {
}
