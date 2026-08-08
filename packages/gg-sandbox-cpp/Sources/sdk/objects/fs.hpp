#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../options.hpp"
#include "../types.hpp"

namespace gg {

/// read, write, and edit workspace files
///
/// Reading is the cheap direction of this sandbox and writing is the expensive one, so a program
/// that reads a dozen files to decide what to change is doing the right thing, while one that
/// rewrites forty large files in a single turn will exhaust its fuel budget.
///
/// Nothing here puts anything in your context window. `view::open_file` is the call that shows a
/// file to *you*.
namespace fs {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Read a file, handing back a `text_file` or an `image_file` — the format is detected from the
/// file's bytes, never its extension.
///
/// This gets bytes for your PROGRAM and puts NOTHING in your context window; `view::open_file` is
/// the call that shows the file to you. A relative path resolves against your workspace; an
/// absolute one is read as given, so anything in this container — an offloaded command's output
/// under `/tmp/gg-shell`, say — is readable.
///
/// Reading an IMAGE describes it to your program — label, media type, byte size — and does not
/// show it to YOU: the pixels reach neither your program nor your context window, so a file you
/// only `fs::read_file` is a file you have not looked at. `view::open_file` is the one way to
/// actually see a picture.
///
/// Narrow the two alternatives the way you narrow any `std::variant`:
///
/// ```cpp
/// const auto read = fs::read_file("logo.png");
/// if (const auto* text = std::get_if<text_file>(&read)) {
///   view::open_text("logo", text->contents);
/// } else {
///   view::open_text("logo", std::get<image_file>(read).label);
/// }
/// ```
///
/// \param path The file to read. Relative to your workspace, or absolute for anything else in
///   this container.
/// \param window The lines to read; leave it out to read the whole file.
/// \returns the file's text window, or the picture's description.
/// \throws tool_error `not_found` for a missing path.
file_read read_file(std::string_view path, read_window window = {});

/// Read a text file and hand back its contents directly — `fs::read_file` without the narrowing,
/// for the common case.
///
/// It takes the same window. Reading is the cheap direction of this sandbox, so a program that
/// reads a dozen files to decide what to change is doing the right thing.
///
/// \param path The file to read. Relative to your workspace, or absolute.
/// \param window The lines to read; leave it out to read the whole file.
/// \returns the file's text.
/// \throws tool_error `invalid_argument` when the path names a picture; use `fs::read_file` to
///   inspect those, and `view::open_file` to look at one.
std::string read_text_file(std::string_view path, read_window window = {});

/// Write UTF-8 text to a file, creating parent directories and replacing any existing file, and
/// hand back the number of bytes written.
///
/// Writing is the expensive direction of the sandbox — rewriting more than a few dozen large files
/// in one program exhausts its fuel budget, so split a large rewrite across several turns.
///
/// \param path Where to write. Relative to your workspace, or absolute. Parent directories are
///   created for you.
/// \param contents The UTF-8 text to write. It replaces the file entirely.
/// \returns how many bytes were written.
std::uint64_t write_file(std::string_view path, std::string_view contents);

/// Replace the one exact occurrence of `old_string` in a file with `new_string`.
///
/// Widen the surrounding context until the match is unique rather than counting occurrences.
///
/// \param path The file to edit.
/// \param old_string The exact text to find, including its whitespace. It must appear exactly
///   once.
/// \param new_string The text to put in its place. An empty string deletes the match.
/// \throws tool_error `not_found` when the text does not appear, and `conflict` — with the number
///   of matches — when it appears more than once.
void edit_file(std::string_view path, std::string_view old_string, std::string_view new_string);

/// List a directory, sorted by name; leaving the path out lists your workspace root.
///
/// Each entry carries a bare `name` — join it with the directory you listed — and its `kind`. An
/// empty directory is an empty vector, not a failure.
///
/// \param path The directory to list, relative to your workspace or absolute. Leave it out to
///   list your workspace root.
/// \returns the directory's entries, sorted by name.
std::vector<dir_entry> list_dir(std::optional<std::string_view> path = std::nullopt);

}  // namespace fs

}  // namespace gg
