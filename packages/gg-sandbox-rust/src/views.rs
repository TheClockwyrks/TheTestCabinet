//! Show a file, a computed value, or a function's documentation.
//!
//! A view is the only way material enters the agent's context window.
//!
//! Under responses as code a whole program's output would otherwise collapse into one anonymous blob
//! of logs, charged to one band, attributable to nothing and closable by nothing. A view restores
//! what tool calling gave for free: one message per view, carrying the band it is charged to and the
//! selector it can be closed by.
//!
//! A program's own output is unreadable by the model that wrote it, and a view is the only way a
//! value it computed reaches that model. On this arm the point is hard to miss: `println!` reaches
//! nobody at all, because `wasm32-unknown-unknown` has no standard output to write to.

use crate::bindings::test_cabinet::gg::views;
use crate::core::ToolError;
use crate::files::{FileRead, ReadOptions};
use crate::wire;


/// Read a file and place it in the context window, attributed to its path and closable by it.
///
/// The split from [`files::read_file`](crate::files::read_file) is the point: reading gets bytes for
/// the program, opening shows the file to the agent, so a program that reads forty files to grep them
/// puts nothing in the window. `options.offset` and `options.limit` select a window of lines, and two
/// pages of one file are two views that coexist; re-opening the same page replaces what it showed
/// rather than piling up a duplicate. An image is shown as a picture, and this is the only call that
/// shows one.
///
/// # Arguments
///
/// * `path` — The file to open, relative to the workspace or absolute.
/// * `options` — The window of lines to show; `files::ReadOptions::default()` shows the whole file.
///
/// # Returns
///
/// Exactly what [`files::read_file`](crate::files::read_file) returns for the same file. It is the
/// program's copy and the view is the agent's, so closing the view leaves the value untouched.
///
/// # Errors
///
/// `NotFound` for a missing path, and `InvalidArgument` for an offset past the end of the file. The
/// read is what fails; nothing is opened when it does.
#[doc(alias = "ggop:views.open_file")]
pub fn open_file(path: &str, options: ReadOptions) -> Result<FileRead, ToolError> {
    let (offset, limit) = options.window();
    wire::lift(views::open_file_view(path, offset, limit)).map(wire::file_read)
}

/// Place a value the program computed into the context window, under `label`.
///
/// A directory listing, a command's output, a child agent's answer, a table the program assembled.
/// This is how the result of a program reaches the model that wrote it, and the only way it does.
/// Opening the same label again replaces what it showed, so a program may refine a view in a loop
/// without piling up a copy per iteration.
///
/// # Arguments
///
/// * `label` — What to file the view under. [`close`] takes it, and opening the same label again
///   replaces what it showed. It may not be empty.
/// * `body` — What to show. An empty body is allowed: it is how a program says that something it was
///   showing is now empty.
///
/// # Errors
///
/// `InvalidArgument` for an empty label — a view with no selector could never be closed or attributed
/// — and `LimitExceeded`, naming the cap, for a body or label over gg's caps. Nothing is ever
/// silently truncated.
#[doc(alias = "ggop:views.open_text")]
pub fn open_text(label: &str, body: &str) -> Result<(), ToolError> {
    wire::lift(views::open_text_view(label, body))
}

/// Place one function's full documentation into the context window.
///
/// Its signature, its description, and the declarations of any types it refers to that have not
/// already been shown this session. This is how a function is read. It is a **view**, not a return
/// value — the documentation arrives in the next prompt under a `Documentation` heading keyed by the
/// function name, exactly as a file or a computed value arrives — so it is not available in the turn
/// it is asked for. Ask in one turn, use it in the next. Opening the same function's documentation
/// again replaces the view rather than adding a second copy, and
/// [`docs::close`](crate::docs::close) closes it — not [`close`], which does not reach
/// documentation.
///
/// # Arguments
///
/// * `name` — The function to document, by the fully-qualified name its documentation is keyed
///   by — `"gg::files::read_file"`. The bare name it is called by in its module (`"read_file"`)
///   also resolves and is a fallback rather than the form to reach for: two modules are free to
///   declare a `close`, and only the qualified name says which one is meant. Searching the
///   documentation is what says which names exist.
///
/// # Errors
///
/// `NotFound` for an unknown or unbound name.
#[doc(alias = "ggop:views.open_docs_view")]
pub fn open_docs_view(name: &str) -> Result<(), ToolError> {
    wire::lift(views::open_docs_view(name))
}

