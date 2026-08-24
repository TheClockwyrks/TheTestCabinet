// The bridge's implementation. See `wire.hpp` for what it is and why it is shaped this way.

#include "wire.hpp"

#include <utility>

namespace gg {

namespace detail {

// ------------------------------------------------------------------------------------------------
// Lowering
// ------------------------------------------------------------------------------------------------

sandbox_string_t scratch::str(std::string_view text) {
  const std::string& stored = strings_.emplace_back(text);
  sandbox_string_t lowered{};
  // `data()` on a `std::string` is never null, so an empty argument lowers to a valid pointer with
  // a zero length rather than to a null the ABI is not specified to accept.
  lowered.ptr = reinterpret_cast<std::uint8_t*>(const_cast<char*>(stored.data()));
  lowered.len = stored.size();
  return lowered;
}

sandbox_option_string_t scratch::opt(const std::optional<std::string_view>& text) {
  sandbox_option_string_t lowered{};
  lowered.is_some = text.has_value();
  if (text.has_value()) lowered.val = str(*text);
  return lowered;
}

sandbox_option_string_t scratch::opt(const std::optional<std::string>& text) {
  sandbox_option_string_t lowered{};
  lowered.is_some = text.has_value();
  if (text.has_value()) lowered.val = str(*text);
  return lowered;
}

sandbox_list_string_t scratch::list(const std::vector<std::string>& texts) {
  std::vector<sandbox_string_t>& items = lists_.emplace_back();
  items.reserve(texts.size());
  for (const std::string& text : texts) items.push_back(str(text));
  sandbox_list_string_t lowered{};
  lowered.ptr = items.data();
  lowered.len = items.size();
  return lowered;
}

test_cabinet_gg_context_list_turn_range_t scratch::turn_ranges(
    const std::vector<context::turn_range>& ranges) {
  std::vector<test_cabinet_gg_context_turn_range_t>& items = ranges_.emplace_back();
  items.reserve(ranges.size());
  for (const context::turn_range& span : ranges) {
    test_cabinet_gg_context_turn_range_t lowered{};
    lowered.start = span.from;
    lowered.end = span.to;
    items.push_back(lowered);
  }
  test_cabinet_gg_context_list_turn_range_t lowered{};
  lowered.ptr = items.data();
  lowered.len = items.size();
  return lowered;
}

test_cabinet_gg_types_text_edit_t scratch::edit(const tasks::text_edit& value) {
  test_cabinet_gg_types_text_edit_t lowered{};
  lowered.tag = value.tag();
  if (value.tag() == TEST_CABINET_GG_TYPES_TEXT_EDIT_SET) lowered.val.set = str(value.text());
  return lowered;
}

test_cabinet_gg_board_epic_assignment_t scratch::epic(const board::epic_assignment& value) {
  test_cabinet_gg_board_epic_assignment_t lowered{};
  lowered.tag = value.tag();
  if (value.tag() == TEST_CABINET_GG_BOARD_EPIC_ASSIGNMENT_SET) {
    lowered.val.set = str(value.epic_id());
  }
  return lowered;
}

window::window(const files::read_window& from) : offset_(from.offset), limit_(from.limit) {
  if (offset_.has_value()) offset_value_ = *offset_;
  if (limit_.has_value()) limit_value_ = *limit_;
}

window::window(const views::view_options& from)
    : offset_(from.offset), limit_(from.limit), max_line_chars_(from.max_line_chars) {
  if (offset_.has_value()) offset_value_ = *offset_;
  if (limit_.has_value()) limit_value_ = *limit_;
  if (max_line_chars_.has_value()) max_line_chars_value_ = *max_line_chars_;
}

window::window(std::optional<std::uint32_t> offset, std::optional<std::uint32_t> limit)
    : offset_(offset), limit_(limit) {
  if (offset_.has_value()) offset_value_ = *offset_;
  if (limit_.has_value()) limit_value_ = *limit_;
}

std::uint32_t* window::offset() { return offset_.has_value() ? &offset_value_ : nullptr; }

std::uint32_t* window::limit() { return limit_.has_value() ? &limit_value_ : nullptr; }

std::uint32_t* window::max_line_chars() {
  return max_line_chars_.has_value() ? &max_line_chars_value_ : nullptr;
}

test_cabinet_gg_tasks_task_status_t lower(tasks::task_status status) {
  switch (status) {
    case tasks::task_status::pending: return TEST_CABINET_GG_TASKS_TASK_STATUS_PENDING;
    case tasks::task_status::in_progress: return TEST_CABINET_GG_TASKS_TASK_STATUS_IN_PROGRESS;
    case tasks::task_status::done: return TEST_CABINET_GG_TASKS_TASK_STATUS_DONE;
  }
  return TEST_CABINET_GG_TASKS_TASK_STATUS_PENDING;
}

test_cabinet_gg_board_issue_status_t lower(board::issue_status status) {
  switch (status) {
    case board::issue_status::open: return TEST_CABINET_GG_BOARD_ISSUE_STATUS_OPEN;
    case board::issue_status::in_progress: return TEST_CABINET_GG_BOARD_ISSUE_STATUS_IN_PROGRESS;
    case board::issue_status::done: return TEST_CABINET_GG_BOARD_ISSUE_STATUS_DONE;
  }
  return TEST_CABINET_GG_BOARD_ISSUE_STATUS_OPEN;
}

// ------------------------------------------------------------------------------------------------
// Lifting
// ------------------------------------------------------------------------------------------------

std::string lift(const sandbox_string_t& text) {
  if (text.ptr == nullptr || text.len == 0) return {};
  return std::string(reinterpret_cast<const char*>(text.ptr), text.len);
}

std::optional<std::string> lift(const sandbox_option_string_t& text) {
  if (!text.is_some) return std::nullopt;
  return lift(text.val);
}

std::vector<std::string> lift(const sandbox_list_string_t& texts) {
  return lift_each(texts.ptr, texts.len,
                   [](const sandbox_string_t& text) { return lift(text); });
}

void fail(test_cabinet_gg_types_api_error_t& failure) {
  core::api_error thrown(lift_error_code(failure.code), lift(failure.operation), lift(failure.message));
  test_cabinet_gg_types_api_error_free(&failure);
  throw thrown;
}

core::api_error_code lift_error_code(test_cabinet_gg_types_error_code_t wire) {
  switch (wire) {
    case TEST_CABINET_GG_TYPES_ERROR_CODE_INVALID_ARGUMENT:
      return core::api_error_code::invalid_argument;
    case TEST_CABINET_GG_TYPES_ERROR_CODE_NOT_FOUND: return core::api_error_code::not_found;
    case TEST_CABINET_GG_TYPES_ERROR_CODE_CONFLICT: return core::api_error_code::conflict;
    case TEST_CABINET_GG_TYPES_ERROR_CODE_REFUSED: return core::api_error_code::refused;
    case TEST_CABINET_GG_TYPES_ERROR_CODE_UNAVAILABLE: return core::api_error_code::unavailable;
    case TEST_CABINET_GG_TYPES_ERROR_CODE_LIMIT_EXCEEDED: return core::api_error_code::limit_exceeded;
    case TEST_CABINET_GG_TYPES_ERROR_CODE_IO_ERROR: return core::api_error_code::io_error;
    default: return core::api_error_code::other;
  }
}

files::entry_kind lift_entry_kind(test_cabinet_gg_files_entry_kind_t wire) {
  switch (wire) {
    case TEST_CABINET_GG_FILES_ENTRY_KIND_FILE: return files::entry_kind::file;
    case TEST_CABINET_GG_FILES_ENTRY_KIND_DIRECTORY: return files::entry_kind::directory;
    default: return files::entry_kind::other;
  }
}

context::message_role lift_message_role(test_cabinet_gg_context_message_role_t wire) {
  switch (wire) {
    case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_SYSTEM: return context::message_role::system;
    case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_USER: return context::message_role::user;
    case TEST_CABINET_GG_CONTEXT_MESSAGE_ROLE_ASSISTANT: return context::message_role::assistant;
    default: return context::message_role::tool;
  }
}

views::view_kind lift_view_kind(test_cabinet_gg_views_view_kind_t wire) {
  switch (wire) {
    case TEST_CABINET_GG_VIEWS_VIEW_KIND_FILE: return views::view_kind::file;
    case TEST_CABINET_GG_VIEWS_VIEW_KIND_TEXT: return views::view_kind::text;
    default: return views::view_kind::docs;
  }
}

std::string_view lower(docs::doc_kind kind) {
  switch (kind) {
    case docs::doc_kind::module: return "module";
    case docs::doc_kind::type: return "type";
    default: return "function";
  }
}

// `module` and `type` are the two words the documentation index files anything but a function under,
// so anything else is a function rather than a parse this SDK could fail — a word a later gg adds is
// then a hit read as the commonest kind rather than a program that stops.
docs::doc_kind lift_doc_kind(const sandbox_string_t& wire) {
  const std::string word = lift(wire);
  if (word == "module") return docs::doc_kind::module;
  if (word == "type") return docs::doc_kind::type;
  return docs::doc_kind::function;
}

delegation::agent_status lift_agent_status(test_cabinet_gg_delegation_agent_status_t wire) {
  switch (wire) {
    case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_COMPLETED: return delegation::agent_status::completed;
    case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_EXHAUSTED: return delegation::agent_status::exhausted;
    case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_TIMED_OUT: return delegation::agent_status::timed_out;
    case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_MODEL_ERROR: return delegation::agent_status::model_error;
    case TEST_CABINET_GG_DELEGATION_AGENT_STATUS_AUTH_ERROR: return delegation::agent_status::auth_error;
    default: return delegation::agent_status::limit_exceeded;
  }
}

shell::shell_output lift_shell_output(test_cabinet_gg_shell_shell_output_t& wire) {
  shell::shell_output out;
  if (wire.exit_code.is_some) out.exit_code = wire.exit_code.val;
  out.output = lift(wire.output);
  out.truncated = wire.truncated;
  test_cabinet_gg_shell_shell_output_free(&wire);
  return out;
}

files::file_read lift_file_read(test_cabinet_gg_files_file_read_t& wire) {
  files::file_read read = [&]() -> files::file_read {
    if (wire.tag == TEST_CABINET_GG_FILES_FILE_READ_IMAGE) {
      files::image_file picture;
      picture.media_type = lift(wire.val.image.media_type);
      picture.label = lift(wire.val.image.label);
      picture.bytes = wire.val.image.bytes;
      picture.shown = wire.val.image.shown;
      picture.not_shown_reason = lift(wire.val.image.not_shown_reason);
      return picture;
    }
    files::text_file text;
    text.contents = lift(wire.val.text.contents);
    text.first_line = wire.val.text.first_line;
    text.last_line = wire.val.text.last_line;
    text.total_lines = wire.val.text.total_lines;
    text.byte_truncated = wire.val.text.byte_truncated;
    return text;
  }();
  test_cabinet_gg_files_file_read_free(&wire);
  return read;
}

files::dir_entry lift_dir_entry(const test_cabinet_gg_files_dir_entry_t& wire) {
  return files::dir_entry{lift(wire.name), lift_entry_kind(wire.kind)};
}

files::search_match lift_search_match(const test_cabinet_gg_files_search_match_t& wire) {
  return files::search_match{lift(wire.path), wire.line, lift(wire.text)};
}

memories::memory_usage lift_memory_usage(const test_cabinet_gg_memories_memory_usage_t& wire) {
  memories::memory_usage usage;
  usage.count = wire.count;
  if (wire.max_count.is_some) usage.max_count = wire.max_count.val;
  usage.total_chars = wire.total_chars;
  if (wire.max_total_chars.is_some) usage.max_total_chars = wire.max_total_chars.val;
  if (wire.index_chars.is_some) usage.index_chars = wire.index_chars.val;
  if (wire.max_index_chars.is_some) usage.max_index_chars = wire.max_index_chars.val;
  return usage;
}

memories::memory_hit lift_memory_hit(const test_cabinet_gg_memories_memory_hit_t& wire) {
  memories::memory_hit hit;
  hit.name = lift(wire.name);
  hit.description = lift(wire.description);
  hit.matched = wire.matched;
  hit.occurrences = wire.occurrences;
  hit.excerpt = lift(wire.excerpt);
  return hit;
}

tasks::task_usage lift_task_usage(const test_cabinet_gg_tasks_task_usage_t& wire) {
  return tasks::task_usage{wire.count, wire.max_tasks};
}

board::board_usage lift_board_usage(const test_cabinet_gg_board_board_usage_t& wire) {
  return board::board_usage{wire.epics, wire.max_epics, wire.issues, wire.max_issues};
}

context::reclaim_report lift_reclaim_report(test_cabinet_gg_context_reclaim_report_t& wire) {
  context::reclaim_report report;
  report.items = wire.items;
  report.reclaimed_tokens = wire.reclaimed_tokens;
  report.paths = lift(wire.paths);
  report.detail = lift(wire.detail);
  test_cabinet_gg_context_reclaim_report_free(&wire);
  return report;
}

context::archive_search lift_archive_search(test_cabinet_gg_context_archive_search_t& wire) {
  context::archive_search found;
  found.archive_empty = wire.archive_empty;
  found.hits = lift_each(wire.hits.ptr, wire.hits.len,
                         [](const test_cabinet_gg_context_archive_hit_t& hit) {
                           return context::archive_hit{hit.seq, lift_message_role(hit.role),
                                              lift(hit.text)};
                         });
  test_cabinet_gg_context_archive_search_free(&wire);
  return found;
}

docs::doc_search lift_doc_search(test_cabinet_gg_docs_doc_search_t& wire) {
  docs::doc_search found;
  found.total = wire.total;
  found.offset = wire.offset;
  found.hits = lift_each(wire.hits.ptr, wire.hits.len,
                         [](const test_cabinet_gg_docs_doc_hit_t& hit) {
                           return docs::doc_hit{lift(hit.key), lift_doc_kind(hit.kind),
                                                lift(hit.module), lift(hit.name),
                                                lift(hit.summary)};
                         });
  test_cabinet_gg_docs_doc_search_free(&wire);
  return found;
}

views::open_view lift_open_view(const test_cabinet_gg_views_open_view_t& wire) {
  views::open_view open;
  open.kind = lift_view_kind(wire.kind);
  open.selector = lift(wire.selector);
  open.tokens = wire.tokens;
  if (wire.region.is_some) open.region = views::view_region{wire.region.val.offset, wire.region.val.limit};
  return open;
}

programs::program_summary lift_program_summary(const test_cabinet_gg_programs_program_summary_t& wire) {
  programs::program_summary summary;
  summary.turn = wire.turn;
  summary.lines = wire.lines;
  summary.chars = wire.chars;
  summary.ok = wire.ok;
  summary.error = lift(wire.error);
  return summary;
}

delegation::subagent_handle lift_subagent_handle(test_cabinet_gg_delegation_subagent_handle_t& wire) {
  delegation::subagent_handle handle{lift(wire.id), lift(wire.slot), lift(wire.model_id)};
  test_cabinet_gg_delegation_subagent_handle_free(&wire);
  return handle;
}

delegation::subagent_result lift_subagent_result(const test_cabinet_gg_delegation_subagent_result_t& wire) {
  delegation::subagent_result result;
  result.id = lift(wire.id);
  if (wire.status.is_some) result.status = lift_agent_status(wire.status.val);
  result.summary = lift(wire.summary);
  return result;
}

}  // namespace detail

}  // namespace gg
