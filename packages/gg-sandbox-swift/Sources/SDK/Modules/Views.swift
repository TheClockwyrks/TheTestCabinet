/// Show a file, a computed value, or an entry's documentation.
///
/// A view is the only way material enters the context window: one message per view, carrying the
/// band it is charged to and the selector it is filed under. `print` and `gg.log` reach the run's
/// log instead, which is not readable back.
///
/// - ggmodule: views
public enum views {
    /// Read a file and place it in the context window, attributed to its path and filed under it.
    ///
    /// `offset` and `limit` select a window of lines. Two pages of one file are two views that
    /// coexist; re-opening the same page replaces what it showed. An image is shown as a picture.
    ///
    /// The view's text body is held to a 65,536-byte cap: a window that would carry more is
    /// refused, naming the size and the bound, and nothing is opened — never a truncation. Given
    /// `maxLineChars`, each line of the view longer than that many characters is cut there and
    /// annotated in place as `foo (123 more chars...)`, with the count of characters dropped; the
    /// cut is the view's alone — the returned value and the file are untouched — and the cap is
    /// measured after it. Left out, lines arrive whole.
    ///
    /// - Parameters:
    ///   - path: The file to open, relative to the workspace or absolute.
    ///   - offset: The 1-based line to start at. Left out, the whole file is shown.
    ///   - limit: How many lines to show from `offset`. Left out, the view runs to the end.
    ///   - maxLineChars: Cut each line of the view longer than this many characters, annotating it
    ///     in place as `foo (123 more chars...)`; `1...65536`. Left out, every line arrives whole.
    /// - Returns: the file's text window, or the picture's description.
    /// - Throws: `core.ApiError` with `.notFound` for a missing path, `.invalidArgument` for an
    ///   offset past the end of the file or a `maxLineChars` outside `1...65536`, and
    ///   `.limitExceeded` — naming the size and the bound — for a text body over 65,536 bytes after
    ///   the cut. Nothing is opened when the read fails.
    /// - ggop: views.open_file
    @discardableResult
    public static func openFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil, maxLineChars: Int? = nil
    ) throws -> files.FileRead {
        // Signed here and `u32` on the wire, so a negative cut would lower to an enormous one and be
        // answered rather than refused. Refused here instead, under gg's own name for the call,
        // before anything reaches dispatch — the same guard `files.tree`'s `depth` has.
        if let maxLineChars, !(1...65536).contains(maxLineChars) {
            throw core.ApiError(
                code: .invalidArgument, operation: "open_file",
                message:
                    "`maxLineChars` must be between 1 and 65536 (\(maxLineChars) given); omit it "
                    + "to leave lines whole")
        }
        return try withScratch { scratch in
            var path = scratch.string(path)
            var ret = test_cabinet_gg_files_file_read_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                withOptional(maxLineChars.map { UInt32(truncatingIfNeeded: $0) }) { maxLineChars in
                    test_cabinet_gg_views_open_file_view(
                        &path, offset, limit, maxLineChars, &ret, &err)
                }
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
    /// assembled. Opening the same label again replaces what it showed.
    ///
    /// - Parameters:
    ///   - label: What to file the view under. Opening the same label again replaces what it
    ///     showed. It may not be empty.
    ///   - body: What to show. An empty body is allowed.
    /// - Throws: `core.ApiError` with `.invalidArgument` for an empty label, and `.limitExceeded`,
    ///   naming the cap, for a body or label over gg's caps. Nothing is ever silently truncated.
    /// - ggop: views.open_text
    public static func openText(_ label: String, body: String) throws {
        try withScratch { scratch in
            var label = scratch.string(label)
            var body = scratch.string(body)
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_views_open_text_view(&label, &body, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Place one module's, function's or type's full documentation into the context window.
    ///
    /// Its signature, its description, and the declarations of any types it refers to that have not
    /// already been shown this session. The documentation arrives in the next prompt under a
    /// `Documentation` heading keyed by the entry's name, and is not available in the turn it is
    /// asked for. Opening an entry that is already open does nothing.
    ///
    /// - Parameter name: What to document, by the fully-qualified name its documentation is keyed
    ///   by — `"gg.views.openText"`, or a module's own path, `"gg.views"`. The bare name it is
    ///   called by in its module (`"openText"`) also resolves, and is ambiguous where two modules
    ///   declare the same name.
    /// - Throws: `core.ApiError` with `.notFound` for an unknown or unbound name.
    /// - ggop: views.open_docs_view
    public static func openDocsView(_ name: String) throws {
        try withScratch { scratch in
            var name = scratch.string(name)
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_views_open_docs_view(&name, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Close every view carrying `selector`, freeing the tokens they occupied.
    ///
    /// For a file that is every page of that path, for a text view the one with that label, and for
    /// the results of a search the label `search results`. Closing a selector that is not open hands
    /// back `0` rather than failing. Closing a file view forgets what was read, not what exists;
    /// closing a text view discards the only copy of what it held. Documentation views are not
    /// reached from here.
    ///
    /// - Parameter selector: What the view is filed under: a file's path, a text view's label, or
    ///   `search results`.
    /// - Returns: how many views were closed.
    /// - Throws: `core.ApiError` with `.invalidArgument` for an empty selector, which names nothing
    ///   rather than everything, and `.unavailable` when this run did not buy
    ///   `agent-managed-context`.
    /// - ggop: views.close
    @discardableResult
    public static func close(_ selector: String) throws -> Int {
        try withScratch { scratch in
            var selector = scratch.string(selector)
            var ret: UInt32 = 0
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_views_close_view(&selector, &ret, &err) else {
                throw lift(failure: &err)
            }
            return Int(ret)
        }
    }

}
