// The **delegation** module's implementation: the lowering, the call and the lift.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `gg/delegation.hpp`.

#include "gg/delegation.hpp"

#include <utility>

#include "runtime.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& delegation_tools() {
  static const std::vector<std::string> names{"spawn_subagent",   "wait_for_subagents",
                                              "send_message",     "transition_state",
                                              "exec",             "fork"};
  return names;
}

// The one call the two wait shapes share: a null pointer means "every outstanding child".
static std::vector<delegation::subagent_result> collect(sandbox_list_string_t* ids) {
  test_cabinet_gg_delegation_list_subagent_result_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_wait_for_subagents(ids, &ret, &err)) fail(err);
  std::vector<delegation::subagent_result> results =
      lift_each(ret.ptr, ret.len, lift_subagent_result);
  test_cabinet_gg_delegation_list_subagent_result_free(&ret);
  return results;
}

}  // namespace detail

namespace delegation {

std::vector<core::function_summary> list() { return detail::module_directory("gg::delegation"); }

// The named factories a program briefs a child with.
brief brief::prompt(std::string instructions) { return brief(false, std::move(instructions)); }

brief brief::issue(std::string id) { return brief(true, std::move(id)); }

delegation::subagent_handle spawn_subagent(std::string_view agent, delegation::brief task) {
  detail::scratch scratch;
  test_cabinet_gg_delegation_spawn_request_t request{};
  request.agent = scratch.str(agent);
  request.task.tag = task.is_issue() ? TEST_CABINET_GG_DELEGATION_SUBAGENT_BRIEF_ISSUE
                                     : TEST_CABINET_GG_DELEGATION_SUBAGENT_BRIEF_PROMPT;
  if (task.is_issue()) {
    request.task.val.issue = scratch.str(task.text());
  } else {
    request.task.val.prompt = scratch.str(task.text());
  }
  test_cabinet_gg_delegation_subagent_handle_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_spawn_subagent(&request, &ret, &err)) detail::fail(err);
  return detail::lift_subagent_handle(ret);
}

std::vector<delegation::subagent_result> wait_for_subagents() { return detail::collect(nullptr); }

std::vector<delegation::subagent_result> wait_for_subagents(std::vector<std::string> ids) {
  detail::scratch scratch;
  sandbox_list_string_t lowered = scratch.list(ids);
  return detail::collect(&lowered);
}

void send_message(std::string_view agent_id, std::string_view message) {
  detail::scratch scratch;
  sandbox_string_t lowered_id = scratch.str(agent_id);
  sandbox_string_t lowered_message = scratch.str(message);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_send_message(&lowered_id, &lowered_message, &err)) {
    detail::fail(err);
  }
}

void transition_state(std::string_view state, std::optional<std::string_view> note) {
  detail::scratch scratch;
  sandbox_string_t lowered_state = scratch.str(state);
  sandbox_string_t lowered_note{};
  if (note.has_value()) lowered_note = scratch.str(*note);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_transition_state(
          &lowered_state, note.has_value() ? &lowered_note : nullptr, &err)) {
    detail::fail(err);
  }
}

void exec(std::string_view agent, std::optional<std::string_view> prompt) {
  detail::scratch scratch;
  sandbox_string_t lowered_agent = scratch.str(agent);
  sandbox_string_t lowered_prompt{};
  if (prompt.has_value()) lowered_prompt = scratch.str(*prompt);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_exec(&lowered_agent,
                                       prompt.has_value() ? &lowered_prompt : nullptr, &err)) {
    detail::fail(err);
  }
}

delegation::subagent_handle fork(std::string_view prompt) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(prompt);
  test_cabinet_gg_delegation_subagent_handle_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_fork(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_subagent_handle(ret);
}

// The member function the handle offers, which is the same capability reached from the value that
// already carries the child's id.
void subagent_handle::send(std::string_view message) const {
  delegation::send_message(id, message);
}

}  // namespace delegation

}  // namespace gg
