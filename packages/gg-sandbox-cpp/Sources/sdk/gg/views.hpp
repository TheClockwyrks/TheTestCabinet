// The **views** module: the only way material enters the agent's context window.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core.hpp"
#include "files.hpp"

namespace gg {

/// Show a file, a value, or a documentation entry in the context window.
///
/// Each view is one message, carrying the band it is charged to and the selector it is filed under.
///
/// <ggmodule>views</ggmodule>
namespace views {

/// The window of lines a file view shows, and the cut its long lines get; `{}` shows the whole file.
///
/// `max_line_chars` cuts the view's lines and leaves the returned value whole. An aggregate filled
/// in with designated initialisers:
/// `gg::views::open_file("src/main.cpp", {.max_line_chars = 200})`.
struct view_options {
  /// The 1-based line to start at; empty starts at the first line.
  std::optional<std::uint32_t> offset;
  /// How many lines to show from `offset`; empty shows to the end, or the read policy's default cap.
  std::optional<std::uint32_t> limit;
  /// Cut each line of the view longer than this many characters; empty leaves every line whole.
  ///
  /// A cut line is annotated in place as `foo (123 more chars...)`. The range is `1..=65536`, and
  /// a value outside it refuses the open.
  std::optional<std::uint32_t> max_line_chars;
};

/// Read a file and show it in the context window.
///
/// Two pages of one file are two views that coexist; re-opening the same page, or the same picture,
/// replaces what it showed. An image is shown as a picture.
///
/// The view's text body is capped at 65,536 bytes: a window carrying more is refused, naming the
/// size and the bound, and nothing is opened. `max_line_chars` cuts each line of the view longer
/// than that many characters and annotates it in place as `foo (123 more chars...)`, with the count
/// of characters dropped; the returned value and the file itself are untouched, and the cap is
/// measured after the cut.
///
/// <ggop>views.open_file</ggop>
///
/// \param path The file to open, relative to the workspace or absolute.
/// \param options The lines to show and the cut their long lines get; `{}` shows the whole file
///   with every line whole.
/// \returns the file's text window, or the picture's description.
/// \throws gg::core::api_error `not_found` for a missing path, `invalid_argument` for an offset
///   past the end of the file or a `max_line_chars` outside `1..=65536`, and `limit_exceeded` —
///   naming the size and the bound — for a text body over 65,536 bytes after the cut. Nothing is
///   opened when it fails.
files::file_read open_file(std::string_view path, views::view_options options = {});

/// Show a value the program computed, filed under `label`.
///
/// Opening the same label again replaces what it showed.
///
/// <ggop>views.open_text</ggop>
///
/// \param label What to file the view under. It may not be empty.
/// \param body What to show. An empty body is allowed.
/// \throws gg::core::api_error `invalid_argument` for an empty label, and `limit_exceeded`, naming
///   the cap, for a body or label over gg's caps.
void open_text(std::string_view label, std::string_view body);

/// Show the full documentation for one module, function or type.
///
/// A type is declared once per session, so what arrives is the declarations of the types the entry
/// refers to that have not been shown already. The documentation arrives in the next prompt under a
/// `Documentation` heading rather than in the turn that asked for it. Opening a key that is already
/// open does nothing.
///
/// <ggop>views.open_docs_view</ggop>
///
/// \param name The entry to document, by the fully-qualified name its documentation is keyed by —
///   `"gg::views::open_text"`, and a module's own path (`"gg::views"`) for a module. The bare name
///   under its module (`"open_text"`) also resolves, and is ambiguous where two modules declare the
///   same name.
/// \throws gg::core::api_error `not_found` for an unknown or unbound name.
void open_docs_view(std::string_view name);

/// Close every view carrying `selector`, freeing the tokens they occupied.
///
/// For a file that is every page of that path, for a text view the one with that label, and for the
/// results of a search the label `search results`. Closing a selector that is not open returns `0`.
/// Closing a file view forgets what was read, not what exists; closing a text view discards the
/// only copy of what it held. Documentation views are not reached from here.
///
/// <ggop>views.close</ggop>
///
/// \param selector What the view is filed under: a file's path, a text view's label, or
///   `search results`.
/// \returns how many views were closed.
/// \throws gg::core::api_error `invalid_argument` for an empty selector, and `unavailable` when
///   this run did not bind `agent-managed-context`, the capability that buys closing a view.
std::uint32_t close(std::string_view selector);

}  // namespace views

}  // namespace gg
