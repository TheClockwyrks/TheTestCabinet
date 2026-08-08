// The two functions that belong to **no** API object, and the one that belongs to all of them.

#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "types.hpp"

namespace gg {

/// Write one line to the run's **operator** log.
///
/// It is this arm's `console.log`: the channel a program uses to say something to whoever is
/// watching the run, capped by the host and never shown back to the model. Showing something to
/// **yourself** is `view::open_text`, which is a view — attributable, closable, and in your next
/// prompt.
///
/// `std::printf` and `std::fputs` work too and go to the same place — this arm's guest has a real
/// WASI standard output — but they are the C library's, and `gg::log` is the name that says where
/// the line goes. Write `gg::log(…)` where a program of your own has defined a `log`; the bare
/// name also resolves to this one, because `<cmath>`'s `log` takes a number and this takes text.
///
/// It is deliberately **not** in the signature catalogue, on the same terms every other arm's
/// `console.log` is not: the catalogue describes the API objects, and this belongs to none of them.
///
/// \param line What to write. One line; gg caps how much of it is kept.
void log(std::string_view line);

/// **Every gg tool this SDK binds**, gathered from the objects that dispatch them.
///
/// It is what gg's shell answers `bound-tools` with, and gg's drift gate compares that answer with
/// its own `ALL_TOOL_NAMES`. Not model-facing and not catalogued: a program has the functions
/// themselves.
std::vector<std::string> bound_tool_names();

namespace detail {

/// List the functions available on this API object, each with a one-line summary.
///
/// Only the functions this run actually bound are returned, so the directory never names a call
/// your program cannot make. Open a view of one function's full signature, argument descriptions
/// and types with `view::open_docs_view`.
///
/// \returns the functions this object really bound, each with its one-line summary.
///
// NOT REACHABLE FROM A PROGRAM, and that is the point of it being here. C++ has no protocol
// extension and no macro that can carry a doc comment (a comment inside a macro body is gone
// before the macro is expanded), so the twelve `list()` declarations cannot share one written
// paragraph the way Swift's protocol default or Rust's `macro_rules!` do. What they share instead
// is this declaration: each object's `list()` carries a one-line `\copydoc` of it, and the
// reflector resolves that command, so the words a model reads about `list` are written exactly
// once and every object's directory is the same function.
std::vector<function_summary> api_object_list(std::string_view object);

}  // namespace detail

}  // namespace gg
