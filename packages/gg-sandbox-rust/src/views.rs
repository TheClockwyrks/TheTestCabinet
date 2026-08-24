//! Show a file, a computed value, or an entry's documentation.
//!
//! A view is the only way material enters the agent's context window.
//!
//! Under responses as code a whole program's output would otherwise collapse into one anonymous blob
//! of logs, charged to one band, attributable to nothing and closable by nothing. A view restores
//! what tool calling gave for free: one message per view, carrying the band it is charged to and the
//! selector it is filed under.
//!
//! A program's own output is unreadable by the model that wrote it, and a view is the only way a
//! value it computed reaches that model. On this arm the point is hard to miss: `println!` reaches
//! nobody at all, because gg attaches no standard output to the guest.

use crate::bindings::test_cabinet::gg::views;
use crate::core::ApiError;
use crate::files::FileRead;
use crate::wire;

/// Read a file and place it in the context window, attributed to its path and filed under it.
///
/// The split from [`files::read_file`](crate::files::read_file) is the point: reading gets bytes for
/// the program, opening shows the file to the agent, so a program that reads forty files to grep them
/// puts nothing in the window. `options.offset` and `options.limit` select a window of lines, and two
/// pages of one file are two views that coexist; re-opening the same page replaces what it showed
/// rather than piling up a duplicate. An image is shown as a picture, and this is the only call that
/// shows one.
///
/// The view's text body is held to the same 65,536-byte cap a text view's body is: a window that
/// would carry more is refused, naming the size and the bound, and nothing is opened — never a
/// truncation. The program narrows the window with `offset`/`limit`, or cuts the file's long lines
/// with [`max_line_chars`](ViewOptions::max_line_chars): set, each line of the *view* longer than
/// that many characters is cut there and annotated in place as `foo (123 more chars...)`, with the
/// count of characters dropped. The cut is the view's alone — the value this returns and the file
/// itself are untouched — and the cap is measured against the body after it. Left `None`, lines
/// arrive whole.
///
/// # Arguments
///
/// * `path` — The file to open, relative to the workspace or absolute.
/// * `options` — The window of lines to show and the cut its long lines get;
///   `views::ViewOptions::default()` shows the whole file with every line whole.
///
/// # Returns
///
/// Exactly what [`files::read_file`](crate::files::read_file) returns for the same file, long lines
/// and all. It is the program's copy and the view is the agent's, so what happens to the view later
/// leaves the value untouched.
///
/// # Errors
///
/// `NotFound` for a missing path, `InvalidArgument` for an offset past the end of the file or a
/// `max_line_chars` outside `1..=65536`, and `LimitExceeded` — naming the size and the bound — for a
/// text body over 65,536 bytes after the cut. The read is what fails; nothing is opened when it does.
#[doc(alias = "ggop:views.open_file")]
pub fn open_file(path: &str, options: ViewOptions) -> Result<FileRead, ApiError> {
    let (offset, limit, max_line_chars) = options.window();
    wire::lift(views::open_file_view(path, offset, limit, max_line_chars)).map(wire::file_read)
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
/// * `label` — What to file the view under. Opening the same label again replaces what it showed.
///   It may not be empty.
/// * `body` — What to show. An empty body is allowed: it is how a program says that something it was
///   showing is now empty.
///
/// # Errors
///
/// `InvalidArgument` for an empty label — a view with no selector could never be closed or attributed
/// — and `LimitExceeded`, naming the cap, for a body or label over gg's caps. Nothing is ever
/// silently truncated.
#[doc(alias = "ggop:views.open_text")]
pub fn open_text(label: &str, body: &str) -> Result<(), ApiError> {
    wire::lift(views::open_text_view(label, body))
}

/// Place one module's, function's or type's full documentation into the context window.
///
/// Its signature or declaration, its description, and the declarations of any types it refers to
/// that have not already been shown this session. This is how an entry is read. It is a **view**,
/// not a return value — the documentation arrives in the next prompt under a `Documentation` heading
/// keyed by the entry's name, exactly as a file or a computed value arrives — so it is not available
/// in the turn it is asked for. Ask in one turn, use it in the next. Opening a key that is already
/// open does nothing at all: the view is neither moved nor sent again.
///
/// # Arguments
///
/// * `name` — The entry to document, by the fully-qualified name its documentation is keyed by —
///   `"gg::views::open_text"`, and for a module its own path, `"gg::views"`. The bare name a
///   function is called by in its module (`"open_text"`) also resolves and is a fallback rather than
///   the form to reach for: two modules are free to declare a `close`, and only the qualified name
///   says which one is meant. Searching the documentation is what says which names exist.
///
/// # Errors
///
/// `NotFound` for an unknown or unbound name.
#[doc(alias = "ggop:views.open_docs_view")]
pub fn open_docs_view(name: &str) -> Result<(), ApiError> {
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
/// Documentation views are not reached from here: taking one away is bought by a capability of its
/// own, `docview-close` — so a sweep that included them would hand back `0` for an agent that may
/// not close one, which reads as a selector that named nothing.
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
/// Closing a view is context management, bought — with [`current`] — by the
/// `agent-managed-context` capability: an agent whose run did not enable it is refused.
///
/// # Errors
///
/// `InvalidArgument` for an empty selector, which names nothing rather than everything — no call
/// here closes the window wholesale. `Unavailable` for an agent whose run did not buy
/// `agent-managed-context`.
#[doc(alias = "ggop:views.close")]
pub fn close(selector: &str) -> Result<u32, ApiError> {
    wire::lift(views::close_view(selector))
}

/// The window of lines a file view shows, and the cut its long lines get. [`Default`] shows the whole file.
///
/// `offset` and `limit` are the same window a read takes, honoured under every read policy; the
/// policy decides only what an absent `limit` means. `max_line_chars` is the view's own: it cuts the
/// lines the *agent* sees and leaves the value the program gets whole.
///
/// Rust has no default arguments, and the idiom it reaches for instead is a struct with a [`Default`]
/// filled in by functional-update syntax:
/// `views::ViewOptions { max_line_chars: Some(200), ..Default::default() }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ViewOptions {
    /// The 1-based line to start at; `None` starts at the first line.
    pub offset: Option<u32>,
    /// How many lines to show from `offset`; `None` shows to the end, or the read policy's default cap.
    pub limit: Option<u32>,
    /// Cut each line of the view longer than this many characters; `None` leaves every line whole.
    ///
    /// A cut line is annotated in place as `foo (123 more chars...)`. The range is `1..=65536`, and
    /// a value outside it refuses the open.
    pub max_line_chars: Option<u32>,
}

