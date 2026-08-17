// The **context** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/context.hpp`.

#include "gg/context.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& context_operations() {
  static const std::vector<std::string> names{"evict_file_view", "archive_thread", "search_archive",
                                              "compact"};
  return names;
}

}  // namespace detail

namespace context {

context::reclaim_report evict_file_view(std::optional<std::string_view> path) {
  detail::scratch scratch;
  sandbox_string_t lowered{};
  if (path.has_value()) lowered = scratch.str(*path);
  test_cabinet_gg_context_reclaim_report_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_context_evict_file_view(path.has_value() ? &lowered : nullptr, &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_reclaim_report(ret);
}

context::reclaim_report archive_thread(std::vector<context::turn_range> ranges) {
  detail::scratch scratch;
  test_cabinet_gg_context_list_turn_range_t lowered = scratch.turn_ranges(ranges);
  test_cabinet_gg_context_reclaim_report_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_context_archive_thread(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_reclaim_report(ret);
}

context::archive_search search_archive(std::string_view query) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(query);
  test_cabinet_gg_context_archive_search_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_context_search_archive(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_archive_search(ret);
}

void compact(std::string_view summary, std::vector<std::string> files) {
  detail::scratch scratch;
  sandbox_string_t lowered_summary = scratch.str(summary);
  sandbox_list_string_t lowered_files = scratch.list(files);
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_context_compact(&lowered_summary, &lowered_files, &err)) detail::fail(err);
}

}  // namespace context

}  // namespace gg
