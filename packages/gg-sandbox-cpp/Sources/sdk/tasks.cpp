// The **tasks** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/tasks.hpp`.

#include "gg/tasks.hpp"

#include <utility>

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& tasks_operations() {
  static const std::vector<std::string> names{"add_task", "update_task", "set_blocked_by",
                                              "complete_task", "remove_task"};
  return names;
}

}  // namespace detail

namespace tasks {

tasks::task_usage add_task(std::string_view id, std::string_view title,
                           tasks::task_options options) {
  detail::scratch scratch;
  test_cabinet_gg_tasks_task_input_t input{};
  input.id = scratch.str(id);
  input.title = scratch.str(title);
  input.description = scratch.opt(options.description);
  input.blocked_by = scratch.list(options.blocked_by);
  test_cabinet_gg_tasks_task_usage_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_tasks_add_task(&input, &ret, &err)) detail::fail(err);
  return detail::lift_task_usage(ret);
}

void update_task(std::string_view id, tasks::task_patch patch) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(id);
  test_cabinet_gg_tasks_task_patch_t lowered{};
  lowered.title = scratch.opt(patch.title);
  lowered.description = scratch.edit(patch.description);
  lowered.status.is_some = patch.status.has_value();
  if (patch.status.has_value()) lowered.status.val = detail::lower(*patch.status);
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_tasks_update_task(&lowered_id, &lowered, &err)) detail::fail(err);
}

void set_blocked_by(std::string_view id, std::vector<std::string> blocked_by) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(id);
  sandbox_list_string_t lowered = scratch.list(blocked_by);
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_tasks_set_blocked_by(&lowered_id, &lowered, &err)) detail::fail(err);
}

void complete_task(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_tasks_complete_task(&lowered, &err)) detail::fail(err);
}

tasks::task_usage remove_task(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_tasks_task_usage_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_tasks_remove_task(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_task_usage(ret);
}

// The named factories a program builds a three-way edit with.
text_edit text_edit::clear() {
  text_edit edit;
  edit.tag_ = TEST_CABINET_GG_TYPES_TEXT_EDIT_CLEAR;
  return edit;
}

text_edit text_edit::set(std::string text) {
  text_edit edit;
  edit.tag_ = TEST_CABINET_GG_TYPES_TEXT_EDIT_SET;
  edit.text_ = std::move(text);
  return edit;
}

}  // namespace tasks

}  // namespace gg
