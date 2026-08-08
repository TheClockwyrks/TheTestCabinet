/// show yourself a file, a value, or a function's documentation — the only way material enters your
/// context
///
/// Under responses as code a whole program's output would otherwise collapse into one anonymous blob
/// of logs, charged to one band, attributable to nothing and closable by nothing. A view restores
/// what tool calling gave for free: one message per view, carrying the band it is charged to and the
/// selector it can be closed by.
///
/// So `gg.log` reaches the run's **operator**, and a view reaches **you**. `print` is the standard
/// library's and goes where `gg.log` goes — neither of them reaches your next prompt.
public enum view: ApiObject {
    public static let ggObject = "view"

    /// Read a file AND show it to yourself: you get back exactly what `fs.readFile` returns, and the
    /// file also becomes its own item in your context window, attributed to its path and closable by
    /// it.
    ///
    /// The split from `fs.readFile` is the point — `fs.readFile` gets bytes for your PROGRAM,
    /// `view.openFile` shows a file to YOU — so a program that reads forty files to grep them still
    /// puts nothing in your window. `offset` and `limit` select a window of lines, and two pages of
    /// one file are two views that coexist; re-opening the SAME page replaces what it showed rather
    /// than piling up a duplicate. An image file is shown to you as a picture, and is the ONLY way to
    /// look at one — `fs.readFile` of an image describes it without showing it.
    ///
    /// Pictures are the one thing this call can refuse. Only so many image-carrying views may be open
    /// at once (your agent's `imageViewCap`); nothing is opened and nothing is shown when you pass
    /// that cap, so close one with `view.close` and try again. Re-opening a picture you already have
    /// open replaces it rather than adding one, and is never refused. Text views are never refused by
    /// this cap.
    ///
    /// - Parameters:
    ///   - path: The file to open. Relative to your workspace, or absolute.
    ///   - offset: The 1-based line to start at. Leave it out to show the whole file.
    ///   - limit: How many lines to show from `offset`. Leave it out to show to the end.
    /// - Returns: exactly what `fs.readFile` returns for the same file.
    /// - Throws: `ToolError` with `.limitExceeded`, naming the cap, when opening a picture would pass
    ///   your agent's image-view cap.
    @discardableResult
    public static func openFile(
        _ path: String, offset: Int? = nil, limit: Int? = nil
    ) throws -> FileRead {
        try withScratch { scratch in
            var path = scratch.string(path)
            var ret = test_cabinet_gg_files_file_read_t()
            var err = test_cabinet_gg_types_tool_error_t()
            let ok = withWindow(offset, limit) { offset, limit in
                test_cabinet_gg_views_open_file_view(&path, offset, limit, &ret, &err)
            }
            guard ok else { throw lift(failure: &err) }
            let read = FileRead(wire: ret)
            test_cabinet_gg_files_file_read_free(&ret)
            return read
        }
    }

    /// Show yourself a value your program computed, under `label` — a directory listing, a command's
    /// output, a child agent's answer, a table you assembled.
    ///
    /// This is the channel into your context: logs go to the run's operator, views come back to you
    /// on your next turn. Opening the same `label` again replaces what it showed, so a program may
    /// refine a view in a loop without piling up a copy per iteration.
    ///
    /// - Parameters:
    ///   - label: What to file the view under. It is what `view.close` takes, and opening the same
    ///     label again replaces what it showed. It may not be empty.
    ///   - body: What to show yourself. An empty body is allowed: it is how you say that something
    ///     you were showing is now empty.
    /// - Throws: `ToolError` with `.invalidArgument` for an empty label — a view with no selector
    ///   could never be closed or attributed — and `.limitExceeded`, naming the cap, for a body or
    ///   label over gg's caps; nothing is ever silently truncated.
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

    /// Show yourself the full documentation for one function: its signature, its description, and the
    /// declarations of any types it refers to that you have not already been shown this session.
    ///
    /// This is how you read what a function does. It is a **view**, not a return value — the
    /// documentation arrives in your next prompt under a `Documentation` heading keyed by the
    /// function name, exactly as a file or a computed value arrives — so it is not available in the
    /// turn you ask for it. Plan for that: ask in one turn, use it in the next. Opening the same
    /// function's docs again replaces the view rather than adding a second copy, and `view.close`
    /// closes it when you are done with it.
    ///
    /// - Parameter name: The function to document, by the name it is called on its object —
    ///   `"readFile"` for `fs.readFile`. Every object's `list()` is how you find out which names
    ///   exist.
    /// - Throws: `ToolError` with `.notFound` for an unknown or unbound name.
    public static func openDocsView(_ name: String) throws {
        try withScratch { scratch in
            var name = scratch.string(name)
            var err = test_cabinet_gg_types_tool_error_t()
            guard test_cabinet_gg_views_open_docs_view(&name, &err) else {
                throw lift(failure: &err)
            }
        }
    }

    /// Close every view carrying `selector` and hand back how many were closed, freeing the tokens
    /// they occupied.
    ///
    /// For a file that is every page of that path, for a text view the one with that label, for a
    /// documentation view the function's name. Closing a selector that is not open hands back `0`
    /// rather than failing, so a program that tidies up unconditionally does not have to guard every
    /// call. Closing a file view forgets what you read, not what exists; closing a text view discards
    /// the only copy of what it held, so write anything you will need later to a file or a memory
    /// first.
    ///
    /// - Parameter selector: What the view is filed under: a file's path, a text view's label, or a
    ///   documentation view's function name.
    /// - Returns: how many views were closed.
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

    /// List what is open in your context window right now: each view's `kind`, the `selector` that
    /// closes it, roughly what it costs you in `tokens`, and — for a paged file view — the `region`
    /// it covers.
    ///
    /// It is called `current` rather than `list` because every API object already carries a `list`
    /// that lists that object's own functions. Read it before deciding what to close when your window
    /// is filling up.
    ///
    /// - Returns: every view open in your window, in no particular order.
    public static func current() -> [OpenView] {
        var ret = test_cabinet_gg_views_list_open_view_t()
        test_cabinet_gg_views_current_views(&ret)
        let views = lift(ret.ptr, ret.len) { OpenView(wire: $0) }
        test_cabinet_gg_views_list_open_view_free(&ret)
        return views
    }
}
