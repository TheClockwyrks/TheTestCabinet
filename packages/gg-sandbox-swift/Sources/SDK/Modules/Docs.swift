/// Find the modules, functions and types this run bound, and take their documentation back out of
/// context.
///
/// Discovery is two steps: `docs.search` answers with one-line briefs, each carrying the
/// fully-qualified name it is keyed by, and `views.openDocsView` reads one of those names in full.
/// Nothing else names a function — the system prompt lists the modules and stops there.
///
/// Searching is bound to every program whatever a run enables, because an agent that cannot find its
/// own surface does not have one. Closing is the exception and is bought by a capability: opening
/// documentation only ever adds to the end of the prompt, while closing it rewrites the middle.
///
/// - ggmodule: docs
public enum docs {
    /// Search the bound modules, functions and types by keyword, by module, or by both — best match
    /// first.
    ///
    /// Matching is case-insensitive substring over names, signatures, briefs and detailed
    /// descriptions, so `docs` finds `openDocsView` and `view` finds every call that mentions one.
    /// Ranking is by the kind of evidence that matched: an entry whose own name matched outranks one
    /// that merely mentions the word in a paragraph, however often it mentions it. Only what this run
    /// bound is ever returned, so nothing a search finds is something the program cannot call.
    ///
    /// The result is a value and a view. The value is readable in the turn that asked for it; the
    /// view puts the same page in the next prompt under the selector `search results`, replaced by
    /// the next search rather than accumulating. A hit carries a brief and no more — reading one in
    /// full is `views.openDocsView` on its `key`.
    ///
    /// Every argument has a default, so a call may be words alone, filters alone, or both. The one
    /// shape it refuses is the empty one: no query and no filter is a call that asked for nothing,
    /// which is a different answer from a call that matched nothing.
    ///
    /// - Parameters:
    ///   - query: The words to look for, matched as case-insensitive substrings. Several specific
    ///     words rank an entry above one vague word. Left out, the filters are the whole of the
    ///     search.
    ///   - modules: The modules to look in, each by gg's id (`files`) or by this arm's path
    ///     (`gg.files`). Exact and case-insensitive, because a module filter is a lookup rather
    ///     than a search, and several are a **union**: an entry in any one of them is a hit, and
    ///     modules with no query at all are those modules' whole directory. Empty, which is the
    ///     default, is no module filter and every module searched.
    ///   - type: One type's own name (`FileRead`), narrowing to it and to every function whose
    ///     signature mentions it — what a value of this shape can be used for. Left out, nothing is
    ///     narrowed.
    ///   - kind: Whether to return only modules, only functions or only types. Left out, all three
    ///     come back.
    ///   - offset: How many hits to skip, for paging through a total larger than one page. Left out,
    ///     the page starts at the best match.
    ///   - limit: How many hits to return. Left out, the page holds 20; the ceiling is 100, and a
    ///     larger one clamps rather than failing.
    /// - Returns: the page that matched, best first, and how many matched behind it.
    /// - Throws: `core.ApiError` with `.invalidArgument` when there is no query and no filter at
    ///   all — asking for nothing and matching nothing are different answers — and when `limit` is
    ///   `0`, which is a page that could never answer anything.
    /// - ggop: docs.search
    public static func search(
        query: String? = nil, modules: [String] = [], type: String? = nil, kind: DocKind? = nil,
        offset: Int? = nil, limit: Int? = nil
    ) throws -> DocSearch {
        try withScratch { scratch in
            var modules = scratch.list(modules)
            var ret = test_cabinet_gg_docs_doc_search_t()
            var err = test_cabinet_gg_types_api_error_t()
            let ok = withOptional(query.map { scratch.string($0) }) { query in
                withOptional(type.map { scratch.string($0) }) { type in
                    withOptional(kind.map { scratch.string($0.wire) }) { kind in
                        withWindow(offset, limit) { offset, limit in
                            test_cabinet_gg_docs_search(
                                query, &modules, type, kind, offset, limit, &ret, &err)
                        }
                    }
                }
            }
            guard ok else { throw lift(failure: &err) }
            let found = DocSearch(wire: ret)
            test_cabinet_gg_docs_doc_search_free(&ret)
            return found
        }
    }

