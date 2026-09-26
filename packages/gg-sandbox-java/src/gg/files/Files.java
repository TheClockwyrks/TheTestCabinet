package gg.files;

import gg.ApiError;
import gg.ApiErrorCode;
import gg.internal.Coding;
import gg.internal.Read;
import gg.internal.Value;
import java.util.List;
import java.util.Optional;

/**
 * Read, write, edit, list and walk the files of the workspace.
 *
 * <p>Nothing here places anything in the context window: a read hands bytes to the program.
 *
 * @ggmodule files
 */
public final class Files {
    private Files() {
    }

    /**
     * Read a file, as either a {@code Files.TextFile} or a {@code Files.ImageFile}.
     *
     * <p>Which of the two comes back is detected from the file's bytes, never from its extension, so
     * a mislabelled picture is still a picture. The two arms are a sealed interface, so a
     * {@code switch} over them needs no {@code default}:
     *
     * <pre>{@code
     * String described = switch (Files.readFile("logo.png")) {
     *     case Files.TextFile text -> text.contents();
     *     case Files.ImageFile picture -> picture.label();
     * };
     * }</pre>
     *
     * <p>A relative path resolves against the workspace; an absolute one is read as given, so
     * anything else in this container is readable. Reading an image describes it — label, media
     * type, byte size — and shows nothing: the pixels reach neither the program nor the context
     * window.
     *
     * @param path The file to read, relative to the workspace or absolute.
     * @return the file's text, or the picture's description
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a missing path, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} for a path that is empty.
     * @ggop files.read_file
     */
    public static FileRead readFile(String path) {
        return Read.fileRead(Coding.call("files.read_file", Value.of(path), Value.none(),
                Value.none()));
    }

    /**
     * Read a window of lines from a file rather than the whole of it.
     *
     * <p>The window is honoured under every read policy, and {@code totalLines} says how much of the
     * file lies outside it.
     *
     * @param path The file to read, relative to the workspace or absolute.
     * @param offset The 1-based first line to read from.
     * @param limit How many lines to read from {@code offset}.
     * @return the window of the file's text, or the picture's description
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a missing path, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} for a path that is empty.
     * @ggop files.read_file
     */
    public static FileRead readFile(String path, int offset, int limit) {
        return Read.fileRead(Coding.call("files.read_file", Value.of(path), Value.of(offset),
                Value.of(limit)));
    }

    /**
     * Write UTF-8 text to a file, creating parent directories and replacing what is there.
     *
     * @param path Where to write, relative to the workspace or absolute. Parent directories are
     *     created as needed.
     * @param contents The UTF-8 text to write. It replaces the file entirely.
     * @return how many bytes were written
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for an empty path, and {@link
     *     ApiErrorCode#IO_ERROR} when creating the parent directories or the write itself failed.
     * @ggop files.write_file
     */
    public static int writeFile(String path, String contents) {
        return Coding.call("files.write_file", Value.of(path), Value.of(contents)).integer();
    }

    /**
     * Replace the one exact occurrence of some text in a file with something else.
     *
     * @param path The file to edit.
     * @param oldString The exact text to find, whitespace included. It must appear once.
     * @param newString The text to put in its place. An empty string deletes the match.
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} when the text does not appear, and
     *     {@link ApiErrorCode#CONFLICT} — with the number of matches — when it appears more than
     *     once.
     * @ggop files.edit_file
     */
    public static void editFile(String path, String oldString, String newString) {
        Coding.call("files.edit_file", Value.of(path), Value.of(oldString), Value.of(newString));
    }

    /**
     * List a directory, sorted by name; called with nothing, the workspace root.
     *
     * <p>Each entry carries a bare name — joined with the directory that was listed — and its kind.
     * An empty directory is an empty list rather than a failure.
     *
     * @return every entry in the workspace root
     * @ggop files.list_dir
     */
    public static List<DirEntry> listDir() {
        return Read.dirEntries(Coding.call("files.list_dir", Value.none()));
    }

    /**
     * List one directory, sorted by name.
     *
     * @param path The directory to list, relative to the workspace or absolute.
     * @return every entry in that directory
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a directory that is not there, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} for a path that is empty — the overload that takes
     *     none is what lists the workspace root.
     * @ggop files.list_dir
     */
    public static List<DirEntry> listDir(String path) {
        return Read.dirEntries(Coding.call("files.list_dir", Value.of(path)));
    }

