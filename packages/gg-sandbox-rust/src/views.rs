//! Show a file, a computed value, or an entry's documentation.
//!
//! A view is the only way material enters the context window. Each view is one message, carrying the
//! band it is charged to and the selector it is filed under.
//!
//! `println!` reaches nobody: gg attaches no standard output to the guest.

use crate::bindings::test_cabinet::gg::views;
use crate::core::ApiError;
use crate::files::FileRead;
use crate::wire;

/// Read a file and place it in the context window, attributed to its path and filed under it.
///
/// `options.offset` and `options.limit` select a window of lines. Two pages of one file are two
/// views that coexist; re-opening the same page replaces what it showed. An image is shown as a
/// picture, and this is the only call that shows one.
///
/// The view's text body is held to a 65,536-byte cap: a window that would carry more is refused,
/// naming the size and the bound, and nothing is opened.
/// [`max_line_chars`](ViewOptions::max_line_chars), when set, cuts each line of the view longer than
/// that many characters and annotates it in place as `foo (123 more chars...)`; the cut is the
/// view's alone, and the cap is measured against the body after it. Left `None`, lines arrive whole.
///
/// # Arguments
///
/// * `path` — The file to open, relative to the workspace or absolute.
/// * `options` — The window of lines to show and the cut its long lines get;
///   `views::ViewOptions::default()` shows the whole file with every line whole.
///
/// # Returns
///
/// The file's window as a value, long lines and all. The value and the view are separate copies.
///
/// # Errors
///
/// `NotFound` for a missing path, `InvalidArgument` for an offset past the end of the file or a
/// `max_line_chars` outside `1..=65536`, and `LimitExceeded` — naming the size and the bound — for a
/// text body over 65,536 bytes after the cut. Nothing is opened when the read fails.
#[doc(alias = "ggop:views.open_file")]
pub fn open_file(path: &str, options: ViewOptions) -> Result<FileRead, ApiError> {
    let (offset, limit, max_line_chars) = options.window();
    wire::lift(views::open_file_view(path, offset, limit, max_line_chars)).map(wire::file_read)
}

/// Place a value the program computed into the context window, under `label`.
///
/// A directory listing, a command's output, a child agent's answer, a table the program assembled.
/// Opening the same label again replaces what it showed.
///
/// # Arguments
///
/// * `label` — What to file the view under. Opening the same label again replaces what it showed.
///   It may not be empty.
/// * `body` — What to show. An empty body is allowed.
///
/// # Errors
///
/// `InvalidArgument` for an empty label, and `LimitExceeded`, naming the cap, for a body or label
/// over gg's caps. Nothing is ever silently truncated.
#[doc(alias = "ggop:views.open_text")]
pub fn open_text(label: &str, body: &str) -> Result<(), ApiError> {
    wire::lift(views::open_text_view(label, body))
}

/// Place one module's, function's or type's full documentation into the context window.
///
/// Its signature or declaration, its description, and the declarations of any types it refers to
/// that have not already been shown this session. It is a view rather than a return value: the
/// documentation arrives in the next prompt under a `Documentation` heading keyed by the entry's
/// name, so it is not available in the turn it is asked for. Opening a key that is already open does
/// nothing: the view is neither moved nor sent again.
///
/// # Arguments
///
/// * `name` — The entry to document, by the fully-qualified name its documentation is keyed by —
///   `"gg::views::open_text"`, and for a module its own path, `"gg::views"`. The bare name a
///   function is called by in its module (`"open_text"`) also resolves, and is ambiguous where two
///   modules declare the same name.
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
/// results of a search the label `search results`. Closing a selector that is not open returns `0`
/// rather than failing. Closing a file view forgets what was read, not what exists; closing a text
/// view discards the only copy of what it held.
///
/// Documentation views are not reached from here.
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
/// `InvalidArgument` for an empty selector, which names nothing rather than everything.
/// `Unavailable` when the run did not enable `agent-managed-context`.
#[doc(alias = "ggop:views.close")]
pub fn close(selector: &str) -> Result<u32, ApiError> {
    wire::lift(views::close_view(selector))
}

/// The window of lines a file view shows, and the cut its long lines get. [`Default`] shows the whole file.
///
/// `offset` and `limit` are the same window a read takes, honoured under every read policy; the
/// policy decides only what an absent `limit` means. `max_line_chars` cuts the lines the view shows
/// and leaves the returned value whole.
///
/// Fields left out are taken from [`Default`]:
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

