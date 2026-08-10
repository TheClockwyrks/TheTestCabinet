// The **programs** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/programs.hpp`.

#include "gg/programs.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace programs {

std::vector<core::function_summary> list() { return detail::module_directory("gg::programs"); }

std::vector<programs::program_summary> history() {
  test_cabinet_gg_programs_list_program_summary_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_programs_history(&ret, &err)) detail::fail(err);
  std::vector<programs::program_summary> summaries =
      detail::lift_each(ret.ptr, ret.len, detail::lift_program_summary);
  test_cabinet_gg_programs_list_program_summary_free(&ret);
  return summaries;
}

std::string get(std::optional<std::uint32_t> turn) {
  std::uint32_t which = turn.value_or(0);
  sandbox_string_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_programs_get(turn.has_value() ? &which : nullptr, &ret, &err)) {
    detail::fail(err);
  }
  std::string source = detail::lift(ret);
  sandbox_string_free(&ret);
  return source;
}

void rerun(std::string_view source) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(source);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_programs_rerun(&lowered, &err)) detail::fail(err);
}

// The member function the summary offers, which is the same capability reached from the value that
// already carries the turn.
std::string program_summary::source() const { return programs::get(turn); }

}  // namespace programs

}  // namespace gg
