//! Read, write, edit and list the files of the workspace.
//!
//! Reading is the cheap direction of this sandbox and writing is the expensive one, so a program that
//! reads a dozen files to decide what to change is well shaped, while one that rewrites forty large
//! files in a single turn will exhaust its fuel budget.
//!
//! Nothing here places anything in the agent's context window.
//! [`views::open_file`](crate::views::open_file) is the call that does.

use crate::bindings::test_cabinet::gg::{files, helpers};
use crate::core::ToolError;
use crate::wire;

/// The gg tools this module dispatches, which is part of what the component answers `bound-tools`
/// with. Declared beside the functions that call them, so a tool added here is a tool the artifact
/// reports.
pub(crate) const TOOLS: &[&str] = &["read_file", "write_file", "edit_file", "list_dir"];


/// Read a file, as either a [`FileRead::Text`] or a [`FileRead::Image`].
///
/// Which of the two comes back is detected from the file's bytes, never from the extension, so a
/// mislabelled picture is still a picture. The enum is closed, so an ordinary `match` needs no
/// catch-all:
///
/// ```ignore
/// match files::read_file("logo.png", files::ReadOptions::default())? {
///     files::FileRead::Text(text) => views::open_text("logo", &text.contents)?,
///     files::FileRead::Image(picture) => views::open_text("logo", &picture.label)?,
/// }
/// ```
///
/// A relative path resolves against the workspace; an absolute one is read as given, so anything else
/// in this container — an offloaded command's output under `/tmp/gg-shell`, say — is readable. This
/// call hands bytes to the program and places nothing in the context window; reading a picture
/// describes it and shows nothing, so a file only read here is a file nobody has looked at.
///
/// # Arguments
///
/// * `path` — The file to read, relative to the workspace or absolute.
/// * `options` — The window of lines to read; `files::ReadOptions::default()` reads the whole file.
///
/// # Returns
///
/// The window of lines `options` asked for, or — when the bytes turn out to be a picture — the
/// description gg made of it instead.
///
/// # Errors
///
/// `NotFound` for a missing path.
#[doc(alias = "ggop:files.read_file")]
pub fn read_file(path: &str, options: ReadOptions) -> Result<FileRead, ToolError> {
    let (offset, limit) = options.window();
    wire::lift(files::read_file(path, offset, limit)).map(wire::file_read)
}

/// Read a text file and hand back its contents directly.
///
/// [`read_file`] without the narrowing, for the common case: the same read, the same window, the same
/// cost.
///
/// # Arguments
///
/// * `path` — The file to read, relative to the workspace or absolute.
/// * `options` — The window of lines to read; `files::ReadOptions::default()` reads the whole file.
///
/// # Returns
///
/// The same text [`read_file`] would have put in its [`FileRead::Text`] arm, with nothing to unwrap.
///
/// # Errors
///
/// `InvalidArgument` when the path names a picture, which [`read_file`] inspects instead and
/// [`views::open_file`](crate::views::open_file) displays.
#[doc(alias = "ggop:files.read_text_file")]
pub fn read_text_file(path: &str, options: ReadOptions) -> Result<String, ToolError> {
    let (offset, limit) = options.window();
    wire::lift(helpers::read_text_file(path, offset, limit))
}

/// Write UTF-8 text to a file, creating parent directories and replacing what is there.
///
/// Writing is the expensive direction of this sandbox: rewriting more than a few dozen large files in
/// one program exhausts its fuel budget, so a large rewrite is best split across several turns.
///
/// # Arguments
///
/// * `path` — Where to write, relative to the workspace or absolute. Parent directories are created.
/// * `contents` — The UTF-8 text to write. It replaces the file entirely.
///
/// # Returns
///
/// How many bytes reached the file, which is `contents` measured in UTF-8 rather than in characters.
///
/// # Errors
///
/// `InvalidArgument` for an empty path, and `IoError` when creating the parent directories or the
/// write itself failed.
#[doc(alias = "ggop:files.write_file")]
pub fn write_file(path: &str, contents: &str) -> Result<u64, ToolError> {
    wire::lift(files::write_file(path, contents))
}

