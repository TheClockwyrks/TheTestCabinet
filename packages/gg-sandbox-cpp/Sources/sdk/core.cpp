// The **core** module's implementation: the one type with behaviour of its own.
//
// Nothing here is model-facing — every word a model reads about these declarations is on them, in
// `gg/core.hpp`.

#include "gg/core.hpp"

#include <utility>

namespace gg {

namespace core {

tool_error::tool_error(tool_error_code code, std::string tool, std::string message)
    // gg's own sentence about a failed call: the call, the class, and what went wrong. It is gg's
    // convention rather than C++'s — the same line the ECMAScript guest's shim writes and the
    // native tool-calling path shows — so two arms whose uncaught failures read differently would
    // be two arms whose error rates a study could not compare.
    : std::runtime_error("`" + tool + "` failed (" + std::string(gg_name(code)) + "): " + message),
      code_(code),
      tool_(std::move(tool)),
      message_(std::move(message)) {}

std::string_view gg_name(tool_error_code code) noexcept {
  switch (code) {
    case tool_error_code::invalid_argument: return "invalid-argument";
    case tool_error_code::not_found: return "not-found";
    case tool_error_code::conflict: return "conflict";
    case tool_error_code::refused: return "refused";
    case tool_error_code::unavailable: return "unavailable";
    case tool_error_code::limit_exceeded: return "limit-exceeded";
    case tool_error_code::io_error: return "io-error";
    case tool_error_code::other: return "other";
  }
  return "other";
}

}  // namespace core

}  // namespace gg
