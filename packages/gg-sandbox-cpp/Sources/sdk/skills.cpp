// The **skills** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about this function is on its
// declaration, in `gg/skills.hpp`.

#include "gg/skills.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& skills_tools() {
  static const std::vector<std::string> names{"read_skill"};
  return names;
}

}  // namespace detail

namespace skills {

std::string read_skill(std::string_view name) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(name);
  sandbox_string_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_skills_read_skill(&lowered, &ret, &err)) detail::fail(err);
  std::string body = detail::lift(ret);
  sandbox_string_free(&ret);
  return body;
}

}  // namespace skills

}  // namespace gg
