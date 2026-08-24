// The **tasks** module: the agent's own task DAG.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core.hpp"

namespace gg {

/// Keep a task list whose entries may wait on each other.
///
/// A DAG rather than a list of lines: every task may name the tasks that must finish before it,
/// and an edge that would close a cycle is refused.
///
/// <ggmodule>tasks</ggmodule>
namespace tasks {

/// A three-way edit of an optional text field: leave it, empty it, or replace it.
///
/// The field really has three states and an `std::optional<std::string>` could say only two of
/// them, which is how a stringly interface ends up treating "clear it" and "set it to the empty
/// string" as one request. A default-constructed value keeps the field, so a patch that says
/// nothing about a description leaves it alone.
class text_edit {
 public:
  /// Leave the field as it is, which is what a default-constructed value does.
  text_edit() = default;

  /// Empty the field.
  static tasks::text_edit clear();

  /// Replace the field with this text.
  ///
  /// \param text What the field becomes.
  static tasks::text_edit set(std::string text);

  // Not model-facing: what the bridge reads back out of one. 0 keeps, 1 clears, 2 sets.
  std::uint8_t tag() const noexcept { return tag_; }
  const std::string& text() const noexcept { return text_; }

 private:
  std::uint8_t tag_{0};
  std::string text_;
};

/// Where a task stands.
enum class task_status {
  /// Not started. Every task begins here.
  pending,
  /// Being worked on now.
  in_progress,
  /// Finished. Tasks blocked on it become actionable once all their blockers are done.
  done,
};

/// How much of the run's task budget is used, after the call that returned it.
struct task_usage {
  /// Tasks currently on the list.
  std::uint32_t count{};
  /// The most tasks this run allows.
  std::uint32_t max_tasks{};
};

/// The parts of a new task that may be left out; `{}` adds a task with neither.
struct task_options {
  /// What the work is, at whatever length is useful.
  std::optional<std::string> description;
  /// The ids of the tasks that must be done before this one.
  std::vector<std::string> blocked_by;
};

/// The fields a task revision may change; `{}` changes nothing, which the call refuses.
struct task_patch {
  /// The title to replace the old one with.
  std::optional<std::string> title;
  /// A three-way edit of the description: left alone, emptied, or replaced.
  tasks::text_edit description;
  /// Where the task now stands.
  std::optional<tasks::task_status> status;
};

/// Add a task to the task DAG and hand back the task budget.
///
/// `options.blocked_by` names the tasks that must finish before this one, and defaults to none.
///
/// <ggop>tasks.add_task</ggop>
///
/// \param id The id to file it under. Every other task call takes it, and no two tasks may share
///   one.
/// \param title A short line naming the work.
/// \param options The parts that may be left out: a description, and the tasks this one waits on.
/// \returns how much of the task budget is used.
/// \throws gg::core::api_error `conflict` on a duplicate id or on an edge that would close a cycle.
tasks::task_usage add_task(std::string_view id, std::string_view title,
                           tasks::task_options options = {});

/// Revise a task's title, description or status; at least one of the three is required.
///
/// A field left at its default is left alone, `gg::tasks::text_edit::clear()` empties the description,
/// and `gg::tasks::text_edit::set(…)` replaces it.
///
/// <ggop>tasks.update_task</ggop>
///
/// \param id The task to revise.
/// \param patch The fields to change. At least one is required; a field left at its default is
///   left alone.
/// \throws gg::core::api_error `not_found` for an unknown id.
void update_task(std::string_view id, tasks::task_patch patch);

/// Replace a task's whole blocker set; an empty vector clears every blocker.
///
/// <ggop>tasks.set_blocked_by</ggop>
///
/// \param id The task whose blockers to replace.
/// \param blocked_by The ids of every task that must now be done before it.
/// \throws gg::core::api_error `not_found` for an unknown id, and `conflict` when an edge would close
///   a cycle.
void set_blocked_by(std::string_view id, std::vector<std::string> blocked_by);

/// Mark a task done, which makes the tasks it was blocking actionable.
///
/// A blocked task becomes actionable once every one of its blockers is done, not merely this one.
///
/// <ggop>tasks.complete_task</ggop>
///
/// \param id The task to mark done.
/// \throws gg::core::api_error `not_found` for an unknown id.
void complete_task(std::string_view id);

/// Remove a task and every blocker edge pointing at it, and hand back the task budget.
///
/// <ggop>tasks.remove_task</ggop>
///
/// \param id The task to remove.
/// \returns how much of the task budget is left in use.
/// \throws gg::core::api_error `not_found` for an unknown id.
tasks::task_usage remove_task(std::string_view id);

}  // namespace tasks

}  // namespace gg
