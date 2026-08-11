// The **memories** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/memories.hpp`.

#include "gg/memories.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& memories_tools() {
  static const std::vector<std::string> names{"write_memory",  "update_memory",   "create_memory",
                                              "read_memory",   "edit_memory",     "search_memories",
                                              "delete_memory"};
  return names;
}

// The wire record the three memory writes share, built once rather than three times.
static test_cabinet_gg_memories_memory_input_t memory_input(
    scratch& scratch, std::string_view name, std::string_view description, std::string_view body,
    const memories::memory_options& options) {
  test_cabinet_gg_memories_memory_input_t input{};
  input.name = scratch.str(name);
  input.description = scratch.str(description);
  input.body = scratch.str(body);
  input.code = scratch.opt(options.code);
  input.on_use = scratch.opt(options.on_use);
  return input;
}

}  // namespace detail

namespace memories {

memories::memory_usage write_memory(std::string_view name, std::string_view description,
                                    std::string_view body, memories::memory_options options) {
  detail::scratch scratch;
  test_cabinet_gg_memories_memory_input_t input =
      detail::memory_input(scratch, name, description, body, options);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_write_memory(&input, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

memories::memory_usage update_memory(std::string_view name, std::string_view description,
                                     std::string_view body, memories::memory_options options) {
  detail::scratch scratch;
  test_cabinet_gg_memories_memory_input_t input =
      detail::memory_input(scratch, name, description, body, options);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_update_memory(&input, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

memories::memory_usage create_memory(std::string_view name, std::string_view description,
                                     std::string_view body, memories::memory_options options) {
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

memories::memory_usage edit_memory(std::string_view name, std::string_view search,
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

std::vector<memories::memory_hit> search_memories(std::vector<std::string> keywords) {
  detail::scratch scratch;
  sandbox_list_string_t lowered = scratch.list(keywords);
  test_cabinet_gg_memories_list_memory_hit_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_search_memories(&lowered, &ret, &err)) detail::fail(err);
  std::vector<memories::memory_hit> hits =
      detail::lift_each(ret.ptr, ret.len, detail::lift_memory_hit);
  test_cabinet_gg_memories_list_memory_hit_free(&ret);
  return hits;
}

memories::memory_usage delete_memory(std::string_view name) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(name);
  test_cabinet_gg_memories_memory_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_memories_delete_memory(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_memory_usage(ret);
}

// The member function the search hit offers, which is the same capability reached from the value
// that already carries the slug.
std::string memory_hit::read() const { return memories::read_memory(name); }

}  // namespace memories

}  // namespace gg
