/// Read, write, edit, list and search the files of the workspace.
///
/// Nothing here places anything in the agent's context window: showing something is what the
/// `gg.views` module is for.
///
/// - ggmodule: files
public enum files {
    /// The gg tools this module dispatches, which is its share of what the artifact answers
    /// `bound-operations` with. Declared beside the functions that call them, so a tool added here
    /// is a tool the artifact reports.
    static let ggOperations = ["read_file", "write_file", "edit_file", "list_dir", "search"]

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

    /// Search the workspace's files for a regular expression, and hand back every line that matches.
    ///
    /// `query` is a regular expression in Rust's syntax — `foo|bar`, `fn [a-z_]+`, `(?i)todo` for
    /// a case-insensitive match — matched against each line on its own, and every line it matches
    /// comes back as a `SearchMatch` carrying the file's path, the 1-based line number and the line
    /// itself, in path order and then line order. It is this sandbox's grep, and it honours ignore
    /// files: whatever `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file
    /// exclude — nested files and negations included — is never scanned and never returned, `.git`
    /// itself is skipped, dotfiles are searched, and none of it needs a repository to be there. A
    /// file that is not text (one carrying a NUL byte) is skipped too.
    ///
    /// A matching line longer than 200 characters is cut there and annotated in place as
    /// `foo (123 more chars...)`. The result is a value for the program and places nothing in the
    /// context window. An array exactly `limit` long may have been cut — there is no offset to page
    /// with, so narrowing the query or the path is what shows the rest: a search says where to
    /// point a read, and is not a way of reading a file.
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
        /// The file's text, or just the requested window where the read named one.
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
