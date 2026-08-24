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

/// Read, write, edit, list and search the files of the workspace.
///
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is well shaped, while one that rewrites forty
/// large files in a single turn will exhaust its fuel budget.
///
/// Nothing here places anything in the agent's context window: showing something is what the
/// `gg::views` module is for.
///
/// <ggmodule>files</ggmodule>
namespace files {

/// The window of lines a read covers; `{}` reads the whole file.
///
/// Both fields are honoured under every read policy. The policy decides only what an empty `limit`
/// means: its default cap under a capped policy, the end of the file under the unlimited one.
struct read_window {
  /// The 1-based line to start at; empty starts at the first line.
  std::optional<std::uint32_t> offset;
  /// How many lines to return from `offset`; empty reads to the end.
  std::optional<std::uint32_t> limit;
};

/// A text file's window, as the `gg::files::text_file` alternative of a read carries it.
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

/// A picture's description, as the `gg::files::image_file` alternative of a read carries it.
///
/// The pixels are not here and never enter the program: gg attaches the picture to the turn
/// instead, which is what `shown` reports.
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
/// A picture is a different kind of thing from text, so it is a different alternative rather than
/// a string that happens to be binary — a program that treats an image as text is caught by the
/// `std::get_if` instead of silently writing an empty string somewhere. It is a `std::variant`,
/// which is what C++ has for a value that is exactly one of two things, so it narrows the way any
/// other does:
///
/// ```cpp
/// const auto read = gg::files::read_file("logo.png");
/// if (const auto* text = std::get_if<gg::files::text_file>(&read)) {
///   gg::views::open_text("logo", text->contents);
/// } else {
///   gg::views::open_text("logo", std::get<gg::files::image_file>(read).label);
/// }
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
/// An aggregate filled in with designated initialisers, which is what C++ offers in place of named
/// arguments: `gg::files::search("(?i)todo", {.path = "src", .limit = 100})`.
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

/// Read a file, as either a `gg::files::text_file` or a `gg::files::image_file`.
///
/// Which of the two comes back is detected from the file's bytes, never from the extension, so a
/// mislabelled picture is still a picture. A relative path resolves against the workspace; an
/// absolute one is read as given, so anything else in this container — an offloaded command's
/// output under `/tmp/gg-shell`, say — is readable.
///
/// This call hands bytes to the program and places nothing in the context window. Reading a
/// picture describes it and shows nothing, so a file only read here is a file nobody has looked
/// at; `gg::views::open_file` is the one call that shows one.
///
/// <ggop>files.read_file</ggop>
///
/// \param path The file to read, relative to the workspace or absolute.
/// \param window The lines to read; `{}` reads the whole file.
/// \returns the file's text window, or the picture's description.
/// \throws gg::core::api_error `not_found` for a missing path.
files::file_read read_file(std::string_view path, files::read_window window = {});

/// Read a text file and hand back its contents directly, without the narrowing.
///
/// It takes the same window as `gg::files::read_file` and is the shape a program wants whenever the
/// path is known to be text.
///
/// <ggop>files.read_text_file</ggop>
///
/// \param path The file to read, relative to the workspace or absolute.
/// \param window The lines to read; `{}` reads the whole file.
/// \returns the file's text.
/// \throws gg::core::api_error `invalid_argument` when the path names a picture, which
///   `gg::files::read_file` describes and `gg::views::open_file` shows.
std::string read_text_file(std::string_view path, files::read_window window = {});

/// Write UTF-8 text to a file, creating parent directories and replacing whatever was there.
///
/// Writing is the expensive direction of this sandbox: rewriting more than a few dozen large files
/// in one program exhausts its fuel budget, so a large rewrite is split across several turns.
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
/// Widening the surrounding text until the match is unique is the way to reach a repeated line,
/// rather than counting occurrences.
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

/// Search the workspace's files for a regular expression, and hand back every line that matches.
///
/// `query` is a regular expression in Rust's syntax — `foo|bar`, `fn [a-z_]+`, `(?i)todo` for a
/// case-insensitive match — matched against each line on its own, and every line it matches comes
/// back as a `gg::files::search_match` carrying the file's path, the 1-based line number and the
/// line itself, in path order and then line order. It is this sandbox's grep, and it honours ignore
/// files: whatever `.gitignore`, `.ignore`, `.git/info/exclude` and the global ignore file exclude
/// — nested files and negations included — is never scanned and never returned, `.git` itself is
/// skipped, dotfiles are searched, and none of it needs a repository to be there. A file that is
/// not text (one carrying a NUL byte) is skipped too.
///
/// A matching line longer than 200 characters is cut there and annotated in place as
/// `foo (123 more chars...)`. The result is a value for the program and places nothing in the
/// context window. A vector exactly `limit` long may have been cut — there is no offset to page
/// with, so narrowing the query or the path is what shows the rest: a search says where to point a
/// read, and is not a way of reading a file.
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
