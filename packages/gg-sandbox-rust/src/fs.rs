//! read, write, and edit workspace files
//!
//! Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
//! that reads a dozen files to decide what to change is doing the right thing, while one that
//! rewrites forty large files in a single turn will exhaust its fuel budget.
//!
//! Nothing here puts anything in your context window. [`view::open_file`](crate::view::open_file)
//! is the call that shows a file to *you*.

use crate::bindings::test_cabinet::gg::{files, helpers};
use crate::error::ToolError;
use crate::options::ReadOptions;
use crate::types::{DirEntry, FileRead};
use crate::wire;

/// The gg tools this object dispatches, which is half of what the component answers `bound-tools`
/// with. Declared beside the functions that call them, so a tool added here is a tool the artifact
/// reports.
pub(crate) const TOOLS: &[&str] = &["read_file", "write_file", "edit_file", "list_dir"];

crate::meta::directory_of!("fs");

/// Read a file, handing back a [`FileRead::Text`] or a [`FileRead::Image`] — the format is detected
/// from the file's bytes, never its extension.
///
/// This gets bytes for your PROGRAM and puts NOTHING in your context window; `view::open_file` is
/// the call that shows the file to you. A relative path resolves against your workspace; an absolute
/// one is read as given, so anything in this container — an offloaded command's output under
/// `/tmp/gg-shell`, say — is readable.
///
/// Reading an IMAGE describes it to your program — label, media type, byte size — and does not show
/// it to YOU: the pixels reach neither your program nor your context window, so a file you only
/// `fs::read_file` is a file you have not looked at. `view::open_file` is the one way to actually
/// see a picture.
///
/// Narrow the two arms with an ordinary `match`, which needs no catch-all because the enum is
/// closed:
///
/// ```ignore
/// match fs::read_file("logo.png", ReadOptions::default())? {
///     FileRead::Text(text) => view::open_text("logo", &text.contents)?,
///     FileRead::Image(picture) => view::open_text("logo", &picture.label)?,
/// }
/// ```
///
/// # Arguments
///
/// * `path` — The file to read. Relative to your workspace, or absolute for anything else in this
///   container.
/// * `options` — The window of lines to read; `ReadOptions::default()` reads the whole file.
///
/// # Errors
///
/// `NotFound` for a missing path.
pub fn read_file(path: &str, options: ReadOptions) -> Result<FileRead, ToolError> {
    let (offset, limit) = options.window();
    wire::lift(files::read_file(path, offset, limit)).map(wire::file_read)
}

/// Read a text file and hand back its contents directly — `fs::read_file` without the narrowing, for
/// the common case.
///
/// It takes the same window options. Reading is the cheap direction of this sandbox, so a program
/// that reads a dozen files to decide what to change is doing the right thing.
///
/// # Arguments
///
/// * `path` — The file to read. Relative to your workspace, or absolute.
/// * `options` — The window of lines to read; `ReadOptions::default()` reads the whole file.
///
/// # Errors
///
/// `InvalidArgument` when the path names a picture; use `fs::read_file` to inspect those, and
/// `view::open_file` to look at one.
pub fn read_text_file(path: &str, options: ReadOptions) -> Result<String, ToolError> {
    let (offset, limit) = options.window();
    wire::lift(helpers::read_text_file(path, offset, limit))
}

/// Write UTF-8 text to a file, creating parent directories and replacing any existing file, and hand
/// back the number of bytes written.
///
/// Writing is the expensive direction of the sandbox — rewriting more than a few dozen large files
/// in one program exhausts its fuel budget, so split a large rewrite across several turns.
///
/// # Arguments
///
/// * `path` — Where to write. Relative to your workspace, or absolute. Parent directories are
///   created for you.
/// * `contents` — The UTF-8 text to write. It replaces the file entirely.
pub fn write_file(path: &str, contents: &str) -> Result<u64, ToolError> {
    wire::lift(files::write_file(path, contents))
}

/// Replace the one exact occurrence of `old_string` in a file with `new_string`.
///
/// Widen the surrounding context until the match is unique rather than counting occurrences.
///
/// # Arguments
///
/// * `path` — The file to edit.
/// * `old_string` — The exact text to find, including its whitespace. It must appear exactly once.
/// * `new_string` — The text to put in its place. An empty string deletes the match.
///
/// # Errors
///
/// `NotFound` when the text does not appear, and `Conflict` — with the number of matches — when it
/// appears more than once.
pub fn edit_file(path: &str, old_string: &str, new_string: &str) -> Result<(), ToolError> {
    wire::lift(files::edit_file(path, old_string, new_string))
}

/// List a directory, sorted by name; `None` lists your workspace root.
///
/// Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
/// empty directory is an empty `Vec`, not a failure.
///
/// # Arguments
///
/// * `path` — The directory to list, relative to your workspace or absolute; `None` lists your
///   workspace root.
pub fn list_dir(path: Option<&str>) -> Result<Vec<DirEntry>, ToolError> {
    wire::lift(files::list_dir(path))
        .map(|entries| entries.into_iter().map(wire::dir_entry).collect())
}
