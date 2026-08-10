// The **shell** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about this function is on its
// declaration, in `gg/shell.hpp`.

#include "gg/shell.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& shell_tools() {
  static const std::vector<std::string> names{"shell"};
  return names;
}

}  // namespace detail

namespace shell {

std::vector<core::function_summary> list() { return detail::module_directory("gg::shell"); }

shell::shell_output run(std::string_view command, std::optional<double> timeout_secs) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(command);
  double timeout = timeout_secs.value_or(0.0);
  test_cabinet_gg_shell_shell_output_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_shell_shell(&lowered, timeout_secs.has_value() ? &timeout : nullptr, &ret,
                                   &err)) {
    detail::fail(err);
  }
  return detail::lift_shell_output(ret);
}

}  // namespace shell

}  // namespace gg
