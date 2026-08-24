//! Read, write, edit, list and search the files of the workspace.
//!
//! Nothing here places anything in the agent's context window: showing something is what the
//! `gg::views` module is for.

use crate::bindings::test_cabinet::gg::files;
use crate::core::ApiError;
use crate::wire;

/// The gg tools this module dispatches, which is part of what the component answers
/// `bound-operations` with. Declared beside the functions that call them, so a tool added here is a
/// tool the artifact reports.
pub(crate) const OPERATIONS: &[&str] =
    &["read_file", "write_file", "edit_file", "list_dir", "search"];

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
pub fn read_file(path: &str, options: ReadOptions) -> Result<FileRead, ApiError> {
    let (offset, limit) = options.window();
    wire::lift(files::read_file(path, offset, limit)).map(wire::file_read)
}

/// Write UTF-8 text to a file, creating parent directories and replacing what is there.
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
pub fn write_file(path: &str, contents: &str) -> Result<u64, ApiError> {
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
pub fn edit_file(path: &str, old_string: &str, new_string: &str) -> Result<(), ApiError> {
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
pub fn list_dir(path: Option<&str>) -> Result<Vec<DirEntry>, ApiError> {
    wire::lift(files::list_dir(path))
        .map(|entries| entries.into_iter().map(wire::dir_entry).collect())
}

/// Search the workspace's files for a regular expression, and hand back every line that matches.
///
/// `query` is a regular expression in Rust's syntax — `foo|bar`, `fn [a-z_]+`, `(?i)todo` for a
/// case-insensitive match — matched against each line on its own, and every line it matches comes
/// back as a [`SearchMatch`] carrying the file's path, the 1-based line number and the line itself,
/// in path order and then line order. It is this sandbox's grep, and it honours ignore files:
/// whatever `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude — nested
/// files and negations included — is never scanned and never returned, `.git` itself is skipped,
/// dotfiles are searched, and none of it needs a repository to be there. A file that is not text
/// (one carrying a NUL byte) is skipped too.
///
/// A matching line longer than 200 characters is cut there and annotated in place as
/// `foo (123 more chars...)`. The result is a value for the program and places nothing in the
/// context window. A `Vec` exactly [`limit`](SearchOptions::limit) long may have been cut — there is
/// no offset to page with, so narrowing the query or the [`path`](SearchOptions::path) is what shows
/// the rest: a search says where to point a read, and is not a way of reading a file.
///
/// # Arguments
///
/// * `query` — The regular expression to match each line against, in Rust's syntax; `(?i)` makes it
///   case-insensitive.
/// * `options` — Where to search and how many matches to return;
///   `files::SearchOptions::default()` searches the whole workspace for the first 50.
///
/// # Returns
///
/// Every matching line up to the limit, in path order and then line order. Nothing matching is an
/// empty `Vec`, not a failure.
///
/// # Errors
///
/// `InvalidArgument` for a blank query, one that is not a valid pattern, or a limit of `Some(0)`, and
/// `NotFound` for a path that is not there.
#[doc(alias = "ggop:files.search")]
pub fn search(query: &str, options: SearchOptions<'_>) -> Result<Vec<SearchMatch>, ApiError> {
    wire::lift(files::search(query, options.path, options.limit))
        .map(|matches| matches.into_iter().map(wire::search_match).collect())
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
    /// The file's text, or just the requested window where the read named one.
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

/// One line a [`search`] matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchMatch {
    /// The file's path, relative to the workspace root, with `/` separators.
    ///
    /// Absolute for a search rooted outside the workspace.
    pub path: String,
    /// The 1-based line number of the match within that file.
    pub line: u32,
    /// The matching line, without its line ending.
    ///
    /// Longer than 200 characters, it is cut there and annotated in place as
    /// `foo (123 more chars...)`.
    pub text: String,
}

/// Where a [`search`] looks and how many matches it returns; [`Default`] is the whole workspace, 50 matches.
///
/// Rust has no default arguments, and the idiom it reaches for instead is a struct with a [`Default`]
/// filled in by functional-update syntax:
/// `files::SearchOptions { path: Some("src"), ..Default::default() }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SearchOptions<'a> {
    /// The directory or file to search, relative to the workspace or absolute.
    ///
    /// `None` searches the whole workspace, and a file searches that one file.
    pub path: Option<&'a str>,
    /// How many matches to return at most; `None` takes gg's default of 50.
    ///
    /// The ceiling is 200, and a larger limit is clamped to it rather than refused.
    pub limit: Option<u32>,
}

/// The window of lines a read covers. [`Default`] reads the whole file.
///
/// Both fields are honoured under every read policy. The policy decides only what an absent `limit`
/// means: its default cap under a capped policy, the end of the file under the unlimited one. An
/// absent `offset` starts at the first line.
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
