package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * The {@code fs} object: reading, writing, editing and listing files in the workspace.
 *
 * <p>Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
 * that reads a dozen files to decide what to change is doing the right thing, while one that
 * rewrites forty large files in a single turn will exhaust its fuel budget.
 */
public final class Fs extends ApiObject {
    Fs() {
        super("fs");
    }

    @Override
    JSObject target() {
        return Wire.fs();
    }

    /**
     * Read a file, handing back a {@link TextFile} or an {@link ImageFile} — the format is
     * detected from the file's bytes, never its extension.
     *
     * <p>This gets bytes for your PROGRAM and puts NOTHING in your context window;
     * {@code view.openFile} is the call that shows the file to you. A relative path resolves
     * against your workspace; an absolute one is read as given, so anything in this container — an
     * offloaded command's output under {@code /tmp/gg-shell}, say — is readable.
     *
     * <p>Reading an IMAGE describes it to your program — label, media type, byte size — and does
     * not show it to YOU: the pixels reach neither your program nor your context window, so a file
     * you only {@code fs.readFile} is a file you have not looked at. {@code view.openFile} is the
     * one way to actually see a picture.
     *
     * <p>Narrow the two arms with an ordinary {@code switch}, which needs no {@code default}
     * because {@link FileRead} is sealed:
     *
     * <pre>{@code
     * switch (fs.readFile("logo.png")) {
     *     case TextFile text -> view.openText("logo", text.contents());
     *     case ImageFile picture -> view.openText("logo", picture.label());
     * }
     * }</pre>
     *
     * @param path The file to read. Relative to your workspace, or absolute for anything else in
     *     this container.
     * @return the file's text, or the picture's description
     * @throws ToolError {@code NOT_FOUND} for a missing path.
     */
    public FileRead readFile(String path) {
        return Read.fileRead(Wire.call("read_file", target(), object(), "readFile",
                Wire.args(Wire.text(path))));
    }

    /**
     * Read a window of lines from a file, rather than the whole of it.
     *
     * <p>The window is honoured only under a capped read policy; where it is not, the whole file
     * comes back and {@code totalLines} says how much of it you were given.
     *
     * @param path The file to read. Relative to your workspace, or absolute for anything else in
     *     this container.
     * @param offset The 1-based line to start at.
     * @param limit How many lines to return from {@code offset}.
     * @return the window of the file's text, or the picture's description
     * @throws ToolError {@code NOT_FOUND} for a missing path.
     */
    public FileRead readFile(String path, int offset, int limit) {
        return Read.fileRead(Wire.call("read_file", target(), object(), "readFile",
                Wire.args(Wire.text(path), window(offset, limit))));
    }

    /**
     * Read a text file and hand back its contents directly — {@code fs.readFile} without the
     * narrowing, for the common case.
     *
     * @param path The file to read. Relative to your workspace, or absolute.
     * @return the file's text
     * @throws ToolError {@code INVALID_ARGUMENT} when the path names a picture; use
     *     {@code fs.readFile} to inspect those, and {@code view.openFile} to look at one.
     */
    public String readTextFile(String path) {
        return Wire.asString(Wire.call("read_file", target(), object(), "readTextFile",
                Wire.args(Wire.text(path))));
    }

    /**
     * Read a window of lines of a text file, handing back just those lines.
     *
     * @param path The file to read. Relative to your workspace, or absolute.
     * @param offset The 1-based line to start at.
     * @param limit How many lines to return from {@code offset}.
     * @return the window of the file's text
     * @throws ToolError {@code INVALID_ARGUMENT} when the path names a picture.
     */
    public String readTextFile(String path, int offset, int limit) {
        return Wire.asString(Wire.call("read_file", target(), object(), "readTextFile",
                Wire.args(Wire.text(path), window(offset, limit))));
    }

    /**
     * Write UTF-8 text to a file, creating parent directories and replacing any existing file, and
     * hand back the number of bytes written.
     *
     * <p>Writing is the expensive direction of the sandbox — rewriting more than a few dozen large
     * files in one program exhausts its fuel budget, so split a large rewrite across several
     * turns.
     *
     * @param path Where to write. Relative to your workspace, or absolute. Parent directories are
     *     created for you.
     * @param contents The UTF-8 text to write. It replaces the file entirely.
     * @return how many bytes were written
     */
    public int writeFile(String path, String contents) {
        return Wire.asInteger(Wire.call("write_file", target(), object(), "writeFile",
                Wire.args(Wire.text(path), Wire.text(contents))));
    }

    /**
     * Replace the one exact occurrence of {@code oldString} in a file with {@code newString}.
     *
     * <p>Widen the surrounding context until the match is unique rather than counting occurrences.
     *
     * @param path The file to edit.
     * @param oldString The exact text to find, including its whitespace. It must appear exactly
     *     once.
     * @param newString The text to put in its place. An empty string deletes the match.
     * @throws ToolError {@code NOT_FOUND} when the text does not appear, and {@code CONFLICT} —
     *     with the number of matches — when it appears more than once.
     */
    public void editFile(String path, String oldString, String newString) {
        Wire.run("edit_file", target(), object(), "editFile",
                Wire.args(Wire.text(path), Wire.text(oldString), Wire.text(newString)));
    }

    /**
     * List your workspace root, sorted by name.
     *
     * <p>Each entry carries a bare {@code name} — join it with the directory you listed — and its
     * {@code kind}. An empty directory is an empty list, not a failure.
     *
     * @return every entry in your workspace root
     */
    public List<DirEntry> listDir() {
        return Read.dirEntries(
                Wire.call("list_dir", target(), object(), "listDir", Wire.args()));
    }

    /**
     * List one directory, sorted by name.
     *
     * @param path The directory to list, relative to your workspace or absolute.
     * @return every entry in that directory
     * @throws ToolError {@code NOT_FOUND} for a directory that is not there.
     */
    public List<DirEntry> listDir(String path) {
        return Read.dirEntries(Wire.call("list_dir", target(), object(), "listDir",
                Wire.args(Wire.text(path))));
    }

    /** The window of lines a read covers, as the guest's own function takes it. */
    private static JSObject window(int offset, int limit) {
        JSObject options = Wire.object();
        Wire.set(options, "offset", Wire.number(offset));
        Wire.set(options, "limit", Wire.number(limit));
        return options;
    }
}
