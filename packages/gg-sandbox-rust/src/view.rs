//! show yourself a file, a value, or a function's documentation — the only way material enters your
//! context
//!
//! Under responses as code a whole program's output would otherwise collapse into one anonymous blob
//! of logs, charged to one band, attributable to nothing and closable by nothing. A view restores
//! what tool calling gave for free: one message per view, carrying the band it is charged to and the
//! selector it can be closed by.
//!
//! So [`gg::log`](crate::log) reaches the run's **operator**, and a view reaches **you**. On this arm
//! that distinction has one extra edge worth knowing: `println!` reaches nobody at all, because
//! `wasm32-unknown-unknown` has no standard output to write to.

use crate::bindings::test_cabinet::gg::views;
use crate::error::ToolError;
use crate::options::ReadOptions;
use crate::types::{FileRead, OpenView};
use crate::wire;

crate::meta::directory_of!("view");

/// Read a file AND show it to yourself: you get back exactly what
/// [`fs::read_file`](crate::fs::read_file) returns, and the file also becomes its own item in your
/// context window, attributed to its path and closable by it.
///
/// The split from `fs::read_file` is the point — `fs::read_file` gets bytes for your PROGRAM,
/// `view::open_file` shows a file to YOU — so a program that reads forty files to grep them still
/// puts nothing in your window. `options.offset` and `options.limit` select a window of lines, and
/// two pages of one file are two views that coexist; re-opening the SAME page replaces what it
/// showed rather than piling up a duplicate. An image file is shown to you as a picture, and is the
/// ONLY way to look at one — `fs::read_file` of an image describes it without showing it.
///
/// Pictures are the one thing this call can refuse. Only so many image-carrying views may be open at
/// once (your agent's `imageViewCap`); nothing is opened and nothing is shown when you pass that
/// cap, so close one with `view::close` and try again. Re-opening a picture you already have open
/// replaces it rather than adding one, and is never refused. Text views are never refused by this
/// cap.
///
/// # Arguments
///
/// * `path` — The file to open. Relative to your workspace, or absolute.
/// * `options` — The window of lines to show; `ReadOptions::default()` shows the whole file.
///
/// # Errors
///
/// `LimitExceeded`, naming the cap, when opening a picture would pass your agent's image-view cap.
pub fn open_file(path: &str, options: ReadOptions) -> Result<FileRead, ToolError> {
    let (offset, limit) = options.window();
    wire::lift(views::open_file_view(path, offset, limit)).map(wire::file_read)
}

/// Show yourself a value your program computed, under `label` — a directory listing, a command's
/// output, a child agent's answer, a table you assembled.
///
/// This is the channel into your context: logs go to the run's operator, views come back to you on
/// your next turn. Opening the same `label` again replaces what it showed, so a program may refine a
/// view in a loop without piling up a copy per iteration. An empty BODY is allowed, since it is how
/// you say that something you were showing is now empty.
///
/// # Arguments
///
/// * `label` — What to file the view under. It is what `view::close` takes, and opening the same
///   label again replaces what it showed. It may not be empty.
/// * `body` — What to show yourself. An empty body is allowed: it is how you say that something you
///   were showing is now empty.
///
/// # Errors
///
/// `InvalidArgument` for an empty label — a view with no selector could never be closed or
/// attributed — and `LimitExceeded`, naming the cap, for a body or label over gg's caps; nothing is
/// ever silently truncated.
pub fn open_text(label: &str, body: &str) -> Result<(), ToolError> {
    wire::lift(views::open_text_view(label, body))
}

/// Show yourself the full documentation for one function: its signature, its description, and the
/// declarations of any types it refers to that you have not already been shown this session.
///
/// This is how you read what a function does. It is a **view**, not a return value — the
/// documentation arrives in your next prompt under a `Documentation` heading keyed by the function
/// name, exactly as a file or a computed value arrives — so it is not available in the turn you ask
/// for it. Plan for that: ask in one turn, use it in the next. Opening the same function's docs
/// again replaces the view rather than adding a second copy, and `view::close` closes it when you
/// are done with it.
///
/// # Arguments
///
/// * `name` — The function to document, by the name it is called on its object — `"read_file"` for
///   `fs::read_file`. Every object's `list` is how you find out which names exist.
///
/// # Errors
///
/// `NotFound` for an unknown or unbound name.
pub fn open_docs_view(name: &str) -> Result<(), ToolError> {
    wire::lift(views::open_docs_view(name))
}

/// Close every view carrying `selector` and hand back how many were closed, freeing the tokens they
/// occupied.
///
/// For a file that is every page of that path, for a text view the one with that label, for a
/// documentation view the function's name. Closing a selector that is not open hands back `0` rather
/// than failing, so a program that tidies up unconditionally does not have to guard every call.
/// Closing a file view forgets what you read, not what exists; closing a text view discards the only
/// copy of what it held, so write anything you will need later to a file or a memory first.
///
/// # Arguments
///
/// * `selector` — What the view is filed under: a file's path, a text view's label, or a
///   documentation view's function name.
pub fn close(selector: &str) -> Result<u32, ToolError> {
    wire::lift(views::close_view(selector))
}

/// List what is open in your context window right now: each view's `kind`, the `selector` that
/// closes it, roughly what it costs you in `tokens`, and — for a paged file view — the `region` it
/// covers.
///
/// It is called `current` rather than `list` because every API object already carries a `list` that
/// lists that object's own functions. Read it before deciding what to close when your window is
/// filling up.
pub fn current() -> Vec<OpenView> {
    views::current_views()
        .into_iter()
        .map(wire::open_view)
        .collect()
}
