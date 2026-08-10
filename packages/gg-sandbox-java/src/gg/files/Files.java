package gg.files;

import gg.FunctionSummary;
import gg.ToolError;
import gg.ToolErrorCode;
import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import java.util.Optional;
import org.teavm.jso.JSObject;

/**
 * Read, write, edit and list the files of the workspace.
 *
 * <p>Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
 * that reads a dozen files to decide what to change is well shaped, while one that rewrites forty
 * large files in a single turn will exhaust its fuel budget.
 *
 * <p>Nothing here places anything in the context window. {@code Views.openFile} is the call that
 * does.
 *
 * @ggmodule files
 */
public final class Files {
    private Files() {
    }

    /**
     * List the functions this module offers, each with a one-line summary.
     *
     * <p>Only the functions this run actually bound are returned, so the directory never names a
     * call a program cannot make. One function's full signature, argument descriptions and types
     * are opened as a view with {@code Views.openDocsView}.
     *
     * @return the functions this module really bound, each with its one-line summary
     * @ggmeta list
     */
    public static List<FunctionSummary> list() {
        return Read.functionSummaries(
                Wire.call("list", Wire.fs(), "fs", "list", Wire.args()));
    }

    /**
     * Read a file, as either a {@code Files.TextFile} or a {@code Files.ImageFile}.
     *
     * <p>Which of the two comes back is detected from the file's bytes, never from its extension, so
     * a mislabelled picture is still a picture. The two arms are a sealed interface, so a
     * {@code switch} over them needs no {@code default}:
     *
     * <pre>{@code
     * switch (Files.readFile("logo.png")) {
     *     case Files.TextFile text -> Views.openText("logo", text.contents());
     *     case Files.ImageFile picture -> Views.openText("logo", picture.label());
     * }
     * }</pre>
     *
     * <p>A relative path resolves against the workspace; an absolute one is read as given, so
     * anything else in this container is readable. Reading an image describes it — label, media
     * type, byte size — and shows nothing: the pixels reach neither the program nor the context
     * window.
     *
     * @param path The file to read, relative to the workspace or absolute.
     * @return the file's text, or the picture's description
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for a missing path.
     * @ggop files.read_file
     */
    public static FileRead readFile(String path) {
        return Read.fileRead(Wire.call("read_file", Wire.fs(), "fs", "readFile",
                Wire.args(Wire.text(path))));
    }

    /**
     * Read a window of lines from a file rather than the whole of it.
     *
     * <p>The window is honoured only under a capped read policy; where it is not, the whole file
     * comes back and {@code totalLines} says how much of it the read returned.
     *
     * @param path The file to read, relative to the workspace or absolute.
     * @param offset The 1-based first line to read from.
     * @param limit How many lines to read from {@code offset}.
     * @return the window of the file's text, or the picture's description
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for a missing path.
     * @ggop files.read_file
     */
    public static FileRead readFile(String path, int offset, int limit) {
        return Read.fileRead(Wire.call("read_file", Wire.fs(), "fs", "readFile",
                Wire.args(Wire.text(path), window(offset, limit))));
    }

    /**
     * Read a text file and hand back its contents directly.
     *
     * <p>{@link #readFile(String)} without the narrowing, for the common case: the same read, the
     * same window, the same cost.
     *
     * @param path The file to read, relative to the workspace or absolute.
     * @return the file's text
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when the path names a picture, which
     *     {@link #readFile(String)} inspects instead.
     * @ggop files.read_text_file
     */
    public static String readTextFile(String path) {
        return Wire.asString(Wire.call("read_file", Wire.fs(), "fs", "readTextFile",
                Wire.args(Wire.text(path))));
    }

    /**
     * Read a window of lines of a text file, handing back just those lines.
     *
     * @param path The file to read, relative to the workspace or absolute.
     * @param offset The 1-based first line to read from.
     * @param limit How many lines to read from {@code offset}.
     * @return the window of the file's text
     * @throws ToolError {@link ToolErrorCode#INVALID_ARGUMENT} when the path names a picture.
     * @ggop files.read_text_file
     */
    public static String readTextFile(String path, int offset, int limit) {
        return Wire.asString(Wire.call("read_file", Wire.fs(), "fs", "readTextFile",
                Wire.args(Wire.text(path), window(offset, limit))));
    }

    /**
     * Write UTF-8 text to a file, creating parent directories and replacing what is there.
     *
     * <p>Writing is the expensive direction of this sandbox: rewriting more than a few dozen large
     * files in one program exhausts its fuel budget, so a large rewrite is best split across several
     * turns.
     *
     * @param path Where to write, relative to the workspace or absolute. Parent directories are
     *     created as needed.
     * @param contents The UTF-8 text to write. It replaces the file entirely.
     * @return how many bytes were written
     * @ggop files.write_file
     */
    public static int writeFile(String path, String contents) {
        return Wire.asInteger(Wire.call("write_file", Wire.fs(), "fs", "writeFile",
                Wire.args(Wire.text(path), Wire.text(contents))));
    }

    /**
     * Replace the one exact occurrence of some text in a file with something else.
     *
     * <p>Widening the surrounding context until the match is unique is the way to disambiguate;
     * counting occurrences is not.
     *
     * @param path The file to edit.
     * @param oldString The exact text to find, whitespace included. It must appear once.
     * @param newString The text to put in its place. An empty string deletes the match.
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} when the text does not appear, and
     *     {@link ToolErrorCode#CONFLICT} — with the number of matches — when it appears more than
     *     once.
     * @ggop files.edit_file
     */
    public static void editFile(String path, String oldString, String newString) {
        Wire.run("edit_file", Wire.fs(), "fs", "editFile",
                Wire.args(Wire.text(path), Wire.text(oldString), Wire.text(newString)));
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
        return Read.dirEntries(
                Wire.call("list_dir", Wire.fs(), "fs", "listDir", Wire.args()));
    }

    /**
     * List one directory, sorted by name.
     *
     * @param path The directory to list, relative to the workspace or absolute.
     * @return every entry in that directory
     * @throws ToolError {@link ToolErrorCode#NOT_FOUND} for a directory that is not there.
     * @ggop files.list_dir
     */
    public static List<DirEntry> listDir(String path) {
        return Read.dirEntries(Wire.call("list_dir", Wire.fs(), "fs", "listDir",
                Wire.args(Wire.text(path))));
    }

    /** The window of lines a read covers, as the guest's own function takes it. */
    private static JSObject window(int offset, int limit) {
        JSObject options = Wire.object();
        Wire.set(options, "offset", Wire.number(offset));
        Wire.set(options, "limit", Wire.number(limit));
        return options;
    }

    // -------------------------------------------------------------------------------------------
    // The types a read hands back
    // -------------------------------------------------------------------------------------------

    /**
     * What a read returned — either a {@code Files.TextFile} or a {@code Files.ImageFile}.
     *
     * <p>A picture is a different kind of thing from text, so it is a different arm rather than a
     * string that happens to be binary: a program that treated an image as text is caught by the
     * compiler rather than silently writing an empty string somewhere. Being sealed is what lets a
     * {@code switch} over the two need no {@code default}.
     */
    public sealed interface FileRead permits TextFile, ImageFile {
    }

    /**
     * A file that turned out to be text, and the window of it the read policy returned.
     *
     * @param contents The file's text, or the requested window of it under a capped read policy.
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
}
