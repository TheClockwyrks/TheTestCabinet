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

/// Show a file, a value, or a documentation entry in the agent's own context window.
///
/// Under responses as code a whole program's output would otherwise collapse into one anonymous
/// blob, charged to one band, attributable to nothing and closable by nothing. A view restores
/// what tool calling gave for free: one message per view, carrying the band it is charged to and
/// the selector it can be closed by.
///
/// <ggmodule>views</ggmodule>
namespace views {

/// Which of the three kinds a view is.
///
/// The taxonomy is closed at three deliberately: everything on disk is a file, everything a
/// program can compute is a string, and documentation is neither, because gg holds it.
enum class view_kind {
  /// An opened file; its selector is the path.
  file,
  /// A computed value; its selector is the label it was opened under.
  text,
  /// A documentation entry; its selector is the key it was opened under.
  docs,
};

/// The window of lines a paged file view covers.
struct view_region {
  /// The 1-based first line the view shows.
  std::uint32_t offset{};
  /// How many lines it shows.
  std::uint32_t limit{};
};

/// One view open in the agent's context window.
struct open_view {
  /// Whether it is a file, text, or documentation view.
  views::view_kind kind{};
  /// What closes it.
  ///
  /// A file's path, a text view's label or `search results` for `views::close`, and for a
  /// documentation view the key `docs::close` takes.
  std::string selector;
  /// Roughly what holding it costs, in tokens.
  std::uint64_t tokens{};
  /// The line window a paged file view covers; empty for a whole-file view and for text views.
  std::optional<views::view_region> region;

  /// Close this view, freeing the tokens it occupied.
  ///
  /// A documentation view is the one this does not take away, because `views::close` does not reach
  /// that band: `docs::close(selector)` is the call for one of those.
  ///
  /// <ggop-alias>views.close</ggop-alias>
  ///
  /// \returns how many views were closed, which is `0` when it has been closed already.
  /// \throws core::tool_error `invalid_argument` when this view's `selector` is empty, which no
  ///   view gg reports ever is.
  std::uint32_t close() const;
};

/// Read a file and show it, so the program gets the bytes and the context window gets the file.
///
/// The split from `files::read_file` is the point: that call gets bytes for the program, this one
/// shows a file to the agent, so a program that reads forty files to grep them still puts nothing
/// in the window. Two pages of one file are two views that coexist, and re-opening the same page
/// replaces what it showed rather than piling up a duplicate. An image is shown as a picture, and
/// this is the only call that shows one.
///
/// Re-opening a picture that is already open replaces it rather than adding a second copy, which is
/// the same rule a page of a file follows.
///
/// <ggop>views.open_file</ggop>
///
/// \param path The file to open, relative to the workspace or absolute.
/// \param window The lines to show; `{}` shows the whole file.
/// \returns the same read `files::read_file` would have handed back.
/// \throws core::tool_error `not_found` for a missing path, and `invalid_argument` for an offset
///   past the end of the file. The read is what fails; nothing is opened when it does.
files::file_read open_file(std::string_view path, files::read_window window = {});

/// Show a value the program computed, filed under `label`.
///
/// A directory listing, a command's output, a child agent's answer and an assembled table are all
/// this. Opening the same label again replaces what it showed, so a program may refine a view in a
/// loop without piling up a copy per iteration.
///
/// <ggop>views.open_text</ggop>
///
/// \param label What to file the view under. Closing it takes this, and opening the same label
///   again replaces what it showed. It may not be empty.
/// \param body What to show. An empty body is allowed: it is how something that was being shown
///   is said to be empty now.
/// \throws core::tool_error `invalid_argument` for an empty label — a view with no selector could
///   never be closed or attributed — and `limit_exceeded`, naming the cap, for a body or label
///   over gg's caps.
void open_text(std::string_view label, std::string_view body);

/// Show the full documentation for one module, function or type — everything a search hit left out.
///
/// A type is declared once per session, so what arrives is the declarations of the types the entry
/// refers to that have not been shown already. It is a view rather than a return value — the
/// documentation arrives in the next prompt under a `Documentation` heading, exactly as a file or a
/// computed value does — so it is not available in the turn it is asked for: ask in one turn, use
/// it in the next. Opening a key that is already open does nothing at all, neither moving the view
/// nor emitting it again: this band only grows, and `docs::close` is the one call that disturbs it.
///
/// <ggop>views.open_docs_view</ggop>
///
/// \param name The entry to document, by the fully-qualified name its documentation is keyed by —
///   `"gg::files::read_file"`, and a module's own path (`"gg::files"`) for a module. The bare name
///   it is called under its module (`"read_file"`) also resolves and is a fallback rather than the
///   form to reach for: two modules are free to declare a `close`, and only the qualified name says
///   which one is meant. Whatever a search returns can be opened here.
/// \throws core::tool_error `not_found` for an unknown or unbound name.
void open_docs_view(std::string_view name);

/// Close every view carrying `selector`, freeing the tokens they occupied.
///
/// For a file that is every page of that path, for a text view the one with that label, and for the
/// results of a search the label `search results`. Closing a selector that is not open hands back
/// `0` rather than failing, so a program that tidies up unconditionally needs no guard. Closing a
/// file view forgets what was read rather than what exists; closing a text view discards the only
/// copy of what it held.
///
/// Documentation views are not reached from here. `docs::close` is what takes one away, and it is
/// bought by a capability this call is not — so a sweep that included them would hand back `0` for
/// an agent that may not close one, which reads as a selector that named nothing.
///
/// <ggop>views.close</ggop>
///
/// \param selector What the view is filed under: a file's path, a text view's label, or
///   `search results`.
/// \returns how many views were closed.
/// \throws core::tool_error `invalid_argument` for an empty selector, which names nothing rather
///   than everything — there is no call here that closes the window wholesale.
std::uint32_t close(std::string_view selector);

/// List what is open in the context window right now, with what each one costs.
///
/// Each entry carries its `kind`, the `selector` that closes it, roughly what it costs in
/// `tokens`, and — for a paged file view — the `region` it covers. What it enumerates is the context
/// window's contents, not any module's functions.
///
/// <ggop>views.current</ggop>
///
/// \returns every view open in the context window right now.
std::vector<views::open_view> current();

}  // namespace views

}  // namespace gg
