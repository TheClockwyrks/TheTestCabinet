// The **views** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/views.hpp`.

#include "gg/views.hpp"

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace views {

files::file_read open_file(std::string_view path, files::read_window window) {
  detail::scratch scratch;
  detail::window lines(window);
  sandbox_string_t lowered = scratch.str(path);
  test_cabinet_gg_views_file_read_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_views_open_file_view(&lowered, lines.offset(), lines.limit(), &ret, &err)) {
    detail::fail(err);
  }
  return detail::lift_file_read(ret);
}

void open_text(std::string_view label, std::string_view body) {
  detail::scratch scratch;
  sandbox_string_t lowered_label = scratch.str(label);
  sandbox_string_t lowered_body = scratch.str(body);
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_views_open_text_view(&lowered_label, &lowered_body, &err)) {
    detail::fail(err);
  }
}

void open_docs_view(std::string_view name) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(name);
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_views_open_docs_view(&lowered, &err)) detail::fail(err);
}

std::uint32_t close(std::string_view selector) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(selector);
  std::uint32_t ret = 0;
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_views_close_view(&lowered, &ret, &err)) detail::fail(err);
  return ret;
}

std::vector<views::open_view> current() {
  test_cabinet_gg_views_list_open_view_t ret{};
  test_cabinet_gg_types_api_error_t err{};
  if (!test_cabinet_gg_views_current_views(&ret, &err)) detail::fail(err);
  std::vector<views::open_view> open =
      detail::lift_each(ret.ptr, ret.len, detail::lift_open_view);
  test_cabinet_gg_views_list_open_view_free(&ret);
  return open;
}

// The member function the open view offers, which is the same capability reached from the value
// that already carries the selector.
std::uint32_t open_view::close() const { return views::close(selector); }

}  // namespace views

}  // namespace gg
