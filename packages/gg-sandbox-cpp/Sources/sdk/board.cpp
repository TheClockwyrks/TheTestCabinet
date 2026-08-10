// The **board** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/board.hpp`.

#include "gg/board.hpp"

#include <utility>

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& board_tools() {
  static const std::vector<std::string> names{"create_epic",   "create_issue",
                                              "update_issue",  "set_issue_blocked_by",
                                              "remove_epic",   "remove_issue",
                                              "wait_for_issue"};
  return names;
}

}  // namespace detail

namespace board {

std::vector<core::function_summary> list() { return detail::module_directory("gg::board"); }

board::epic_created create_epic(std::string_view prefix, std::string_view title,
                                std::string_view description) {
  detail::scratch scratch;
  test_cabinet_gg_board_epic_input_t input{};
  input.prefix = scratch.str(prefix);
  input.title = scratch.str(title);
  input.description = scratch.str(description);
  test_cabinet_gg_board_epic_created_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_create_epic(&input, &ret, &err)) detail::fail(err);
  board::epic_created created{detail::lift(ret.id), detail::lift_board_usage(ret.board)};
  test_cabinet_gg_board_epic_created_free(&ret);
  return created;
}

board::issue_created create_issue(std::string_view title, std::string_view in_scope,
                                  std::string_view out_of_scope,
                                  std::string_view completion_criteria, std::string_view agent,
                                  board::issue_options options) {
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
  board::issue_created created{detail::lift(ret.id), detail::lift_board_usage(ret.board)};
  test_cabinet_gg_board_issue_created_free(&ret);
  return created;
}

void update_issue(std::string_view id, board::issue_patch patch) {
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

board::board_usage remove_epic(std::string_view id) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(id);
  test_cabinet_gg_board_board_usage_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_board_remove_epic(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_board_usage(ret);
}

board::board_usage remove_issue(std::string_view id) {
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

// The member function the created issue offers, which is the same capability reached from the
// value that already carries the id.
std::string issue_created::wait() const { return board::wait_for_issue(id); }

// The named factories a program builds a three-way epic change with.
epic_assignment epic_assignment::ungroup() {
  epic_assignment change;
  change.tag_ = TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_UNGROUP;
  return change;
}

epic_assignment epic_assignment::set(std::string epic_id) {
  epic_assignment change;
  change.tag_ = TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_SET;
  change.epic_id_ = std::move(epic_id);
  return change;
}

}  // namespace board

}  // namespace gg
