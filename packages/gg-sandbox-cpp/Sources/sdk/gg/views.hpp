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
/// the selector it is filed under.
///
/// <ggmodule>views</ggmodule>
namespace views {

/// The window of lines a file view shows, and the cut its long lines get; `{}` shows the whole file.
///
/// `offset` and `limit` are the same window a read takes, honoured under every read policy; the
/// policy decides only what an empty `limit` means. `max_line_chars` is the view's own: it cuts the
/// lines the *agent* sees and leaves the value the program gets whole. An aggregate filled in with
/// designated initialisers: `gg::views::open_file("src/main.cpp", {.max_line_chars = 200})`.
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

/// Read a file and show it, so the program gets the bytes and the context window gets the file.
///
/// The split from `gg::files::read_file` is the point: that call gets bytes for the program, this one
/// shows a file to the agent, so a program that reads forty files to grep them still puts nothing
/// in the window. Two pages of one file are two views that coexist, and re-opening the same page
/// replaces what it showed rather than piling up a duplicate. An image is shown as a picture, and
/// this is the only call that shows one.
///
/// Re-opening a picture that is already open replaces it rather than adding a second copy, which is
/// the same rule a page of a file follows.
///
/// The view's text body is held to the same 65,536-byte cap a text view's body is: a window that
/// would carry more is refused, naming the size and the bound, and nothing is opened — never a
/// truncation. The program narrows the window with `offset`/`limit`, or cuts the file's long lines
/// with `max_line_chars`: set, each line of the *view* longer than that many characters is cut
/// there and annotated in place as `foo (123 more chars...)`, with the count of characters dropped.
/// The cut is the view's alone — the value this returns and the file itself are untouched — and the
/// cap is measured against the body after it. Left empty, lines arrive whole.
///
/// <ggop>views.open_file</ggop>
///
/// \param path The file to open, relative to the workspace or absolute.
/// \param options The lines to show and the cut their long lines get; `{}` shows the whole file
///   with every line whole.
/// \returns the same read `gg::files::read_file` would have handed back, long lines and all.
/// \throws gg::core::api_error `not_found` for a missing path, `invalid_argument` for an offset
///   past the end of the file or a `max_line_chars` outside `1..=65536`, and `limit_exceeded` —
///   naming the size and the bound — for a text body over 65,536 bytes after the cut. The read is
///   what fails; nothing is opened when it does.
files::file_read open_file(std::string_view path, views::view_options options = {});

/// Show a value the program computed, filed under `label`.
///
/// A directory listing, a command's output, a child agent's answer and an assembled table are all
/// this. Opening the same label again replaces what it showed, so a program may refine a view in a
/// loop without piling up a copy per iteration.
///
/// <ggop>views.open_text</ggop>
///
/// \param label What to file the view under. Opening the same label again replaces what it showed.
///   It may not be empty.
/// \param body What to show. An empty body is allowed: it is how something that was being shown
///   is said to be empty now.
/// \throws gg::core::api_error `invalid_argument` for an empty label — a view with no selector could
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
/// nor emitting it again.
///
/// <ggop>views.open_docs_view</ggop>
///
/// \param name The entry to document, by the fully-qualified name its documentation is keyed by —
///   `"gg::views::open_text"`, and a module's own path (`"gg::views"`) for a module. The bare name
///   it is called under its module (`"open_text"`) also resolves and is a fallback rather than the
///   form to reach for: two modules are free to declare a `close`, and only the qualified name says
///   which one is meant. Whatever a search returns can be opened here.
/// \throws gg::core::api_error `not_found` for an unknown or unbound name.
void open_docs_view(std::string_view name);

/// Close every view carrying `selector`, freeing the tokens they occupied.
///
/// For a file that is every page of that path, for a text view the one with that label, and for the
/// results of a search the label `search results`. Closing a selector that is not open hands back
/// `0` rather than failing, so a program that tidies up unconditionally needs no guard. Closing a
/// file view forgets what was read rather than what exists; closing a text view discards the only
/// copy of what it held.
///
/// Documentation views are not reached from here: taking one away is bought by a capability of its
/// own, `docview-close` — so a sweep that included them would hand back `0` for an agent that may
/// not close one, which reads as a selector that named nothing.
///
/// <ggop>views.close</ggop>
///
/// \param selector What the view is filed under: a file's path, a text view's label, or
///   `search results`.
/// \returns how many views were closed.
/// \throws gg::core::api_error `invalid_argument` for an empty selector, which names nothing rather
///   than everything — there is no call here that closes the window wholesale — and `unavailable`
///   for an agent whose run did not buy `agent-managed-context`, the capability that buys closing
///   a view.
std::uint32_t close(std::string_view selector);

}  // namespace views

}  // namespace gg