/// Replace the one exact occurrence of some text in a file with something else.
///
/// Widening the surrounding context until the match is unique is the way to disambiguate; counting
/// occurrences is not.
///
/// # Arguments
///
/// * `path` — The file to edit.
/// * `old_string` — The exact text to find, whitespace included. It must appear exactly once.
/// * `new_string` — The text to put in its place. An empty string deletes the match.
///
/// # Errors
///
/// `NotFound` when the text does not appear, and `Conflict` — with the number of matches — when it
/// appears more than once.
#[doc(alias = "ggop:files.edit_file")]
pub fn edit_file(path: &str, old_string: &str, new_string: &str) -> Result<(), ToolError> {
    wire::lift(files::edit_file(path, old_string, new_string))
}

/// List a directory, sorted by name; `None` lists the workspace root.
///
/// Each entry carries a bare [`name`](DirEntry::name) — join it with the directory that was listed —
/// and its [`kind`](DirEntry::kind). An empty directory is an empty `Vec`, not a failure.
///
/// # Arguments
///
/// * `path` — The directory to list, relative to the workspace or absolute; `None` lists the
///   workspace root.
///
/// # Returns
///
/// One entry per name directly in the directory, files and directories alike. Nothing is recursed
/// into, so walking a tree is a call per level.
///
/// # Errors
///
/// `NotFound` for a directory that is not there, and `InvalidArgument` for a path that is given but
/// empty.
#[doc(alias = "ggop:files.list_dir")]
pub fn list_dir(path: Option<&str>) -> Result<Vec<DirEntry>, ToolError> {
    wire::lift(files::list_dir(path))
        .map(|entries| entries.into_iter().map(wire::dir_entry).collect())
}

/// What a read returned: a text file's window, or a picture's description.
///
/// A picture is a different kind of thing from text, so it is a different variant rather than a
/// string that happens to be binary — a program that treats an image as text is caught by the `match`
/// instead of silently writing an empty string somewhere. Image bytes never enter the program: gg
/// attaches the picture to the turn instead, which is worth far more than base64 in a variable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileRead {
    /// This file is text.
    Text(TextFile),
    /// This file is a picture, which gg shows rather than handing over its bytes.
    Image(ImageFile),
}

/// A text file's window, as the [`FileRead::Text`] arm carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextFile {
    /// The file's text, or just the requested window under a capped read policy.
    pub contents: String,
    /// The 1-based first line returned.
    pub first_line: u32,
    /// The 1-based last line returned.
    pub last_line: u32,
    /// The file's total line count, which says whether to page again.
    pub total_lines: u32,
    /// Whether a 256 KiB byte ceiling cut the returned text.
    pub byte_truncated: bool,
}

/// A picture's description, as the [`FileRead::Image`] arm carries it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageFile {
    /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
    pub media_type: String,
    /// The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
    pub label: String,
    /// The file's size in bytes.
    pub bytes: u64,
    /// Whether the picture is being attached to this turn to be looked at.
    pub shown: bool,
    /// Why it is not being shown; `None` when it is.
    pub not_shown_reason: Option<String>,
}

/// One entry [`list_dir`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    /// The entry's bare name, with no directory part. Join it with the directory that was listed.
    pub name: String,
    /// What the entry is.
    pub kind: EntryKind,
}

/// What a directory entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EntryKind {
    /// An ordinary file.
    File,
    /// A directory, which can be listed in turn.
    Directory,
    /// Everything that is neither, a symlink among them.
    Other,
}

/// The window of lines a read covers. [`Default`] reads the whole file.
///
/// Both fields are honoured only under a capped read policy; under the unlimited policy the whole
/// file comes back and both are ignored. The system prompt says which policy this run uses.
///
/// Rust has no default arguments, and the idiom it reaches for instead is a struct with a [`Default`]
/// filled in by functional-update syntax:
/// `files::ReadOptions { limit: Some(40), ..Default::default() }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReadOptions {
    /// The 1-based line to start at.
    pub offset: Option<u32>,
    /// How many lines to return from `offset`.
    pub limit: Option<u32>,
}
