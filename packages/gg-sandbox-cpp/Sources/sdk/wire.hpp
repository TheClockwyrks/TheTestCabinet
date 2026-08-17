// The bridge from C++'s idiom onto the canonical ABI — **the one part of this SDK a model never
// reads**.
//
// Everything above it is written for a C++ author: default arguments, `std::optional`, aggregates
// filled in with designated initialisers, `std::variant`, real enums and a thrown exception.
// Everything below it is the C the `wit-bindgen` C generator emitted from `crates/gg/wit`.
// Nothing here is model-facing, nothing here is in the signature catalogue, and no comment here is
// a `///` one — which is how the reflector tells the two halves apart.
//
// TWO DIRECTIONS, TWO DISCIPLINES.
//
// LOWERING (C++ → C) has to keep bytes alive for exactly as long as a call. A `sandbox_string_t`
// does not own what it points at, and every import reads its arguments during the call — so a
// pointer that outlived the call would be a dangling read the first time a host function was slow,
// and one that died early would be a dangling read every time. `scratch` owns every buffer one
// call needs and gives them all back when it leaves scope, which is the C++ answer: a destructor
// rather than a `defer`.
//
// It holds them in a `std::deque`, deliberately. A `std::vector` would move its elements on
// growth and invalidate every pointer already handed out, which is a use-after-free that only
// appears once a call takes more than a handful of strings — `board::create_issue` takes nine.
// `std::deque` guarantees references to existing elements survive a push at either end.
//
// LIFTING (C → C++) has to copy and then free. What an import hands back is memory the guest owns:
// the lift copies it into a `std::string` or a `std::vector`, and the generated `*_free` gives it
// back. A program that read a hundred files in a loop would otherwise grow its own heap until the
// fuel ceiling stopped it, and the failure would read as "your program was too expensive" rather
// than as a leak.

#pragma once

#include <cstdint>
#include <deque>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

extern "C" {
#include "sandbox.h"
}

#include "gg/board.hpp"
#include "gg/context.hpp"
#include "gg/core.hpp"
#include "gg/delegation.hpp"
#include "gg/docs.hpp"
#include "gg/files.hpp"
#include "gg/memories.hpp"
#include "gg/programs.hpp"
#include "gg/shell.hpp"
#include "gg/tasks.hpp"
#include "gg/views.hpp"

namespace gg::detail {

// Every buffer one call's arguments need, given back when this leaves scope.
class scratch {
 public:
  scratch() = default;
  scratch(const scratch&) = delete;
  scratch& operator=(const scratch&) = delete;

  // `text`, lowered — pointing at bytes this scratch owns for as long as it lives.
  sandbox_string_t str(std::string_view text);

  // `text`, lowered as the ABI's optional; an empty optional becomes the absent case.
  sandbox_option_string_t opt(const std::optional<std::string_view>& text);
  sandbox_option_string_t opt(const std::optional<std::string>& text);

  // `texts`, lowered as a list — each element pointing at bytes this scratch owns.
  sandbox_list_string_t list(const std::vector<std::string>& texts);

  // `ranges`, lowered as the ABI's list of turn ranges. Both ends are inclusive on both sides.
  test_cabinet_gg_context_list_turn_range_t turn_ranges(const std::vector<context::turn_range>& ranges);

  // `edit`, lowered as the wire's three-way variant.
  test_cabinet_gg_types_text_edit_t edit(const tasks::text_edit& value);

  // `assignment`, lowered as the wire's three-way variant.
  test_cabinet_gg_board_epic_assignment_t epic(const board::epic_assignment& value);

 private:
  std::deque<std::string> strings_;
  std::deque<std::vector<sandbox_string_t>> lists_;
  std::deque<std::vector<test_cabinet_gg_context_turn_range_t>> ranges_;
};

// One canonical-ABI string as a `std::string`, copied out of guest memory.
//
// It does NOT free: the caller frees the whole record this string came out of, with the generated
// free for that record's own type, which walks every string in it.
std::string lift(const sandbox_string_t& text);

// One optional string as a `std::optional`.
std::optional<std::string> lift(const sandbox_option_string_t& text);

// One list of strings as a `std::vector`.
std::vector<std::string> lift(const sandbox_list_string_t& texts);

// One failed call, thrown as the exception a C++ program catches, and the wire record freed.
//
// `[[noreturn]]`, so a call site is a statement rather than a branch the compiler thinks may fall
// through — which is what lets every one of this SDK's functions end in a `return` of the lifted
// value with no `else`.
[[noreturn]] void fail(test_cabinet_gg_types_api_error_t& failure);

// The two nullable scalars a read's window and a search's page are, as the ABI spells an optional
// `u32` argument: a pointer that is null for the absent case.
//
// One type for both because the two are the same pair — an offset and a count, either of which may
// be left out — and the ABI shape is what this class exists to produce. The reads name it in their
// own terms with `files::read_window`; a page arrives as the two optionals it already is.
struct window {
  explicit window(const files::read_window& from);
  window(std::optional<std::uint32_t> offset, std::optional<std::uint32_t> limit);

