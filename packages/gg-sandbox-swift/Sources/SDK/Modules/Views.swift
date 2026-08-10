/// Show a file, a computed value, or a function's documentation.
///
/// A view is the only way material enters the agent's context window.
///
/// Under responses as code a whole program's output would otherwise collapse into one anonymous
/// blob of logs, charged to one band, attributable to nothing and closable by nothing. A view
/// restores what tool calling gave for free: one message per view, carrying the band it is charged
/// to and the selector it can be closed by.
///
/// A program's own output is unreadable by the model that wrote it, and a view is the only way a
/// value it computed reaches that model. `print` and `gg.log` both reach the run instead.
///
/// - ggmodule: views
public enum views: ModuleDirectory {
    /// The gg module this namespace is, which is what its directory is looked up by.
    public static let ggModule = "gg.views"

    /// Read a file and place it in the context window, attributed to its path and closable by it.
    ///
    /// What comes back is exactly what `files.readFile` returns; the difference is the view. That
    /// split is the point: reading gets bytes for the program, opening shows the file to the agent,
    /// so a program that reads forty files to grep them puts nothing in the window. `offset` and
    /// `limit` select a window of lines, and two pages of one file are two views that coexist;
    /// re-opening the same page replaces what it showed rather than piling up a duplicate. An image
    /// is shown as a picture, and this is the only call that shows one.
    ///
    /// - Parameters:
    ///   - path: The file to open, relative to the workspace or absolute.
    ///   - offset: The 1-based line to start at. Left out, the whole file is shown.
    ///   - limit: How many lines to show from `offset`. Left out, the view runs to the end.
    /// - Returns: exactly what `files.readFile` returns for the same file.
    /// - Throws: `core.ToolError` with `.notFound` for a missing path, and `.invalidArgument` for an
    ///   offset past the end of the file. The read is what fails; nothing is opened when it does.
    /// - ggop: views.open_file
    @discardableResult
    public static func openFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil
    ) throws -> files.FileRead {
        try withScratch { scratch in
            var path = scratch.string(path)
            var ret = test_cabinet_gg_files_file_read_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                test_cabinet_gg_views_open_file_view(&path, offset, limit, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let read = files.FileRead(wire: ret)
            test_cabinet_gg_files_file_read_free(&ret)
            return read
        }
    }

    /// Place a value the program computed into the context window, under `label`.
    ///
    /// A directory listing, a command's output, a child agent's answer, a table the program
    /// assembled. This is how the result of a program reaches the model that wrote it, and the only
    /// way it does. Opening the same label again replaces what it showed, so a program may refine a
    /// view in a loop without piling up a copy per iteration.
    ///
    /// - Parameters:
    ///   - label: What to file the view under. `views.close` takes it, and opening the same label
    ///     again replaces what it showed. It may not be empty.
    ///   - body: What to show. An empty body is allowed: it is how a program says that something it
    ///     was showing is now empty.
    /// - Throws: `core.ToolError` with `.invalidArgument` for an empty label — a view with no
    ///   selector could never be closed or attributed — and `.limitExceeded`, naming the cap, for a
    ///   body or label over gg's caps. Nothing is ever silently truncated.
    /// - ggop: views.open_text
    public static func openText(_ label: String, body: String) throws {
        try withScratch { scratch in
            var label = scratch.string(label)
            var body = scratch.string(body)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_views_open_text_view(&label, &body, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Place one function's full documentation into the context window.
    ///
    /// Its signature, its description, and the declarations of any types it refers to that have not
    /// already been shown this session. This is how a function is read. It is a view, not a return
    /// value — the documentation arrives in the next prompt under a `Documentation` heading keyed by
    /// the function name, exactly as a file or a computed value arrives — so it is not available in
    /// the turn it is asked for. Ask in one turn, use it in the next. Opening the same function's
    /// documentation again replaces the view rather than adding a second copy, and `views.close`
    /// closes it.
    ///
    /// - Parameter name: The function to document, by the name it is called by in its module —
    ///   `"readFile"` for `files.readFile`. Each module's `list()` is what says which names exist.
    /// - Throws: `core.ToolError` with `.notFound` for an unknown or unbound name.
    /// - ggop: views.open_docs_view
    public static func openDocsView(_ name: String) throws {
        try withScratch { scratch in
            var name = scratch.string(name)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_views_open_docs_view(&name, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Close every view carrying `selector`, freeing the tokens they occupied.
    ///
    /// For a file that is every page of that path, for a text view the one with that label, for a
    /// documentation view the function's name. Closing a selector that is not open hands back `0`
    /// rather than failing, so a program that tidies up unconditionally need not guard every call.
    /// Closing a file view forgets what was read, not what exists; closing a text view discards the
    /// only copy of what it held, so anything needed later belongs in a file or a memory first.
    ///
    /// - Parameter selector: What the view is filed under: a file's path, a text view's label, or a
    ///   documentation view's function name.
    /// - Returns: how many views were closed.
    /// - ggop: views.close
    @discardableResult
    public static func close(_ selector: String) throws -> Int {
        try withScratch { scratch in
            var selector = scratch.string(selector)
            var ret: UInt32 = 0
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_views_close_view(&selector, &ret, &err) else {
                throw lift(failure: &err)
            }
            return Int(ret)
        }
    }

    /// List what is open in the context window right now.
    ///
    /// Each view's `kind`, the `selector` that closes it, roughly what it costs in `tokens`, and —
    /// for a paged file view — the `region` it covers. Reading it is what decides what to close when
    /// the window is filling up.
    ///
    /// - Returns: every open view, in no particular order.
    /// - ggop: views.current
    public static func current() -> [OpenView] {
        var ret = test_cabinet_gg_views_list_open_view_t()
        test_cabinet_gg_views_current_views(&ret)
        let views = lift(ret.ptr, ret.len) { OpenView(wire: $0) }
        test_cabinet_gg_views_list_open_view_free(&ret)
        return views
    }

    /// Which of the three kinds a view is.
    public enum ViewKind: Sendable {
        /// A file that was opened; its selector is the path.
        case file
        /// A computed value; its selector is the label it was given.
        case text
        /// A function's documentation; its selector is the function's name.
        case docs

        init(wire: test_cabinet_gg_views_view_kind_t) {
            switch Int32(wire) {
            case TEST_CABINET_GG_VIEWS_VIEW_KIND_FILE: self = .file
            case TEST_CABINET_GG_VIEWS_VIEW_KIND_TEXT: self = .text
            default: self = .docs
            }
        }
    }

    /// The window of lines a paged file view covers.
    public struct ViewRegion: Sendable {
        /// The 1-based first line the view shows.
        public let offset: Int
        /// How many lines it shows.
        public let limit: Int

        init(wire: test_cabinet_gg_views_view_region_t) {
            offset = Int(wire.offset)
            limit = Int(wire.limit)
        }
    }

    /// One view open in the context window, as `views.current` reports it.
    public struct OpenView: Sendable {
        /// Whether it is a file, text, or documentation view.
        public let kind: ViewKind
        /// What `views.close` takes: a file's path, a text view's label, or a documentation view's
        /// function name.
        public let selector: String
        /// Roughly what holding it costs, in tokens.
        public let tokens: Int
        /// The line window a paged file view covers; `nil` for a whole-file view and for text views.
        public let region: ViewRegion?

        init(wire: test_cabinet_gg_views_open_view_t) {
            kind = ViewKind(wire: wire.kind)
            selector = lift(wire.selector)
            tokens = Int(wire.tokens)
            region = wire.region.is_some ? ViewRegion(wire: wire.region.val) : nil
        }
    }
}

extension views.OpenView {
    /// Close this view, with its selector already supplied.
    ///
    /// `views.close` for the common case where the open view is in hand. Every view under the same
    /// selector closes, which for a paged file is every page of that path.
    ///
    /// - Returns: how many views were closed.
    /// - ggop-alias: views.close
    @discardableResult
    public func close() throws -> Int {
        try views.close(selector)
    }
}
