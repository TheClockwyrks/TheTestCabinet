// The planning half of the SDK's implementation: `project`, `tasks`, `memory` and `context`.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `objects/`. What is here is the lowering, the call and the lift.

#include "objects/context.hpp"
#include "objects/memory.hpp"
#include "objects/project.hpp"
#include "objects/tasks.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& memory_tools() {
  static const std::vector<std::string> names{"write_memory",  "update_memory",   "create_memory",
                                              "read_memory",   "edit_memory",     "search_memories",
                                              "delete_memory"};
  return names;
}

const std::vector<std::string>& tasks_tools() {
  static const std::vector<std::string> names{"add_task", "update_task", "set_blocked_by",
                                              "complete_task", "remove_task"};
  return names;
}

const std::vector<std::string>& project_tools() {
  static const std::vector<std::string> names{"create_epic",   "create_issue",
                                              "update_issue",  "set_issue_blocked_by",
                                              "remove_epic",   "remove_issue",
                                              "wait_for_issue"};
  return names;
}

const std::vector<std::string>& context_tools() {
  static const std::vector<std::string> names{"evict_file_view", "archive_thread", "search_archive",
                                              "compact"};
  return names;
}

// The wire record the three memory writes share, built once rather than three times.
static test_cabinet_gg_memories_memory_input_t memory_input(scratch& scratch,
                                                            std::string_view name,
                                                            std::string_view description,
                                                            std::string_view body,
                                                            const memory_options& options) {
  test_cabinet_gg_memories_memory_input_t input{};
  input.name = scratch.str(name);
  input.description = scratch.str(description);
  input.body = scratch.str(body);
  input.code = scratch.opt(options.code);
  input.on_use = scratch.opt(options.on_use);
  return input;
}

}  // namespace detail

namespace project {

std::vector<function_summary> list() { return detail::api_object_list("project"); }

epic_created create_epic(std::string_view prefix, std::string_view title,
                         std::string_view description) {
  detail::scratch scratch;
  test_cabinet_gg_board_epic_input_t input{};
  input.prefix = scratch.str(prefix);
  input.title = scratch.str(title);
  input.description = scratch.str(description);
  test_cabinet_gg_board_epic_created_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_create_epic(&input, &ret, &err)) detail::fail(err);
  epic_created created{detail::lift(ret.id), detail::lift_board_usage(ret.board)};
  test_cabinet_gg_board_epic_created_free(&ret);
  return created;
}

issue_created create_issue(std::string_view title, std::string_view in_scope,
                           std::string_view out_of_scope, std::string_view completion_criteria,
                           std::string_view agent, issue_options options) {
  detail::scratch scratch;
  test_cabinet_gg_board_issue_input_t input{};
  input.title = scratch.str(title);
  input.description = scratch.opt(options.description);
  input.in_scope = scratch.str(in_scope);
  input.out_of_scope = scratch.str(out_of_scope);
  input.completion_criteria = scratch.str(completion_criteria);
  input.blocked_by = scratch.list(options.blocked_by);
  input.epic_id = scratch.opt(options.epic_id);
  input.agent = scratch.str(agent);
  input.reviewers = scratch.list(options.reviewers);
  test_cabinet_gg_board_issue_created_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_create_issue(&input, &ret, &err)) detail::fail(err);
  issue_created created{detail::lift(ret.id), detail::lift_board_usage(ret.board)};
  test_cabinet_gg_board_issue_created_free(&ret);
  return created;
}

void update_issue(std::string_view id, issue_patch patch) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(id);
  test_cabinet_gg_board_issue_patch_t lowered{};
  lowered.title = scratch.opt(patch.title);
  lowered.description = scratch.edit(patch.description);
  lowered.in_scope = scratch.opt(patch.in_scope);
  lowered.out_of_scope = scratch.opt(patch.out_of_scope);
  lowered.completion_criteria = scratch.opt(patch.completion_criteria);
  lowered.status.is_some = patch.status.has_value();
  if (patch.status.has_value()) lowered.status.val = detail::lower(*patch.status);
  lowered.epic = scratch.epic(patch.epic);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_update_issue(&lowered_id, &lowered, &err)) detail::fail(err);
}

void set_issue_blocked_by(std::string_view id, std::vector<std::string> blocked_by) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(id);
  sandbox_list_string_t lowered = scratch.list(blocked_by);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_set_issue_blocked_by(&lowered_id, &lowered, &err)) detail::fail(err);
}

board_usage remove_epic(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_board_board_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_remove_epic(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_board_usage(ret);
}

board_usage remove_issue(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_board_board_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_remove_issue(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_board_usage(ret);
}

std::string wait_for_issue(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  sandbox_string_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_wait_for_issue(&lowered, &ret, &err)) detail::fail(err);
  std::string acknowledgement = detail::lift(ret);
  sandbox_string_free(&ret);
  return acknowledgement;
}

}  // namespace project