    /**
     * Render the tree beneath the workspace root, skipping everything the ignore files exclude.
     *
     * <p>One block of text: the root itself unnamed, each level indented two further spaces than its
     * parent, every level in path order, and directories suffixed {@code /}. A root with nothing
     * beneath it renders as {@code (empty directory)}. This overload walks two levels of children.
     *
     * <p>What {@code .gitignore}, {@code .ignore}, {@code .git/info/exclude} and the global ignore
     * file exclude is never walked and never rendered, nested ignore files and negations included,
     * and {@code .git} itself is skipped. No repository is needed for that to hold. Dotfiles are
     * otherwise rendered like any other entry, and symbolic links are not followed.
     *
     * <p>The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut
     * by either ends with a line saying so.
     *
     * @return the rendered tree of the workspace root
     * @ggop files.tree
     */
    public static String tree() {
        return Coding.call("files.tree", Value.none(), Value.none()).text();
    }

    /**
     * Render the tree beneath one directory, two levels deep.
     *
     * @param path The directory to walk, relative to the workspace or absolute.
     * @return the rendered tree
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a path that is not there, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} for a path that is not a directory.
     * @ggop files.tree
     */
    public static String tree(String path) {
        return Coding.call("files.tree", Value.of(path), Value.none()).text();
    }

    /**
     * Render the tree beneath the workspace root, to a depth of the program's own.
     *
     * <p>{@code depth} counts levels of children below the root, so {@code 1} is the root's own
     * entries. A directory sitting at the bound is suffixed with how many entries it holds that
     * were not walked, as {@code assets/ (12 entries not shown)}.
     *
     * @param depth How many levels of children below the root to render: 10 at most — a larger
     *     request is answered at 10 — and anything below 1 is refused.
     * @return the rendered tree of the workspace root
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a depth below 1.
     * @ggop files.tree
     */
    public static String tree(int depth) {
        return tree(null, depth);
    }

    /**
     * Render the tree beneath one directory, to a depth of the program's own.
     *
     * <p>{@code depth} counts levels of children below the root, so {@code 1} is the root's own
     * entries. A directory sitting at the bound is suffixed with how many entries it holds that
     * were not walked, as {@code assets/ (12 entries not shown)}.
     *
     * @param path The directory to walk, relative to the workspace or absolute. {@code null} walks
     *     the workspace root.
     * @param depth How many levels of children below the root to render: 10 at most — a larger
     *     request is answered at 10 — and anything below 1 is refused.
     * @return the rendered tree
     * @throws ApiError {@link ApiErrorCode#NOT_FOUND} for a path that is not there, and
     *     {@link ApiErrorCode#INVALID_ARGUMENT} for a path that is not a directory or a depth below
     *     1.
     * @ggop files.tree
     */
    public static String tree(String path, int depth) {
        if (depth < 1) {
            throw new ApiError("tree", ApiErrorCode.INVALID_ARGUMENT,
                    "depth must be at least 1 (" + depth + " given); leave it out for gg's default");
        }
        return Coding.call("files.tree", Value.of(path), Value.of(depth)).text();
    }

    /**
     * Search the workspace's files for a pattern, and hand back every line that matched it.
     *
     * <p>A {@code grep} over the workspace. The query is a regular expression in Rust syntax —
     * {@code "foo|bar"}, {@code "fn\\s+update"}, {@code "(?i)todo"} for a case-insensitive
     * match — matched against each line on its own.
     *
     * <p>Each hit carries the file's path, the 1-based line number and the line itself, in path
     * order and then line order.
     *
     * <p>The search honours ignore files: what {@code .gitignore}, {@code .ignore},
     * {@code .git/info/exclude} and the global ignore file exclude is never scanned and never
     * returned, nested ignore files and negations included, and {@code .git} itself is skipped. No
     * repository is needed for that to hold, and dotfiles are searched like any other. A file that
     * is not text — one carrying a NUL byte — is skipped, and a matching line longer than 200
     * characters is cut there and annotated in place as {@code foo (123 more chars...)}.
     *
     * <p>This overload returns at most 50 matches; a list exactly that long may have been cut, and
     * there is no offset to page with.
     *
     * @param query The regular expression to look for, in Rust syntax, matched line by line.
     * @return every matching line, each with its path and 1-based line number
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a query that is blank or not a
     *     valid pattern.
     * @ggop files.search
     */
    public static List<SearchMatch> search(String query) {
        return Read.searchMatches(Coding.call("files.search", Value.of(query), Value.none(),
                Value.none()));
    }

