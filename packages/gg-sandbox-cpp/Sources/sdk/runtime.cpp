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

std::vector<std::string> bound_operation_names() {
  std::vector<std::string> names;
  for (const std::vector<std::string>* module :
       {&detail::files_operations(), &detail::shell_operations(), &detail::skills_operations(),
        &detail::memories_operations(), &detail::tasks_operations(), &detail::board_operations(),
        &detail::context_operations(), &detail::delegation_operations()}) {
    names.insert(names.end(), module->begin(), module->end());
  }
  return names;
}

}  // namespace gg
