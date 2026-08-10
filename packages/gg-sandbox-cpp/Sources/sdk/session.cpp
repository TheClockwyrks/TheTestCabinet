// The **session** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/session.hpp`.

#include "gg/session.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace session {

std::vector<core::function_summary> list() { return detail::module_directory("gg::session"); }

void finish(std::string_view summary) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(summary);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_session_finish(&lowered, &err)) detail::fail(err);
}

void approve() {
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_session_approve(&err)) detail::fail(err);
}

void request_changes(std::vector<std::string> items) {
  detail::scratch scratch;
  sandbox_list_string_t lowered = scratch.list(items);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_session_request_changes(&lowered, &err)) detail::fail(err);
}

}  // namespace session

}  // namespace gg