    /**
     * Search one directory, or one file, rather than the whole workspace.
     *
     * <p>Ignore files are honoured from the workspace root down.
     *
     * @param query The regular expression to look for, in Rust syntax, matched line by line.
     * @param path The directory or file to search, relative to the workspace or absolute. A file
     *     searches that file alone; {@code null} searches the workspace root.
     * @return every matching line, each with its path and 1-based line number
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a query that is blank or not a
     *     valid pattern, and {@link ApiErrorCode#NOT_FOUND} for a path that is not there.
     * @ggop files.search
     */
    public static List<SearchMatch> search(String query, String path) {
        return Read.searchMatches(Coding.call("files.search", Value.of(query), Value.of(path),
                Value.none()));
    }

    /**
     * Search with a cap of the program's own on how many matches come back.
     *
     * @param query The regular expression to look for, in Rust syntax, matched line by line.
     * @param path The directory or file to search, relative to the workspace or absolute. A file
     *     searches that file alone; {@code null} searches the workspace root.
     * @param limit How many matches to hand back at most: 50 by default, 200 at most — a larger
     *     request is answered with the first 200 — and zero is refused. A list exactly this long
     *     may have been cut.
     * @return every matching line, each with its path and 1-based line number
     * @throws ApiError {@link ApiErrorCode#INVALID_ARGUMENT} for a query that is blank or not a
     *     valid pattern, or for a limit of zero, and {@link ApiErrorCode#NOT_FOUND} for a path
     *     that is not there.
     * @ggop files.search
     */
    public static List<SearchMatch> search(String query, String path, int limit) {
        if (limit < 1) {
            throw new ApiError("search", ApiErrorCode.INVALID_ARGUMENT,
                    "limit must be at least 1 (" + limit + " given); leave it out for gg's default");
        }
        return Read.searchMatches(Coding.call("files.search", Value.of(query), Value.of(path),
                Value.of(limit)));
    }

    // -------------------------------------------------------------------------------------------
    // The types a read hands back
    // -------------------------------------------------------------------------------------------

    /**
     * What a read returned — either a {@code Files.TextFile} or a {@code Files.ImageFile}.
     *
     * <p>Sealed, so a {@code switch} over the two arms needs no {@code default}.
     */
    public sealed interface FileRead permits TextFile, ImageFile {
    }

    /**
     * A file that turned out to be text, and the window of it the read policy returned.
     *
     * @param contents The file's text, or the requested window of it where the read named one.
     * @param firstLine The 1-based first line returned.
     * @param lastLine The 1-based last line returned.
     * @param totalLines The file's whole line count, which is what says whether to page again.
     * @param byteTruncated Whether a 256 KiB ceiling cut the returned text.
     */
    public record TextFile(String contents, int firstLine, int lastLine, int totalLines,
            boolean byteTruncated) implements FileRead {
    }

    /**
     * A file that turned out to be a picture, described rather than decoded.
     *
     * @param mediaType The IANA media type: {@code image/png}, {@code image/jpeg},
     *     {@code image/gif}, {@code image/webp}.
     * @param label The short format label: {@code PNG}, {@code JPEG}, {@code GIF}, {@code WebP}.
     * @param bytes The file's size in bytes.
     * @param shown Whether the picture is attached to this turn to be looked at.
     * @param notShownReason Why it is not attached; empty when it is.
     */
    public record ImageFile(String mediaType, String label, int bytes, boolean shown,
            Optional<String> notShownReason) implements FileRead {
    }

    /**
     * One entry a directory listing found.
     *
     * @param name The entry's bare name, with no directory part. It joins onto the directory that
     *     was listed.
     * @param kind What the entry turned out to be.
     */
    public record DirEntry(String name, EntryKind kind) {
    }

    /** What a directory entry turned out to be. */
    public enum EntryKind {
        /** An ordinary file. */
        FILE,
        /** A directory, which can be listed in turn. */
        DIRECTORY,
        /** Something else — a symlink, a socket, a device. */
        OTHER
    }

    /**
     * One line a search matched.
     *
     * @param path The file's path with {@code /} separators, relative to the workspace root or
     *     absolute for a search rooted outside it.
     * @param line The 1-based line number of the match within that file.
     * @param text The matching line without its line ending, cut at 200 characters and annotated
     *     {@code (N more chars...)} where longer.
     */
    public record SearchMatch(String path, int line, String text) {
    }
}