namespace tasks {

std::vector<function_summary> list() { return detail::api_object_list("tasks"); }

task_usage add_task(std::string_view id, std::string_view title, task_options options) {
  detail::scratch scratch;
  test_cabinet_gg_tasks_task_input_t input{};
  input.id = scratch.str(id);
  input.title = scratch.str(title);
  input.description = scratch.opt(options.description);
  input.blocked_by = scratch.list(options.blocked_by);
  test_cabinet_gg_tasks_task_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_tasks_add_task(&input, &ret, &err)) detail::fail(err);
  return detail::lift_task_usage(ret);
}

void update_task(std::string_view id, task_patch patch) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(id);
  test_cabinet_gg_tasks_task_patch_t lowered{};
  lowered.title = scratch.opt(patch.title);
  lowered.description = scratch.edit(patch.description);
  lowered.status.is_some = patch.status.has_value();
  if (patch.status.has_value()) lowered.status.val = detail::lower(*patch.status);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_tasks_update_task(&lowered_id, &lowered, &err)) detail::fail(err);
}

void set_blocked_by(std::string_view id, std::vector<std::string> blocked_by) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(id);
  sandbox_list_string_t lowered = scratch.list(blocked_by);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_tasks_set_blocked_by(&lowered_id, &lowered, &err)) detail::fail(err);
}

void complete_task(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_tasks_complete_task(&lowered, &err)) detail::fail(err);
}

task_usage remove_task(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_tasks_task_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_tasks_remove_task(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_task_usage(ret);
}

}  // namespace tasks

namespace memory {

std::vector<function_summary> list() { return detail::api_object_list("memory"); }

memory_usage write_memory(std::string_view name, std::string_view description,
                          std::string_view body, memory_options options) {
  detail::scratch scratch;
  test_cabinet_gg_memories_memory_input_t input =
      detail::memory_input(scratch, name, description, body, options);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_write_memory(&input, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

memory_usage update_memory(std::string_view name, std::string_view description,
                           std::string_view body, memory_options options) {
  detail::scratch scratch;
  test_cabinet_gg_memories_memory_input_t input =
      detail::memory_input(scratch, name, description, body, options);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_update_memory(&input, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

memory_usage create_memory(std::string_view name, std::string_view description,
                           std::string_view body, memory_options options) {
  detail::scratch scratch;
  test_cabinet_gg_memories_memory_input_t input =
      detail::memory_input(scratch, name, description, body, options);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_create_memory(&input, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

std::string read_memory(std::string_view name) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(name);
  sandbox_string_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_read_memory(&lowered, &ret, &err)) detail::fail(err);
  std::string contents = detail::lift(ret);
  sandbox_string_free(&ret);
  return contents;
}

memory_usage edit_memory(std::string_view name, std::string_view search,
                         std::string_view replace) {
  detail::scratch scratch;
  test_cabinet_gg_memories_memory_edit_t edit{};
  edit.name = scratch.str(name);
  edit.search = scratch.str(search);
  edit.replace = scratch.str(replace);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_edit_memory(&edit, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

std::vector<memory_hit> search_memories(std::vector<std::string> keywords) {
  detail::scratch scratch;
  sandbox_list_string_t lowered = scratch.list(keywords);
  test_cabinet_gg_memories_list_memory_hit_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_search_memories(&lowered, &ret, &err)) detail::fail(err);
  std::vector<memory_hit> hits = detail::lift_each(ret.ptr, ret.len, detail::lift_memory_hit);
  test_cabinet_gg_memories_list_memory_hit_free(&ret);
  return hits;
}

memory_usage delete_memory(std::string_view name) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(name);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_delete_memory(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

}  // namespace memory

namespace context {

std::vector<function_summary> list() { return detail::api_object_list("context"); }

reclaim_report evict_file_view(std::optional<std::string_view> path) {
  detail::scratch scratch;
  sandbox_string_t lowered{};
  if (path.has_value()) lowered = scratch.str(*path);
  test_cabinet_gg_context_reclaim_report_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_context_evict_file_view(path.has_value() ? &lowered : nullptr, &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_reclaim_report(ret);
}

reclaim_report archive_thread(std::vector<turn_range> ranges) {
  detail::scratch scratch;
  test_cabinet_gg_context_list_turn_range_t lowered = scratch.turn_ranges(ranges);
  test_cabinet_gg_context_reclaim_report_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_context_archive_thread(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_reclaim_report(ret);
}

archive_search search_archive(std::string_view query) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(query);
  test_cabinet_gg_context_archive_search_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_context_search_archive(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_archive_search(ret);
}

void compact(std::string_view summary, std::vector<std::string> files) {
  detail::scratch scratch;
  sandbox_string_t lowered_summary = scratch.str(summary);
  sandbox_list_string_t lowered_files = scratch.list(files);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_context_compact(&lowered_summary, &lowered_files, &err)) detail::fail(err);
}

}  // namespace context

}  // namespace gg
