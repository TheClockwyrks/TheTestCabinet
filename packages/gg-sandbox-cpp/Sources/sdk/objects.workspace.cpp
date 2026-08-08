// The workspace half of the SDK's implementation: `fs`, `system`, `skills` and `view`.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `objects/`. What is here is the lowering, the call and the lift.

#include "objects/fs.hpp"
#include "objects/skills.hpp"
#include "objects/system.hpp"
#include "objects/view.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& fs_tools() {
  static const std::vector<std::string> names{"read_file", "write_file", "edit_file", "list_dir"};
  return names;
}

const std::vector<std::string>& system_tools() {
  static const std::vector<std::string> names{"shell"};
  return names;
}

const std::vector<std::string>& skills_tools() {
  static const std::vector<std::string> names{"read_skill"};
  return names;
}

}  // namespace detail

namespace fs {

std::vector<function_summary> list() { return detail::api_object_list("fs"); }

file_read read_file(std::string_view path, read_window window) {
  detail::scratch scratch;
  detail::window lines(window);
  sandbox_string_t lowered = scratch.str(path);
  test_cabinet_gg_files_file_read_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_files_read_file(&lowered, lines.offset(), lines.limit(), &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_file_read(ret);
}

std::string read_text_file(std::string_view path, read_window window) {
  detail::scratch scratch;
  detail::window lines(window);
  sandbox_string_t lowered = scratch.str(path);
  sandbox_string_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_helpers_read_text_file(&lowered, lines.offset(), lines.limit(), &ret,
                                              &err)) {
    detail::fail(err);
  }
  std::string contents = detail::lift(ret);
  sandbox_string_free(&ret);
  return contents;
}

std::uint64_t write_file(std::string_view path, std::string_view contents) {
  detail::scratch scratch;
  sandbox_string_t lowered_path = scratch.str(path);
  sandbox_string_t lowered_contents = scratch.str(contents);
  std::uint64_t ret = 0;
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_files_write_file(&lowered_path, &lowered_contents, &ret, &err)) {
    detail::fail(err);
  }
  return ret;
}

void edit_file(std::string_view path, std::string_view old_string, std::string_view new_string) {
  detail::scratch scratch;
  sandbox_string_t lowered_path = scratch.str(path);
  sandbox_string_t lowered_old = scratch.str(old_string);
  sandbox_string_t lowered_new = scratch.str(new_string);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_files_edit_file(&lowered_path, &lowered_old, &lowered_new, &err)) {
    detail::fail(err);
  }
}

std::vector<dir_entry> list_dir(std::optional<std::string_view> path) {
  detail::scratch scratch;
  sandbox_string_t lowered{};
  if (path.has_value()) lowered = scratch.str(*path);
  test_cabinet_gg_files_list_dir_entry_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_files_list_dir(path.has_value() ? &lowered : nullptr, &ret, &err)) {
    detail::fail(err);
  }
  std::vector<dir_entry> entries = detail::lift_each(ret.ptr, ret.len, detail::lift_dir_entry);
  test_cabinet_gg_files_list_dir_entry_free(&ret);
  return entries;
}

}  // namespace fs

namespace system {

std::vector<function_summary> list() { return detail::api_object_list("system"); }

shell_output shell(std::string_view command, std::optional<double> timeout_secs) {
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

}  // namespace system

namespace skills {

std::vector<function_summary> list() { return detail::api_object_list("skills"); }

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

namespace view {

std::vector<function_summary> list() { return detail::api_object_list("view"); }

file_read open_file(std::string_view path, read_window window) {
  detail::scratch scratch;
  detail::window lines(window);
  sandbox_string_t lowered = scratch.str(path);
  test_cabinet_gg_views_file_read_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_views_open_file_view(&lowered, lines.offset(), lines.limit(), &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_file_read(ret);
}

void open_text(std::string_view label, std::string_view body) {
  detail::scratch scratch;
  sandbox_string_t lowered_label = scratch.str(label);
  sandbox_string_t lowered_body = scratch.str(body);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_views_open_text_view(&lowered_label, &lowered_body, &err)) {
    detail::fail(err);
  }
}

void open_docs_view(std::string_view name) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(name);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_views_open_docs_view(&lowered, &err)) detail::fail(err);
}

std::uint32_t close(std::string_view selector) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(selector);
  std::uint32_t ret = 0;
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_views_close_view(&lowered, &ret, &err)) detail::fail(err);
  return ret;
}

std::vector<open_view> current() {
  test_cabinet_gg_views_list_open_view_t ret{};
  test_cabinet_gg_views_current_views(&ret);
  std::vector<open_view> open = detail::lift_each(ret.ptr, ret.len, detail::lift_open_view);
  test_cabinet_gg_views_list_open_view_free(&ret);
  return open;
}

}  // namespace view

}  // namespace gg
