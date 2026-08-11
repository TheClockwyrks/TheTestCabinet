// The **docs** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/docs.hpp`.
//
// This module dispatches no gg tool, so it contributes nothing to `bound-tools` and has no
// `*_tools()` of its own: documentation lookup is a carve-out on the membrane rather than a tool,
// exactly as `views` and `session` are.

#include "gg/docs.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace docs {

docs::doc_search search(std::string_view query, docs::search_filters filters) {
  detail::scratch scratch;
  sandbox_string_t lowered_query = scratch.str(query);
  sandbox_string_t lowered_module{};
  if (filters.module.has_value()) lowered_module = scratch.str(*filters.module);
  sandbox_string_t lowered_type{};
  if (filters.type.has_value()) lowered_type = scratch.str(*filters.type);
  sandbox_string_t lowered_kind{};
  if (filters.kind.has_value()) lowered_kind = scratch.str(detail::lower(*filters.kind));
  detail::window page(filters.offset, filters.limit);
  test_cabinet_gg_docs_doc_search_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_docs_search(&lowered_query,
                                   filters.module.has_value() ? &lowered_module : nullptr,
                                   filters.type.has_value() ? &lowered_type : nullptr,
                                   filters.kind.has_value() ? &lowered_kind : nullptr,
                                   page.offset(), page.limit(), &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_doc_search(ret);
}

std::uint32_t close(std::string_view key) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(key);
  std::uint32_t ret = 0;
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_docs_close_doc_view(&lowered, &ret, &err)) detail::fail(err);
  return ret;
}

std::uint32_t close_all() {
  std::uint32_t ret = 0;
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_docs_close_doc_views(&ret, &err)) detail::fail(err);
  return ret;
}

}  // namespace docs

}  // namespace gg
