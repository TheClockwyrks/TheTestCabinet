// The **files** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/files.hpp`.

#include "gg/files.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& files_operations() {
  static const std::vector<std::string> names{"read_file", "write_file", "edit_file", "list_dir",
                                              "tree",      "search"};
  return names;
}

}  // namespace detail

namespace files {

files::file_read read_file(std::string_view path, files::read_window window) {
  detail::scratch scratch;
  detail::window lines(window);
  sandbox_string_t lowered = scratch.str(path);
  test_cabinet_gg_files_file_read_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_files_read_file(&lowered, lines.offset(), lines.limit(), &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_file_read(ret);
}

std::uint64_t write_file(std::string_view path, std::string_view contents) {
  detail::scratch scratch;
  sandbox_string_t lowered_path = scratch.str(path);
  sandbox_string_t lowered_contents = scratch.str(contents);
  std::uint64_t ret = 0;
  test_cabinet_gg_types_api_error_t err{};
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
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_files_edit_file(&lowered_path, &lowered_old, &lowered_new, &err)) {
    detail::fail(err);
  }
}

std::vector<files::dir_entry> list_dir(std::optional<std::string_view> path) {
  detail::scratch scratch;
  sandbox_string_t lowered{};
  if (path.has_value()) lowered = scratch.str(*path);
  test_cabinet_gg_files_list_dir_entry_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_files_list_dir(path.has_value() ? &lowered : nullptr, &ret, &err)) {
    detail::fail(err);
  }
  std::vector<files::dir_entry> entries =
      detail::lift_each(ret.ptr, ret.len, detail::lift_dir_entry);
  test_cabinet_gg_files_list_dir_entry_free(&ret);
  return entries;
}

std::string tree(files::tree_options options) {
  detail::scratch scratch;
  sandbox_string_t lowered{};
  if (options.path.has_value()) lowered = scratch.str(*options.path);
  detail::window levels(std::nullopt, options.depth);
  sandbox_string_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_files_tree(options.path.has_value() ? &lowered : nullptr, levels.limit(),
                                  &ret, &err)) {
    detail::fail(err);
  }
  std::string rendered = detail::lift(ret);
  sandbox_string_free(&ret);
  return rendered;
}

std::vector<files::search_match> search(std::string_view query, files::search_options options) {
  detail::scratch scratch;
  sandbox_string_t lowered_query = scratch.str(query);
  sandbox_string_t lowered_path{};
  if (options.path.has_value()) lowered_path = scratch.str(*options.path);
  detail::window page(std::nullopt, options.limit);
  test_cabinet_gg_files_list_search_match_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_files_search(&lowered_query, options.path.has_value() ? &lowered_path : nullptr,
                                    page.limit(), &ret, &err)) {
    detail::fail(err);
  }
  std::vector<files::search_match> matches =
      detail::lift_each(ret.ptr, ret.len, detail::lift_search_match);
  test_cabinet_gg_files_list_search_match_free(&ret);
  return matches;
}

}  // namespace files

}  // namespace gg