    /// Take one documentation view out of the context window, by the key it was opened under.
    ///
    /// The removal does not cascade: closing a function's view leaves the views of the types it
    /// named, and closing a type's leaves every function beside it, because nothing records why a
    /// view was opened. A type closed here is opened again by the next function that mentions it.
    ///
    /// - Parameter key: The fully-qualified name the view was opened under, as a hit's `key` reports
    ///   it.
    /// - Returns: how many views were closed, which is `0` when that key is not open — not a
    ///   failure, so a program that tidies up unconditionally needs no guard.
    /// - Throws: `core.ApiError` with `.unavailable` when this agent was not given the capability
    ///   that buys closing documentation.
    /// - ggop: docs.close
    @discardableResult
    public static func close(_ key: String) throws -> Int {
        try withScratch { scratch in
            var key = scratch.string(key)
            var ret: UInt32 = 0
            var err = test_cabinet_gg_types_api_error_t()
            guard test_cabinet_gg_docs_close_doc_view(&key, &ret, &err) else {
                throw lift(failure: &err)
            }
            return Int(ret)
        }
    }

    /// Take every documentation view out of the context window, and report how many went.
    ///
    /// The blanket form of `docs.close`, on the same terms and behind the same capability: what it
    /// frees is every documentation view the session has opened, and none of the file or text views
    /// beside them.
    ///
    /// - Returns: how many views were closed.
    /// - Throws: `core.ApiError` with `.unavailable` when this agent was not given the capability
    ///   that buys closing documentation.
    /// - ggop: docs.close_all
    @discardableResult
    public static func closeAll() throws -> Int {
        var ret: UInt32 = 0
        var err = test_cabinet_gg_types_api_error_t()
        guard test_cabinet_gg_docs_close_doc_views(&ret, &err) else { throw lift(failure: &err) }
        return Int(ret)
    }

    /// Which of the three kinds of entry a search hit documents.
    public enum DocKind: Sendable {
        /// A module a program imports, and whose functions live inside it.
        case module
        /// A function a program calls.
        case function
        /// A type a function's signature names.
        case type

        // The wire spells this as a word in both directions, because WIT has no closed set for it
        // that both sides of the boundary would agree on. These three words are the whole taxonomy,
        // and anything else is read as a function rather than as a parse this SDK could fail.
        var wire: String {
            switch self {
            case .module: "module"
            case .function: "function"
            case .type: "type"
            }
        }

        init(wire: sandbox_string_t) {
            switch lift(wire) {
            case "module": self = .module
            case "type": self = .type
            default: self = .function
            }
        }
    }

    /// One page of what `docs.search` matched, and the total behind it.
    public struct DocSearch: Sendable {
        /// How many entries matched before paging, so a capped page is legible rather than guessed
        /// at.
        public let total: Int
        /// The offset this page starts at, echoed back.
        public let offset: Int
        /// The page itself, best first.
        public let hits: [DocHit]

        init(wire: test_cabinet_gg_docs_doc_search_t) {
            total = Int(wire.total)
            offset = Int(wire.offset)
            hits = lift(wire.hits.ptr, wire.hits.len) { DocHit(wire: $0) }
        }
    }

    /// One entry a search matched: enough to choose from, and no more.
    public struct DocHit: Sendable {
        /// The fully-qualified name it is keyed by, which is what opening and closing its view take.
        public let key: String
        /// Whether this is a module, a function or a type.
        public let kind: DocKind
        /// The module it lives in.
        ///
        /// The module that publishes a function, itself for a module, and for a type the module
        /// that **declares** it — one module in every case, never a list. It is exactly what the
        /// `modules` filter compares whole, so a hit worth more of is that module's own directory,
        /// one search away.
        public let module: String
        /// The name a program calls it by, the type's own name, or the module's own path.
        public let name: String
        /// Its one-line brief, and only that. The rest is what a documentation view holds.
        public let summary: String

        init(wire: test_cabinet_gg_docs_doc_hit_t) {
            key = lift(wire.key)
            kind = DocKind(wire: wire.kind)
            module = lift(wire.module)
            name = lift(wire.name)
            summary = lift(wire.summary)
        }
    }
}
