/// read, write, and edit workspace files
///
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is doing the right thing, while one that
/// rewrites forty large files in a single turn will exhaust its fuel budget.
///
/// Nothing here puts anything in your context window. `view.openFile` is the call that shows a file
/// to *you*.
public enum fs: ApiObject {
    public static let ggObject = "fs"

    /// The gg tools this object dispatches, which is its share of what the artifact answers
    /// `bound-tools` with. Declared beside the functions that call them, so a tool added here is a
    /// tool the artifact reports.
    static let ggTools = ["read_file", "write_file", "edit_file", "list_dir"]

    /// Read a file, handing back a `.text` or an `.image` — the format is detected from the file's
    /// bytes, never its extension.
    ///
    /// This gets bytes for your PROGRAM and puts NOTHING in your context window; `view.openFile` is
    /// the call that shows the file to you. A relative path resolves against your workspace; an
    /// absolute one is read as given, so anything in this container — an offloaded command's output
    /// under `/tmp/gg-shell`, say — is readable.
    ///
    /// Reading an IMAGE describes it to your program — label, media type, byte size — and does not
    /// show it to YOU: the pixels reach neither your program nor your context window, so a file you
    /// only `fs.readFile` is a file you have not looked at. `view.openFile` is the one way to
    /// actually see a picture.
    ///
    /// Narrow the two cases with an ordinary `switch`, which needs no `default` because the enum is
    /// closed:
    ///
    /// ```swift
    /// switch try fs.readFile("logo.png") {
    /// case .text(let file): try view.openText("logo", body: file.contents)
    /// case .image(let picture): try view.openText("logo", body: picture.label)
    /// }
    /// ```
    ///
    /// - Parameters:
    ///   - path: The file to read. Relative to your workspace, or absolute for anything else in this
    ///     container.
    ///   - offset: The 1-based line to start at. Leave it out to start at the first line.
    ///   - limit: How many lines to return from `offset`. Leave it out to read to the end.
    /// - Returns: the file's text window, or the picture's description.
    /// - Throws: `ToolError` with `.notFound` for a missing path.
    public static func readFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil
    ) throws -> FileRead {
        try withScratch { scratch in
            var path = scratch.string(path)
            var ret = test_cabinet_gg_files_file_read_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                test_cabinet_gg_files_read_file(&path, offset, limit, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let read = FileRead(wire: ret)
            test_cabinet_gg_files_file_read_free(&ret)
            return read
        }
    }

    /// Read a text file and hand back its contents directly — `fs.readFile` without the narrowing,
    /// for the common case.
    ///
    /// It takes the same window. Reading is the cheap direction of this sandbox, so a program that
    /// reads a dozen files to decide what to change is doing the right thing.
    ///
    /// - Parameters:
    ///   - path: The file to read. Relative to your workspace, or absolute.
    ///   - offset: The 1-based line to start at. Leave it out to start at the first line.
    ///   - limit: How many lines to return from `offset`. Leave it out to read to the end.
    /// - Returns: the file's text.
    /// - Throws: `ToolError` with `.invalidArgument` when the path names a picture; use `fs.readFile`
    ///   to inspect those, and `view.openFile` to look at one.
    public static func readTextFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil
    ) throws -> String {
        try withScratch { scratch in
            var path = scratch.string(path)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                test_cabinet_gg_helpers_read_text_file(&path, offset, limit, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let contents = lift(ret)
            sandbox_string_free(&ret)
            return contents
        }
    }

    /// Write UTF-8 text to a file, creating parent directories and replacing any existing file, and
    /// hand back the number of bytes written.
    ///
    /// Writing is the expensive direction of the sandbox — rewriting more than a few dozen large
    /// files in one program exhausts its fuel budget, so split a large rewrite across several turns.
    ///
    /// - Parameters:
    ///   - path: Where to write. Relative to your workspace, or absolute. Parent directories are
    ///     created for you.
    ///   - contents: The UTF-8 text to write. It replaces the file entirely.
    /// - Returns: how many bytes were written.
    @discardableResult
    public static func writeFile(_ path: String, contents: String) throws -> Int {
        try withScratch { scratch in
            var path = scratch.string(path)
            var contents = scratch.string(contents)
            var ret: UInt64 = 0
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_files_write_file(&path, &contents, &ret, &err) else {
                throw lift(failure: &err)
            }
            return Int(ret)
        }
    }

    /// Replace the one exact occurrence of `oldString` in a file with `newString`.
    ///
    /// Widen the surrounding context until the match is unique rather than counting occurrences.
    ///
    /// - Parameters:
    ///   - path: The file to edit.
    ///   - replacing: The exact text to find, including its whitespace. It must appear exactly
    ///     once.
    ///   - with: The text to put in its place. An empty string deletes the match.
    /// - Throws: `ToolError` with `.notFound` when the text does not appear, and `.conflict` — with
    ///   the number of matches — when it appears more than once.
    public static func editFile(
        _ path: String, replacing oldString: String, with newString: String
    ) throws {
        try withScratch { scratch in
            var path = scratch.string(path)
            var oldString = scratch.string(oldString)
            var newString = scratch.string(newString)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_files_edit_file(&path, &oldString, &newString, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// List a directory, sorted by name; leaving the path out lists your workspace root.
    ///
    /// Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
    /// empty directory is an empty array, not a failure.
    ///
    /// - Parameter path: The directory to list, relative to your workspace or absolute. Leave it out
    ///   to list your workspace root.
    /// - Returns: the directory's entries, sorted by name.
    public static func listDir(_ path: String? = nil) throws -> [DirEntry] {
        try withScratch { scratch in
            var ret = test_cabinet_gg_files_list_dir_entry_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withOptional(path.map { scratch.string($0) }) { path in
                test_cabinet_gg_files_list_dir(path, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let entries = lift(ret.ptr, ret.len) { DirEntry(wire: $0) }
            test_cabinet_gg_files_list_dir_entry_free(&ret)
            return entries
        }
    }
}

/// The `offset`/`limit` pair the three reads share, as the two nullable pointers the ABI takes.
///
/// Not model-facing: a program writes `offset:`/`limit:` and never sees this.
@inline(__always)
func withWindow<R>(
    _ offset: Int?, _ limit: Int?,
    _ body: (UnsafeMutablePointer<UInt32>?, UnsafeMutablePointer<UInt32>?) throws -> R
) rethrows -> R {
    try withOptional(offset.map { UInt32(truncatingIfNeeded: $0) }) { offset in
        try withOptional(limit.map { UInt32(truncatingIfNeeded: $0) }) { limit in
            try body(offset, limit)
        }
    }
}
