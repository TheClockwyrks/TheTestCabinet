// The implementation of the declarations that belong to no capability module.
//
// Nothing here is model-facing and nothing here is catalogued. See `runtime.hpp`.

#include "runtime.hpp"

#include "wire.hpp"

namespace gg {

void log(std::string_view line) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(line);
  test_cabinet_gg_feedback_log(&lowered);
}

std::vector<std::string> bound_tool_names() {
  std::vector<std::string> names;
  for (const std::vector<std::string>* module :
       {&detail::files_tools(), &detail::shell_tools(), &detail::skills_tools(),
        &detail::memories_tools(), &detail::tasks_tools(), &detail::board_tools(),
        &detail::context_tools(), &detail::delegation_tools()}) {
    names.insert(names.end(), module->begin(), module->end());
  }
  return names;
}

}  // namespace gg
