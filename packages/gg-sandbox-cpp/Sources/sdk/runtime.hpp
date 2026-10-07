// The declarations that belong to **no capability module**: the operator log and the drift gate's
// answer.
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
/// It is what gg's shell answers `bound-operations` with, and gg's drift gate compares that
/// answer with its own `ALL_TOOL_NAMES`. Not model-facing and not catalogued: a program has the
/// functions themselves.
std::vector<std::string> bound_operation_names();

}  // namespace gg
