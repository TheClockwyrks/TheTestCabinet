/// Read, write, edit and list the files of the workspace.
///
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is well shaped, while one that rewrites forty
/// large files in a single turn will exhaust its fuel budget.
///
/// Nothing here places anything in the agent's context window. `views.openFile` is the call that
/// does.
///
/// - ggmodule: files
public enum files {
    /// The gg tools this module dispatches, which is its share of what the artifact answers
    /// `bound-operations` with. Declared beside the functions that call them, so a tool added here
    /// is a tool the artifact reports.
    static let ggOperations = ["read_file", "write_file", "edit_file", "list_dir"]

    /// Read a file, as either a `FileRead.text` or a `FileRead.image`.
    ///
    /// Which of the two comes back is detected from the file's bytes, never from the extension, so
    /// a mislabelled picture is still a picture. The enum is closed, so an ordinary `switch` needs
    /// no `default`:
    ///
    /// ```swift
    /// switch try files.readFile("logo.png") {
    /// case .text(let file): try views.openText("logo", body: file.contents)
    /// case .image(let picture): try views.openText("logo", body: picture.label)
    /// }
    /// ```
    ///
    /// A relative path resolves against the workspace; an absolute one is read as given, so
    /// anything else in this container — an offloaded command's output under `/tmp/gg-shell`, say —
    /// is readable. This call hands bytes to the program and places nothing in the context window;
    /// reading a picture describes it and shows nothing, so a file only read here is a file nobody
    /// has looked at.
    ///
    /// - Parameters:
    ///   - path: The file to read, relative to the workspace or absolute.
    ///   - offset: The 1-based line to start at. Left out, the read starts at the first line.
    ///   - limit: How many lines to return from `offset`. Left out, the read runs to the end.
    /// - Returns: the file's text window, or the picture's description.
    /// - Throws: `core.ApiError` with `.notFound` for a missing path.
    /// - ggop: files.read_file
    public static func readFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil
    ) throws -> FileRead {
        try withScratch { scratch in
            var path = scratch.string(path)
            var ret = test_cabinet_gg_files_file_read_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                test_cabinet_gg_files_read_file(&path, offset, limit, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let read = FileRead(wire: ret)
            test_cabinet_gg_files_file_read_free(&ret)
            return read
        }
    }

    /// Read a text file and hand back its contents directly.
    ///
    /// `files.readFile` without the narrowing, for the common case: the same read, the same window,
    /// the same cost.
    ///
    /// - Parameters:
    ///   - path: The file to read, relative to the workspace or absolute.
    ///   - offset: The 1-based line to start at. Left out, the read starts at the first line.
    ///   - limit: How many lines to return from `offset`. Left out, the read runs to the end.
    /// - Returns: the file's text.
    /// - Throws: `core.ApiError` with `.invalidArgument` when the path names a picture, which
    ///   `files.readFile` inspects instead and `views.openFile` displays.
    /// - ggop: files.read_text_file
    public static func readTextFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil
    ) throws -> String {
        try withScratch { scratch in
            var path = scratch.string(path)
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                test_cabinet_gg_helpers_read_text_file(&path, offset, limit, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let contents = lift(ret)
            sandbox_string_free(&ret)
            return contents
        }
    }

    /// Write UTF-8 text to a file, creating parent directories and replacing what is there.
    ///
    /// Writing is the expensive direction of this sandbox: rewriting more than a few dozen large
    /// files in one program exhausts its fuel budget, so a large rewrite is best split across
    /// several turns.
    ///
    /// - Parameters:
    ///   - path: Where to write, relative to the workspace or absolute. Parent directories are
    ///     created.
    ///   - contents: The UTF-8 text to write. It replaces the file entirely.
    /// - Returns: how many bytes were written.
    /// - Throws: `core.ApiError` with `.invalidArgument` for an empty path, and `.ioError` when
    ///   creating the parent directories or the write itself failed.
    /// - ggop: files.write_file
    @discardableResult
    public static func writeFile(_ path: String, contents: String) throws -> Int {
        try withScratch { scratch in
            var path = scratch.string(path)
            var contents = scratch.string(contents)
            var ret: UInt64 = 0
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_files_write_file(&path, &contents, &ret, &err) else {
                throw lift(failure: &err)
            }
            return Int(ret)
        }
    }

    /// Replace the one exact occurrence of some text in a file with something else.
    ///
    /// Widening the surrounding context until the match is unique is the way to disambiguate;
    /// counting occurrences is not.
    ///
    /// - Parameters:
    ///   - path: The file to edit.
    ///   - replacing: The exact text to find, whitespace included. It must appear exactly once.
    ///   - with: The text to put in its place. An empty string deletes the match.
    /// - Throws: `core.ApiError` with `.notFound` when the text does not appear, and `.conflict` —
    ///   with the number of matches — when it appears more than once.
    /// - ggop: files.edit_file
    public static func editFile(
        _ path: String, replacing oldString: String, with newString: String
    ) throws {
        try withScratch { scratch in
            var path = scratch.string(path)
            var oldString = scratch.string(oldString)
            var newString = scratch.string(newString)
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_files_edit_file(&path, &oldString, &newString, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// List a directory, sorted by name; leaving the path out lists the workspace root.
    ///
    /// Each entry carries a bare `name` — join it with the directory that was listed — and its
    /// `kind`. An empty directory is an empty array, not a failure.
    ///
    /// - Parameter path: The directory to list, relative to the workspace or absolute. Left out, it
    ///   lists the workspace root.
    /// - Returns: the directory's entries, sorted by name.
    /// - Throws: `core.ApiError` with `.notFound` for a directory that is not there, and
    ///   `.invalidArgument` for a path that is given but empty.
    /// - ggop: files.list_dir
    public static func listDir(_ path: String? = nil) throws -> [DirEntry] {
        try withScratch { scratch in
            var ret = test_cabinet_gg_files_list_dir_entry_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withOptional(path.map { scratch.string($0) }) { path in
                test_cabinet_gg_files_list_dir(path, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let entries = lift(ret.ptr, ret.len) { DirEntry(wire: $0) }
            test_cabinet_gg_files_list_dir_entry_free(&ret)
            return entries
        }
    }

    /// What a read returned: a text file's window, or a picture's description.
    ///
    /// A picture is a different kind of thing from text, so it is a different case rather than a
    /// string that happens to be binary — a program that treats an image as text is caught by the
    /// `switch` instead of silently writing an empty string somewhere. Image bytes never enter the
    /// program: gg attaches the picture to the turn instead, which is worth far more than base64 in
    /// a variable.
    public enum FileRead: Sendable {
        /// This file is text.
        case text(TextFile)
        /// This file is a picture, which gg shows rather than handing over its bytes.
        case image(ImageFile)

        init(wire: test_cabinet_gg_files_file_read_t) {
            if Int32(wire.tag) == TEST_CABINET_GG_FILES_FILE_READ_IMAGE {
                self = .image(ImageFile(wire: wire.val.image))
            } else {
                self = .text(TextFile(wire: wire.val.text))
            }
        }
    }

    /// A text file's window, as the `FileRead.text` case carries it.
    public struct TextFile: Sendable {
        /// The file's text, or just the requested window under a capped read policy.
        public let contents: String
        /// The 1-based first line returned.
        public let firstLine: Int
        /// The 1-based last line returned.
        public let lastLine: Int
        /// The file's total line count, which says whether to page again.
        public let totalLines: Int
        /// Whether a 256 KiB byte ceiling cut the returned text.
        public let byteTruncated: Bool

        init(wire: test_cabinet_gg_files_text_read_t) {
            contents = lift(wire.contents)
            firstLine = Int(wire.first_line)
            lastLine = Int(wire.last_line)
            totalLines = Int(wire.total_lines)
            byteTruncated = wire.byte_truncated
        }
    }

    /// A picture's description, as the `FileRead.image` case carries it.
    public struct ImageFile: Sendable {
        /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
        public let mediaType: String
        /// The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
        public let label: String
        /// The file's size in bytes.
        public let bytes: Int
        /// Whether the picture is being attached to this turn to be looked at.
        public let shown: Bool
        /// Why it is not being shown; `nil` when it is.
        public let notShownReason: String?

        init(wire: test_cabinet_gg_files_image_read_t) {
            mediaType = lift(wire.media_type)
            label = lift(wire.label)
            bytes = Int(wire.bytes)
            shown = wire.shown
            notShownReason = lift(wire.not_shown_reason)
        }
    }

    /// One entry `files.listDir` found.
    public struct DirEntry: Sendable {
        /// The entry's bare name, with no directory part. Join it with the directory that was
        /// listed.
        public let name: String
        /// What the entry is.
        public let kind: EntryKind

        init(wire: test_cabinet_gg_files_dir_entry_t) {
            name = lift(wire.name)
            kind = EntryKind(wire: wire.kind)
        }
    }

    /// What a directory entry is.
    public enum EntryKind: Sendable {
        /// An ordinary file.
        case file
        /// A directory, which can be listed in turn.
        case directory
        /// Everything that is neither, a symlink among them.
        case other

        init(wire: test_cabinet_gg_files_entry_kind_t) {
            switch Int32(wire) {
            case TEST_CABINET_GG_FILES_ENTRY_KIND_FILE: self = .file
            case TEST_CABINET_GG_FILES_ENTRY_KIND_DIRECTORY: self = .directory
            default: self = .other
            }
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
