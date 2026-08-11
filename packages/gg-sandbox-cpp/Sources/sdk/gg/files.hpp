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

/// Read, write, edit and list the files of the workspace.
///
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is well shaped, while one that rewrites forty
/// large files in a single turn will exhaust its fuel budget.
///
/// Nothing here places anything in the agent's context window. `views::open_file` is the call that
/// does.
///
/// <ggmodule>files</ggmodule>
namespace files {

/// The window of lines a read covers; `{}` reads the whole file.
///
/// Both fields are honoured only under a capped read policy; under the unlimited policy the whole
/// file comes back and both are ignored. The system prompt says which policy a run uses.
struct read_window {
  /// The 1-based line to start at; empty starts at the first line.
  std::optional<std::uint32_t> offset;
  /// How many lines to return from `offset`; empty reads to the end.
  std::optional<std::uint32_t> limit;
};

/// A text file's window, as the `files::text_file` alternative of a read carries it.
struct text_file {
  /// The file's text, or just the requested window under a capped read policy.
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

/// A picture's description, as the `files::image_file` alternative of a read carries it.
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
/// const auto read = files::read_file("logo.png");
/// if (const auto* text = std::get_if<files::text_file>(&read)) {
///   views::open_text("logo", text->contents);
/// } else {
///   views::open_text("logo", std::get<files::image_file>(read).label);
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

/// One entry a directory listing found.
struct dir_entry {
  /// The entry's bare name, with no directory part.
  ///
  /// Joining it with the directory that was listed gives a path.
  std::string name;
  /// What the entry is.
  files::entry_kind kind{};
};

/// Read a file, as either a `files::text_file` or a `files::image_file`.
///
/// Which of the two comes back is detected from the file's bytes, never from the extension, so a
/// mislabelled picture is still a picture. A relative path resolves against the workspace; an
/// absolute one is read as given, so anything else in this container — an offloaded command's
/// output under `/tmp/gg-shell`, say — is readable.
///
/// This call hands bytes to the program and places nothing in the context window. Reading a
/// picture describes it and shows nothing, so a file only read here is a file nobody has looked
/// at; `views::open_file` is the one call that shows one.
///
/// <ggop>files.read_file</ggop>
///
/// \param path The file to read, relative to the workspace or absolute.
/// \param window The lines to read; `{}` reads the whole file.
/// \returns the file's text window, or the picture's description.
/// \throws core::tool_error `not_found` for a missing path.
files::file_read read_file(std::string_view path, files::read_window window = {});

/// Read a text file and hand back its contents directly, without the narrowing.
///
/// It takes the same window as `files::read_file` and is the shape a program wants whenever the
/// path is known to be text.
///
/// <ggop>files.read_text_file</ggop>
///
/// \param path The file to read, relative to the workspace or absolute.
/// \param window The lines to read; `{}` reads the whole file.
/// \returns the file's text.
/// \throws core::tool_error `invalid_argument` when the path names a picture, which
///   `files::read_file` describes and `views::open_file` shows.
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
/// \throws core::tool_error `invalid_argument` for an empty path, and `io_error` when creating the
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
/// \throws core::tool_error `not_found` when the text does not appear, and `conflict` — with the
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
/// \throws core::tool_error `not_found` for a directory that is not there, and `invalid_argument`
///   for a path that is given but empty.
std::vector<files::dir_entry> list_dir(std::optional<std::string_view> path = std::nullopt);

}  // namespace files

}  // namespace gg
