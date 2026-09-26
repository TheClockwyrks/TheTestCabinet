// The **files** module: the workspace, read and written.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "core.hpp"

namespace gg {

/// Read, write, edit, list, walk and search the files of the workspace.
///
/// Nothing here places anything in the context window.
///
/// <ggmodule>files</ggmodule>
namespace files {

/// The window of lines a read covers; `{}` reads the whole file.
///
/// An empty `limit` reads to the end of the file, or to the run's default cap where one applies.
struct read_window {
  /// The 1-based line to start at; empty starts at the first line.
  std::optional<std::uint32_t> offset;
  /// How many lines to return from `offset`; empty reads to the end.
  std::optional<std::uint32_t> limit;
};

/// A text file's window: the text, the lines it covers, and whether a byte ceiling cut it.
struct text_file {
  /// The file's text, or just the requested window where the read named one.
  std::string contents;
  /// The 1-based first line returned.
  std::uint32_t first_line{};
  /// The 1-based last line returned.
  std::uint32_t last_line{};
  /// The file's total line count, which is what says whether another page is left.
  std::uint32_t total_lines{};
  /// Whether a 256 KiB byte ceiling cut the returned text.
  bool byte_truncated{};
};

/// A picture's description; the pixels are not in the value.
struct image_file {
  /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
  std::string media_type;
  /// The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
  std::string label;
  /// The file's size in bytes.
  std::uint64_t bytes{};
  /// Whether the picture is attached to this turn to be looked at.
  bool shown{};
  /// Why it is not attached; empty when `shown` is true.
  std::optional<std::string> not_shown_reason;
};

/// What a read returned: a text file's window, or a picture's description.
///
/// A `std::variant`, narrowed with `std::get_if` or `std::get`:
///
/// ```cpp
/// const auto read = gg::files::read_file("logo.png");
/// const auto* text = std::get_if<gg::files::text_file>(&read);
/// const std::string body = text ? text->contents : std::get<gg::files::image_file>(read).label;
/// ```
using file_read = std::variant<files::text_file, files::image_file>;

/// What a directory entry is.
enum class entry_kind {
  /// An ordinary file.
  file,
  /// A directory, which can be listed in turn.
  directory,
  /// Everything that is neither, a symlink among them.
  other,
};

/// Where a search looks and how many matches it returns; `{}` is the whole workspace, 50 matches.
///
/// An aggregate filled in with designated initialisers:
/// `gg::files::search("(?i)todo", {.path = "src", .limit = 100})`.
struct search_options {
  /// The directory or file to search, relative to the workspace or absolute.
  ///
  /// Empty searches the whole workspace, and a file searches that one file.
  std::optional<std::string_view> path;
  /// How many matches to return at most; empty takes gg's default of 50.
  ///
  /// The ceiling is 200, and a larger limit is clamped to it rather than refused.
  std::optional<std::uint32_t> limit;
};

/// Where a tree is rooted and how deep it is walked; `{}` is the workspace root, two levels.
///
/// An aggregate filled in with designated initialisers:
/// `gg::files::tree({.path = "src", .depth = 3})`.
struct tree_options {
  /// The directory to walk, relative to the workspace or absolute.
  ///
  /// Empty walks the workspace root.
  std::optional<std::string_view> path;
  /// How many levels of children below the root to render; empty takes gg's default of 2.
  ///
  /// The ceiling is 10, and a larger depth is clamped to it rather than refused.
  std::optional<std::uint32_t> depth;
};

/// One line a search matched.
struct search_match {
  /// The file's path, relative to the workspace root, with `/` separators.
  ///
  /// Absolute for a search rooted outside the workspace.
  std::string path;
  /// The 1-based line number of the match within that file.
  std::uint32_t line{};
  /// The matching line, without its line ending.
  ///
  /// Longer than 200 characters, it is cut there and annotated in place as
  /// `foo (123 more chars...)`.
  std::string text;
};

/// One entry a directory listing found.
struct dir_entry {
  /// The entry's bare name, with no directory part.
  ///
  /// Joining it with the directory that was listed gives a path.
  std::string name;
  /// What the entry is.
  files::entry_kind kind{};
};

/// Read a file, as either a text window or a picture's description.
///
/// Which of the two comes back is detected from the file's bytes, never from the extension. A
/// relative path resolves against the workspace; an absolute one is read as given, so anything
/// else in this container is readable.
///
/// The value goes to the program and nothing is placed in the context window; a picture is
/// described rather than shown.
///
/// <ggop>files.read_file</ggop>
///
/// \param path The file to read, relative to the workspace or absolute.
/// \param window The lines to read; `{}` reads the whole file.
/// \returns the file's text window, or the picture's description.
/// \throws gg::core::api_error `not_found` for a missing path.
files::file_read read_file(std::string_view path, files::read_window window = {});

/// Write UTF-8 text to a file, creating parent directories and replacing whatever was there.
///
/// <ggop>files.write_file</ggop>
///
/// \param path Where to write, relative to the workspace or absolute. Parent directories are
///   created.
/// \param contents The UTF-8 text to write. It replaces the file entirely.
/// \returns how many bytes were written.
/// \throws gg::core::api_error `invalid_argument` for an empty path, and `io_error` when creating the
///   parent directories or the write itself failed.
std::uint64_t write_file(std::string_view path, std::string_view contents);

/// Replace the one exact occurrence of `old_string` in a file with `new_string`.
///
/// <ggop>files.edit_file</ggop>
///
/// \param path The file to edit.
/// \param old_string The exact text to find, whitespace included. It must appear exactly once.
/// \param new_string The text to put in its place. An empty string deletes the match.
/// \throws gg::core::api_error `not_found` when the text does not appear, and `conflict` — with the
///   number of matches — when it appears more than once.
void edit_file(std::string_view path, std::string_view old_string, std::string_view new_string);

/// List a directory, sorted by name; leaving the path out lists the workspace root.
///
/// Each entry carries a bare `name`, which joins with the listed directory, and its `kind`. An
/// empty directory is an empty vector rather than a failure.
///
/// <ggop>files.list_dir</ggop>
///
/// \param path The directory to list, relative to the workspace or absolute; empty lists the
///   workspace root.
/// \returns the directory's entries, sorted by name.
/// \throws gg::core::api_error `not_found` for a directory that is not there, and `invalid_argument`
///   for a path that is given but empty.
std::vector<files::dir_entry> list_dir(std::optional<std::string_view> path = std::nullopt);

/// Render the tree beneath a directory, skipping everything the ignore files exclude.
///
/// One block of text: the root itself unnamed, each level indented two further spaces than its
/// parent, every level in path order, and directories suffixed `/`. A root with nothing beneath it
/// renders as `(empty directory)`.
///
/// `depth` counts levels of children below the root, so `1` is the root's own entries. A directory
/// sitting at the bound is suffixed with how many entries it holds that were not walked, as
/// `assets/ (12 entries not shown)`.
///
/// Whatever `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude —
/// nested files and negations included — is never walked and never rendered, `.git` itself is
/// skipped, dotfiles are rendered, symbolic links are not followed, and none of it needs a
/// repository to be there.
///
/// The rendering is bounded at 1000 lines and 16 KiB, whichever binds first, and a result cut by
/// either ends with a line saying so.
///
/// <ggop>files.tree</ggop>
///
/// \param options Where to root the tree and how deep to walk it; `{}` walks the workspace root two
///   levels deep.
/// \returns the rendered tree.
/// \throws gg::core::api_error `not_found` for a path that is not there, and `invalid_argument` for
///   a path that is not a directory or a depth of `0`.
std::string tree(files::tree_options options = {});

/// Search the workspace's files for a regular expression, and hand back every line that matches.
///
/// The workspace's grep. `query` is a regular expression in Rust's syntax — `foo|bar`,
/// `fn [a-z_]+`, `(?i)todo` — matched against each line on its own, and every match carries the
/// file's path, the 1-based line number and the line itself. Whatever `.gitignore`, `.ignore`,
/// `.git/info/exclude` and the global ignore file exclude — nested files and negations included —
/// is never scanned and never returned, `.git` itself is skipped, dotfiles are searched, and none
/// of it needs a repository to be there. A file carrying a NUL byte is skipped.
///
/// A matching line longer than 200 characters is cut there and annotated in place as
/// `foo (123 more chars...)`. The result is a value and places nothing in the context window. There
/// is no offset: a vector exactly `limit` long may have been cut.
///
/// <ggop>files.search</ggop>
///
/// \param query The regular expression to match each line against, in Rust's syntax; `(?i)` makes
///   it case-insensitive.
/// \param options Where to search and how many matches to return; `{}` searches the whole workspace
///   for the first 50.
/// \returns every matching line up to the limit, in path order and then line order; nothing
///   matching is an empty vector, not a failure.
/// \throws gg::core::api_error `invalid_argument` for a blank query, one that is not a valid
///   pattern, or a limit of `0`, and `not_found` for a path that is not there.
std::vector<files::search_match> search(std::string_view query, files::search_options options = {});

}  // namespace files

}  // namespace gg
