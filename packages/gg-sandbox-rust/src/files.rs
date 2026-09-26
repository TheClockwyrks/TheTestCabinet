//! Read, write, edit, list, walk and search the files of the workspace.
//!
//! Nothing here places anything in the context window.

use crate::bindings::test_cabinet::gg::files;
use crate::core::ApiError;
use crate::wire;

/// The gg tools this module dispatches, which is part of what the component answers
/// `bound-operations` with. Declared beside the functions that call them, so a tool added here is a
/// tool the artifact reports.
pub(crate) const OPERATIONS: &[&str] = &[
    "read_file",
    "write_file",
    "edit_file",
    "list_dir",
    "tree",
    "search",
];

/// Read a file, as either a [`FileRead::Text`] or a [`FileRead::Image`].
///
/// Which of the two comes back is detected from the file's bytes, never from the extension. The
/// enum is closed, so a `match` needs no catch-all:
///
/// ```ignore
/// match files::read_file("logo.png", files::ReadOptions::default())? {
///     files::FileRead::Text(text) => text.contents,
///     files::FileRead::Image(picture) => picture.label,
/// };
/// ```
///
/// A relative path resolves against the workspace; an absolute one is read as given. The result is
/// returned to the program and nothing is placed in the context window; a picture is described
/// rather than shown.
///
/// # Arguments
///
/// * `path` — The file to read, relative to the workspace or absolute.
/// * `options` — The window of lines to read; `files::ReadOptions::default()` reads the whole file.
///
/// # Returns
///
/// The window of lines `options` asked for, or — when the bytes are a picture — gg's description of
/// it.
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
/// into.
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

/// Render the tree beneath a directory, skipping everything the ignore files exclude.
///
/// One block of text: the root itself unnamed, each level indented two further spaces than its
/// parent, every level in path order, and directories suffixed `/`. A root with nothing beneath it
/// renders as `(empty directory)`.
///
/// [`depth`](TreeOptions::depth) counts levels of children below the root, so `1` is the root's own
/// entries. A directory sitting at the bound is suffixed with how many entries it holds that were
/// not walked, as `assets/ (12 entries not shown)`.
///
/// What `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude — nested
/// files and negations included — is never walked and never rendered, `.git` itself is skipped,
/// dotfiles are rendered, symbolic links are not followed, and none of it needs a repository to be
/// there.
///
/// The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut by
/// either ends with a line saying so.
///
/// # Arguments
///
/// * `options` — Where to root the tree and how deep to walk it; `files::TreeOptions::default()`
///   walks the workspace root two levels deep.
///
/// # Returns
///
/// The rendered tree.
///
/// # Errors
///
/// `NotFound` for a path that is not there, and `InvalidArgument` for a path that is not a directory
/// or a depth of `Some(0)`.
#[doc(alias = "ggop:files.tree")]
pub fn tree(options: TreeOptions<'_>) -> Result<String, ApiError> {
    wire::lift(files::tree(options.path, options.depth))
}

/// Search the workspace's files for a regular expression, and hand back every line that matches.
///
/// A `grep` over the workspace. `query` is a regular expression in Rust's syntax — `foo|bar`,
/// `fn [a-z_]+`, `(?i)todo` for a case-insensitive match — matched against each line on its own.
/// Every line it matches comes back as a [`SearchMatch`] carrying the file's path, the 1-based line
/// number and the line itself, in path order and then line order.
///
/// What `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude — nested
/// files and negations included — is never scanned, `.git` itself is skipped, dotfiles are searched,
/// and none of it needs a repository to be there. A file carrying a NUL byte is skipped.
///
/// A matching line longer than 200 characters is cut there and annotated in place as
/// `foo (123 more chars...)`. The result is returned to the program and places nothing in the
/// context window. There is no offset: a `Vec` exactly [`limit`](SearchOptions::limit) long may have
/// been cut.
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
/// Image bytes never enter the program; gg attaches the picture to the turn instead.
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
/// Fields left out are taken from [`Default`]:
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

/// Where a [`tree`] is rooted and how deep it is walked; [`Default`] is the workspace root, two
/// levels.
///
/// Fields left out are taken from [`Default`]:
/// `files::TreeOptions { depth: Some(3), ..Default::default() }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TreeOptions<'a> {
    /// The directory to walk, relative to the workspace or absolute.
    ///
    /// `None` walks the workspace root.
    pub path: Option<&'a str>,
    /// How many levels of children below the root to render; `None` takes gg's default of 2.
    ///
    /// The ceiling is 10, and a larger depth is clamped to it rather than refused.
    pub depth: Option<u32>,
}

/// The window of lines a read covers. [`Default`] reads the whole file.
///
/// Both fields are honoured under every read policy. The policy decides only what an absent `limit`
/// means: its default cap under a capped policy, the end of the file under the unlimited one. An
/// absent `offset` starts at the first line.
///
/// Fields left out are taken from [`Default`]:
/// `files::ReadOptions { limit: Some(40), ..Default::default() }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReadOptions {
    /// The 1-based line to start at.
    pub offset: Option<u32>,
    /// How many lines to return from `offset`.
    pub limit: Option<u32>,
}
