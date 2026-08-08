// The session half of the SDK's implementation: `agents`, `programs`, `harness`, `review`, the
// directory every object carries, and the two free functions.
//
// Nothing here is model-facing — every word a model reads about these functions is on their
// declarations, in `objects/` and in `api.hpp`. What is here is the lowering, the call and the
// lift.

#include "objects/agents.hpp"
#include "objects/harness.hpp"
#include "objects/programs.hpp"
#include "objects/review.hpp"
#include "wire.hpp"

namespace gg {

namespace detail {

const std::vector<std::string>& agents_tools() {
  static const std::vector<std::string> names{"spawn_subagent",   "wait_for_subagents",
                                              "send_message",     "transition_state",
                                              "exec",             "fork"};
  return names;
}

std::vector<function_summary> api_object_list(std::string_view object) {
  scratch scratch;
  sandbox_string_t lowered = scratch.str(object);
  test_cabinet_gg_docs_list_function_summary_t ret{};
  test_cabinet_gg_docs_list_functions(&lowered, &ret);
  std::vector<function_summary> summaries =
      lift_each(ret.ptr, ret.len, lift_function_summary);
  test_cabinet_gg_docs_list_function_summary_free(&ret);
  return summaries;
}

// The one call the four wait/collect shapes share: a null pointer means "every outstanding child".
static std::vector<subagent_result> collect(sandbox_list_string_t* ids) {
  test_cabinet_gg_delegation_list_subagent_result_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_wait_for_subagents(ids, &ret, &err)) fail(err);
  std::vector<subagent_result> results = lift_each(ret.ptr, ret.len, lift_subagent_result);
  test_cabinet_gg_delegation_list_subagent_result_free(&ret);
  return results;
}

}  // namespace detail

namespace agents {

std::vector<function_summary> list() { return detail::api_object_list("agents"); }

subagent_handle spawn_subagent(std::string_view agent, brief task) {
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

std::vector<subagent_result> wait_for_subagents() { return detail::collect(nullptr); }

std::vector<subagent_result> wait_for_subagents(std::vector<std::string> ids) {
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

subagent_handle fork(std::string_view prompt) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(prompt);
  test_cabinet_gg_delegation_subagent_handle_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_delegation_fork(&lowered, &ret, &err)) detail::fail(err);
  return detail::lift_subagent_handle(ret);
}

}  // namespace agents

namespace programs {

std::vector<function_summary> list() { return detail::api_object_list("programs"); }

std::vector<program_summary> history() {
  test_cabinet_gg_programs_list_program_summary_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_programs_history(&ret, &err)) detail::fail(err);
  std::vector<program_summary> summaries =
      detail::lift_each(ret.ptr, ret.len, detail::lift_program_summary);
  test_cabinet_gg_programs_list_program_summary_free(&ret);
  return summaries;
}

std::string get(std::optional<std::uint32_t> turn) {
  std::uint32_t which = turn.value_or(0);
  sandbox_string_t ret{};
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_programs_get(turn.has_value() ? &which : nullptr, &ret, &err)) {
    detail::fail(err);
  }
  std::string source = detail::lift(ret);
  sandbox_string_free(&ret);
  return source;
}

void rerun(std::string_view source) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(source);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_programs_rerun(&lowered, &err)) detail::fail(err);
}

}  // namespace programs

namespace harness {

std::vector<function_summary> list() { return detail::api_object_list("harness"); }

void finish(std::string_view summary) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(summary);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_session_finish(&lowered, &err)) detail::fail(err);
}

}  // namespace harness

namespace review {

std::vector<function_summary> list() { return detail::api_object_list("review"); }

void approve() {
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_session_approve(&err)) detail::fail(err);
}

void request_changes(std::vector<std::string> items) {
  detail::scratch scratch;
  sandbox_list_string_t lowered = scratch.list(items);
  test_cabinet_gg_types_tool_error_t err{};
  if (!test_cabinet_gg_session_request_changes(&lowered, &err)) detail::fail(err);
}

}  // namespace review

void log(std::string_view line) {
  detail::scratch scratch;
  sandbox_string_t lowered = scratch.str(line);
  test_cabinet_gg_feedback_log(&lowered);
}

std::vector<std::string> bound_tool_names() {
  std::vector<std::string> names;
  for (const std::vector<std::string>* object :
       {&detail::fs_tools(), &detail::system_tools(), &detail::skills_tools(),
        &detail::memory_tools(), &detail::tasks_tools(), &detail::project_tools(),
        &detail::context_tools(), &detail::agents_tools()}) {
    names.insert(names.end(), object->begin(), object->end());
  }
  return names;
}

}  // namespace gg