/// Close every view carrying `selector`, freeing the tokens they occupied.
///
/// For a file that is every page of that path, for a text view the one with that label, and for the
/// results of a search the label `search results`. Closing a selector that is not open hands back
/// `0` rather than failing, so a program that tidies up unconditionally need not guard every call.
/// Closing a file view forgets what was read, not what exists; closing a text view discards the only
/// copy of what it held, so anything needed later belongs in a file or a memory first.
///
/// Documentation views are not reached from here. [`docs::close`](crate::docs::close) is what takes
/// one away, and it is bought by a capability this call is not — so a sweep that included them would
/// hand back `0` for an agent that may not close one, which reads as a selector that named nothing.
///
/// # Arguments
///
/// * `selector` — What the view is filed under: a file's path, a text view's label, or
///   `search results`.
///
/// # Returns
///
/// How many views were closed, counting each page of a paged file as one of them.
///
/// # Errors
///
/// `InvalidArgument` for an empty selector, which names nothing rather than everything — no call
/// here closes the window wholesale.
#[doc(alias = "ggop:views.close")]
pub fn close(selector: &str) -> Result<u32, ToolError> {
    wire::lift(views::close_view(selector))
}

/// List what is open in the context window right now.
///
/// Each view's [`kind`](OpenView::kind), the [`selector`](OpenView::selector) that closes it, roughly
/// what it costs in [`tokens`](OpenView::tokens), and — for a paged file view — the
/// [`region`](OpenView::region) it covers. Reading it is what decides what to close when the window
/// is filling up.
///
/// # Returns
///
/// Every view open right now, in no particular order. The cost on each is an estimate, so it ranks
/// the views worth closing rather than saying exactly what closing one frees.
#[doc(alias = "ggop:views.current")]
pub fn current() -> Vec<OpenView> {
    views::current_views()
        .into_iter()
        .map(wire::open_view)
        .collect()
}

/// Which of the three kinds a view is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ViewKind {
    /// A file that was opened; its selector is the path.
    File,
    /// A computed value; its selector is the label it was given.
    Text,
    /// A function's documentation; its selector is the function's name.
    Docs,
}

/// The window of lines a paged file view covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewRegion {
    /// The 1-based first line the view shows.
    pub offset: u32,
    /// How many lines it shows.
    pub limit: u32,
}

/// One view open in the context window, as [`current`] reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenView {
    /// Whether it is a file, text, or documentation view.
    pub kind: ViewKind,
    /// What closes it.
    ///
    /// A file's path, a text view's label or `search results` for [`close`], and for a documentation
    /// view the key [`docs::close`](crate::docs::close) takes.
    pub selector: String,
    /// Roughly what holding it costs, in tokens.
    pub tokens: u64,
    /// The line window a paged file view covers; `None` for a whole-file view and for text views.
    pub region: Option<ViewRegion>,
}

impl OpenView {
    /// Close this view, with its selector already supplied.
    ///
    /// [`close`] for the common case where the open view is in hand — so every view under the same
    /// selector goes, which for a paged file is every page of that path.
    ///
    /// A documentation view is the one this does not take away, for the reason [`close`] gives:
    /// [`docs::close`](crate::docs::close) is the call for one of those.
    ///
    /// # Returns
    ///
    /// How many views were closed, which is `0` when this one has been closed already.
    ///
    /// # Errors
    ///
    /// `InvalidArgument` when this view's [`selector`](Self::selector) is empty, which no view gg
    /// reports ever is.
    #[doc(alias = "ggop-alias:views.close")]
    pub fn close(&self) -> Result<u32, ToolError> {
        close(&self.selector)
    }
}
