/// Read, write, edit, list, walk and search the files of the workspace.
///
/// Nothing here places material in the context window.
///
/// - ggmodule: files
public enum files {
    /// The gg tools this module dispatches, which is its share of what the artifact answers
    /// `bound-operations` with. Declared beside the functions that call them, so a tool added here
    /// is a tool the artifact reports.
    static let ggOperations = [
        "read_file", "write_file", "edit_file", "list_dir", "tree", "search",
    ]

    /// Read a file, as either a `FileRead.text` or a `FileRead.image`.
    ///
    /// Which of the two comes back is detected from the file's bytes, never from the extension. The
    /// enum is closed, so a `switch` over it needs no `default`:
    ///
    /// ```swift
    /// switch try files.readFile("logo.png") {
    /// case .text(let file): print(file.contents)
    /// case .image(let picture): print(picture.label)
    /// }
    /// ```
    ///
    /// A relative path resolves against the workspace; an absolute one is read as given, so
    /// anything else in this container — an offloaded command's output under `/tmp/gg-shell`, say —
    /// is readable. The bytes go to the program and nothing is placed in the context window; a
    /// picture is described rather than shown.
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

    /// Write UTF-8 text to a file, creating parent directories and replacing what is there.
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

    /// Render the tree beneath a directory, skipping everything the ignore files exclude.
    ///
    /// One block of text: the root itself unnamed, each level indented two further spaces than its
    /// parent, every level in path order, and directories suffixed `/`. A root with nothing beneath
    /// it renders as `(empty directory)`.
    ///
    /// `depth` counts levels of children below the root, so `1` is the root's own entries. A
    /// directory sitting at the bound is suffixed with how many entries it holds that were not
    /// walked, as `assets/ (12 entries not shown)`.
    ///
    /// Whatever `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude —
    /// nested files and negations included — is never walked and never rendered, `.git` itself is
    /// skipped, dotfiles are rendered, symbolic links are not followed, and none of it needs a
    /// repository to be there.
    ///
    /// The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut
    /// by either ends with a line saying so.
    ///
    /// - Parameters:
    ///   - path: The directory to walk, relative to the workspace or absolute. Left out, the
    ///     workspace root is walked.
    ///   - depth: How many levels of children below the root to render: 2 when left out, 10 at most
    ///     — a larger request is answered at 10 — and anything below `1` is refused.
    /// - Returns: the rendered tree.
    /// - Throws: `core.ApiError` with `.notFound` for a path that is not there, and
    ///   `.invalidArgument` for a path that is not a directory or a depth below `1`.
    /// - ggop: files.tree
    public static func tree(path: String? = nil, depth: Int? = nil) throws -> String {
        if let depth, depth < 1 {
            throw core.ApiError(
                code: .invalidArgument, operation: "tree",
                message: "depth must be at least 1 (\(depth) given); leave it out for gg's default")
        }
        return try withScratch { scratch in
            var ret = sandbox_string_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withOptional(path.map { scratch.string($0) }) { path in
                withOptional(depth.map { UInt32(clamping: $0) }) { depth in
                    test_cabinet_gg_files_tree(path, depth, &ret, &err)
                }
            }
            guard ok else { throw lift(failure: &err) }
            let rendered = lift(ret)
            sandbox_string_free(&ret)
            return rendered
        }
    }

    /// Search the workspace's files for a regular expression, and hand back every line that matches.
    ///
    /// This is the sandbox's grep. `query` is a regular expression in Rust's syntax — `foo|bar`,
    /// `fn [a-z_]+`, `(?i)todo` for a case-insensitive match — matched against each line on its
    /// own. Every line it matches comes back as a `SearchMatch` carrying the file's path, the
    /// 1-based line number and the line itself, in path order and then line order.
    ///
    /// Whatever `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude —
    /// nested files and negations included — is never scanned, `.git` itself is skipped, dotfiles
    /// are searched, and none of it needs a repository to be there. A file carrying a NUL byte is
    /// skipped.
    ///
    /// A matching line longer than 200 characters is cut there and annotated in place as
    /// `foo (123 more chars...)`. There is no offset: an array exactly `limit` long may have been
    /// cut.
    ///
    /// - Parameters:
    ///   - query: The regular expression to match each line against, in Rust's syntax; `(?i)`
    ///     makes it case-insensitive.
    ///   - path: The directory or file to search, relative to the workspace or absolute. Left out,
    ///     the whole workspace is searched; a file searches that one file.
    ///   - limit: How many matches to return at most. Left out, it takes gg's default of 50; the
    ///     ceiling is 200, and a larger limit is clamped to it rather than refused.
    /// - Returns: every matching line up to the limit, in path order and then line order; nothing
    ///   matching is an empty array, not a failure.
    /// - Throws: `core.ApiError` with `.invalidArgument` for a blank query, one that is not a valid
    ///   pattern, or a limit of `0`, and `.notFound` for a path that is not there.
    /// - ggop: files.search
    public static func search(
        _ query: String, path: String? = nil, limit: Int? = nil
    ) throws -> [SearchMatch] {
        try withScratch { scratch in
            var query = scratch.string(query)
            var ret = test_cabinet_gg_files_list_search_match_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withOptional(path.map { scratch.string($0) }) { path in
                withOptional(limit.map { UInt32(truncatingIfNeeded: $0) }) { limit in
                    test_cabinet_gg_files_search(&query, path, limit, &ret, &err)
                }
            }
            guard ok else { throw lift(failure: &err) }
            let matches = lift(ret.ptr, ret.len) { SearchMatch(wire: $0) }
            test_cabinet_gg_files_list_search_match_free(&ret)
            return matches
        }
    }

    /// What a read returned: a text file's window, or a picture's description.
    ///
    /// Image bytes never enter the program; gg attaches the picture to the turn instead.
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
        /// The file's text, or just the requested window where the read named one.
        public let contents: String
        /// The 1-based first line returned.
        public let firstLine: Int
        /// The 1-based last line returned.
        public let lastLine: Int
        /// The file's total line count.
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

    /// One line `files.search` matched.
    public struct SearchMatch: Sendable {
        /// The file's path, relative to the workspace root, with `/` separators.
        ///
        /// Absolute for a search rooted outside the workspace.
        public let path: String
        /// The 1-based line number of the match within that file.
        public let line: Int
        /// The matching line, without its line ending.
        ///
        /// Longer than 200 characters, it is cut there and annotated in place as
        /// `foo (123 more chars...)`.
        public let text: String

        init(wire: test_cabinet_gg_files_search_match_t) {
            path = lift(wire.path)
            line = Int(wire.line)
            text = lift(wire.text)
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