  std::uint32_t* offset();
  std::uint32_t* limit();

 private:
  std::optional<std::uint32_t> offset_;
  std::optional<std::uint32_t> limit_;
  std::uint32_t offset_value_{};
  std::uint32_t limit_value_{};
};

// The lifts for the records this SDK hands back, one per wire type.
shell::shell_output lift_shell_output(test_cabinet_gg_shell_shell_output_t& wire);
files::file_read lift_file_read(test_cabinet_gg_files_file_read_t& wire);
files::dir_entry lift_dir_entry(const test_cabinet_gg_files_dir_entry_t& wire);
memories::memory_usage lift_memory_usage(const test_cabinet_gg_memories_memory_usage_t& wire);
memories::memory_hit lift_memory_hit(const test_cabinet_gg_memories_memory_hit_t& wire);
tasks::task_usage lift_task_usage(const test_cabinet_gg_tasks_task_usage_t& wire);
board::board_usage lift_board_usage(const test_cabinet_gg_board_board_usage_t& wire);
context::reclaim_report lift_reclaim_report(test_cabinet_gg_context_reclaim_report_t& wire);
context::archive_search lift_archive_search(test_cabinet_gg_context_archive_search_t& wire);
docs::doc_search lift_doc_search(test_cabinet_gg_docs_doc_search_t& wire);
views::open_view lift_open_view(const test_cabinet_gg_views_open_view_t& wire);
programs::program_summary lift_program_summary(const test_cabinet_gg_programs_program_summary_t& wire);
delegation::subagent_handle lift_subagent_handle(test_cabinet_gg_delegation_subagent_handle_t& wire);
delegation::subagent_result lift_subagent_result(const test_cabinet_gg_delegation_subagent_result_t& wire);

// The wire's value for a fixed choice, and the choice a wire value names.
test_cabinet_gg_tasks_task_status_t lower(tasks::task_status status);
test_cabinet_gg_board_issue_status_t lower(board::issue_status status);
files::entry_kind lift_entry_kind(test_cabinet_gg_files_entry_kind_t wire);
// A documentation entry's kind, which the wire spells as a word in both directions because WIT has
// no closed set for it that both sides of the boundary would agree on.
std::string_view lower(docs::doc_kind kind);
docs::doc_kind lift_doc_kind(const sandbox_string_t& wire);
context::message_role lift_message_role(test_cabinet_gg_context_message_role_t wire);
views::view_kind lift_view_kind(test_cabinet_gg_views_view_kind_t wire);
delegation::agent_status lift_agent_status(test_cabinet_gg_delegation_agent_status_t wire);
core::api_error_code lift_error_code(test_cabinet_gg_types_error_code_t wire);

// Each module's share of what the artifact answers `bound-operations` with, defined in the same
// translation unit as the functions that dispatch them — so a tool that gained a function without
// gaining an entry, or the reverse, is a failing gate rather than a silent difference between what
// a model may call and what gg thinks it may call. `gg::bound_operation_names` is their concatenation.
const std::vector<std::string>& files_operations();
const std::vector<std::string>& shell_operations();
const std::vector<std::string>& skills_operations();
const std::vector<std::string>& memories_operations();
const std::vector<std::string>& tasks_operations();
const std::vector<std::string>& board_operations();
const std::vector<std::string>& context_operations();
const std::vector<std::string>& delegation_operations();

// Every element of an ABI list, mapped — the shape every list lift here has.
template <typename Wire, typename Each>
auto lift_each(Wire* items, std::size_t count, Each each)
    -> std::vector<decltype(each(items[0]))> {
  std::vector<decltype(each(items[0]))> out;
  if (items == nullptr || count == 0) return out;
  out.reserve(count);
  for (std::size_t at = 0; at < count; ++at) out.push_back(each(items[at]));
  return out;
}

}  // namespace gg::detail
