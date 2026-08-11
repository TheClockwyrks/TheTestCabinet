//! Find the functions and types this run bound, and take their documentation back out of context.
//!
//! Discovery is two steps. [`search`] answers with one-line briefs, each carrying the
//! fully-qualified name it is keyed by, and
//! [`views::open_docs_view`](crate::views::open_docs_view) reads one of those names in full. Nothing
//! else names a function: the system prompt lists the modules and stops there, so a search is how a
//! call is found and a documentation view is how it is understood.
//!
//! [`search`] is bound to every program whatever a run enables, because an agent that cannot find
//! its own surface does not have one. [`close`] and [`close_all`] are the exception and are bought
//! by a capability: opening documentation only ever adds to the end of the prompt, while closing it
//! rewrites the middle.

use crate::bindings::test_cabinet::gg::docs;
use crate::core::ToolError;
use crate::wire;

/// Search the bound functions and types by keyword, by module, or by both — best match first.
///
/// Matching is case-insensitive substring over names, signatures, briefs and detailed descriptions,
/// so `docs` finds `open_docs_view` and `view` finds every call that mentions one. Ranking is by the
/// kind of evidence that matched: an entry whose own name matched outranks one that merely mentions
/// the word in a paragraph, however often it mentions it. Only what this run bound is ever returned,
/// so nothing a search finds is something the program cannot call.
///
/// The result is a value **and** a view. The value is readable in the turn that asked for it; the
/// view puts the same page in the next prompt under the selector `search results`, replaced by the
/// next search rather than accumulating, and closed by [`views::close`](crate::views::close). A hit
/// carries a brief and no more — reading one in full is
/// [`views::open_docs_view`](crate::views::open_docs_view) on its [`key`](DocHit::key).
///
/// Paging is [`offset`](SearchOptions::offset) and [`limit`](SearchOptions::limit), and
/// [`total`](DocSearch::total) counts the matches behind the page, so a capped page is legible as
/// one rather than guessed at. The default page is 20 hits and the largest is 100; a larger `limit`
/// clamps rather than fails.
///
/// # Arguments
///
/// * `query` — The words to look for, matched as case-insensitive substrings. Several specific words
///   rank an entry above one vague word. It may be empty when `options` narrows the search.
/// * `options` — The filters and the page. `docs::SearchOptions::default()` searches the whole bound
///   surface and takes the first page.
///
/// # Errors
///
/// `InvalidArgument` when `query` is empty and no filter is set — *nothing to look for* and *nothing
/// matched* are different answers — and when [`limit`](SearchOptions::limit) is `Some(0)`, which is a
/// page that could never answer anything.
#[doc(alias = "ggop:docs.search")]
pub fn search(query: &str, options: SearchOptions<'_>) -> Result<DocSearch, ToolError> {
    wire::lift(docs::search(
        query,
        options.module,
        options.declared_type,
        options.kind.map(DocKind::as_str),
        options.offset,
        options.limit,
    ))
    .map(wire::doc_search)
}

/// Take one documentation view out of the context window, by the key it was opened under.
///
/// What comes back is how many views closed: a key that is not open closes `0` rather than failing,
/// so a program that tidies up unconditionally needs no guard. The removal does not cascade —
/// closing a function's view leaves the views of the types it named, and closing a type's leaves
/// every function beside it — because nothing records why a view was opened, and a type closed here
/// is opened again by the next function that mentions it.
///
/// # Arguments
///
/// * `key` — The fully-qualified name the view was opened under, as [`DocHit::key`] reports it.
///
/// # Errors
///
/// `Unavailable` when this agent was not given the capability that buys closing documentation.
#[doc(alias = "ggop:docs.close")]
pub fn close(key: &str) -> Result<u32, ToolError> {
    wire::lift(docs::close_doc_view(key))
}

/// Take every documentation view out of the context window, and report how many went.
///
/// The blanket form of [`close`], on the same terms and behind the same capability: what it frees is
/// every documentation view the session has opened, and none of the file or text views beside them.
///
/// # Errors
///
/// `Unavailable` when this agent was not given the capability that buys closing documentation.
#[doc(alias = "ggop:docs.close_all")]
pub fn close_all() -> Result<u32, ToolError> {
    wire::lift(docs::close_doc_views())
}

/// The filters and the page a [`search`] runs under. [`Default`] narrows nothing.
///
/// Every field composes with the query and with the others. Rust has no default arguments, and the
/// idiom it reaches for instead is a struct with a [`Default`] filled in by functional-update
/// syntax: `docs::SearchOptions { module: Some("files"), ..Default::default() }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SearchOptions<'a> {
    /// One module to look in, by gg's id (`files`) or by this arm's path (`gg::files`).
    ///
    /// Exact and case-insensitive, because a module filter is a lookup rather than a search: an
    /// empty query and a module is that module's whole directory.
    pub module: Option<&'a str>,
    /// One type's own name (`FileRead`), narrowing to that type and to the functions that name it.
    ///
    /// What a value of this shape can be used for, in other words: every bound function whose
    /// signature mentions the type comes back beside the type's own entry.
    pub declared_type: Option<&'a str>,
    /// Whether to return only functions or only types; `None` returns both.
    pub kind: Option<DocKind>,
    /// How many hits to skip, for paging through a total larger than one page.
    pub offset: Option<u32>,
    /// How many hits to return; `None` takes the default page of 20, and the ceiling is 100.
    pub limit: Option<u32>,
}

/// Which of the two kinds of entry a [`DocHit`] documents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DocKind {
    /// A function a program calls.
    Function,
    /// A type a function's signature names.
    Type,
}

impl DocKind {
    /// The word the documentation index files this kind under.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Type => "type",
        }
    }
}

/// One page of what a [`search`] matched, and the total behind it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocSearch {
    /// How many entries matched before paging, so a capped page is legible rather than guessed at.
    pub total: u32,
    /// The offset this page starts at, echoed back.
    pub offset: u32,
    /// The page itself, best first.
    pub hits: Vec<DocHit>,
}

/// One entry a [`search`] matched: enough to choose from, and no more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocHit {
    /// The fully-qualified name this entry is keyed by, and the handle a view is opened and closed
    /// under.
    ///
    /// [`views::open_docs_view`](crate::views::open_docs_view) takes it to read the entry in full,
    /// and [`close`] takes it to put that view away again.
    pub key: String,
    /// Whether this is a function or a type.
    pub kind: DocKind,
    /// The module it lives in.
    ///
    /// One for a function, and for a type every module whose bound functions mention it,
    /// comma-separated. That plurality is why this is a description rather than something to feed
    /// back to a [`SearchOptions::module`] filter, which takes one module and compares it whole.
    pub module: String,
    /// The name a program calls it by, or the type's own name.
    pub name: String,
    /// Its one-line brief, and only that. The rest is what a documentation view holds.
    pub summary: String,
}
