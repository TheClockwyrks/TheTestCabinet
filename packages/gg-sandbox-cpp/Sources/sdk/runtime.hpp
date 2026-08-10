// The declarations that belong to **no capability module**: the operator log, the drift gate's
// answer, and the one paragraph every module's `list()` copies.
//
// Nothing here is catalogued, and that is the rule rather than an oversight: this arm catalogues
// exactly the declarations inside a capability module that name a gg operation, so a declaration
// that names none stays out of a model's surface by construction.

#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "gg/core.hpp"

namespace gg {

/// Write one line to the run's operator log.
///
/// It is this arm's `console.log`: a channel the run's operator reads, capped by the host, and
/// never shown back to the model. `std::printf` and `std::fputs` reach the same place, because
/// this arm's guest has a real WASI standard output, but they are the C library's and this is the
/// name that says where the line goes.
///
/// It is deliberately not in the signature catalogue, on the same terms every other arm's
/// `console.log` is not: the catalogue describes the capability modules, and this belongs to none
/// of them.
///
/// \param line What to write. One line; gg caps how much of it is kept.
void log(std::string_view line);

/// **Every gg tool this SDK binds**, gathered from the modules that dispatch them.
///
/// It is what gg's shell answers `bound-tools` with, and gg's drift gate compares that answer with
/// its own `ALL_TOOL_NAMES`. Not model-facing and not catalogued: a program has the functions
/// themselves.
std::vector<std::string> bound_tool_names();

namespace detail {

/// List the functions this module offers, each with a one-line summary.
///
/// Only the functions this run actually bound are returned, so the directory never names a call
/// the program cannot make. One function's full signature, argument descriptions and types are
/// opened as a view with `views::open_docs_view`.
///
/// \param module The module whose directory to read, by the path it is documented under.
/// \returns the functions this module really bound, each with its one-line summary.
///
// NOT REACHABLE FROM A PROGRAM, and that is the point of it being here. C++ has no protocol
// extension and no macro that can carry a doc comment (a comment inside a macro body is gone
// before the macro is expanded), so the twelve `list()` declarations cannot share one written
// paragraph the way Swift's protocol default or Rust's `macro_rules!` do. What they share instead
// is this declaration: each module's `list()` carries a one-line `\copydoc` of it, and the
// reflector resolves that command, so the words a model reads about `list` are written exactly
// once and every module's directory is the same function.
std::vector<core::function_summary> module_directory(std::string_view module);

}  // namespace detail

}  // namespace gg
