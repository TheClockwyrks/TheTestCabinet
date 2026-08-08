#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../options.hpp"
#include "../types.hpp"

namespace gg {

/// your task list
///
/// A DAG rather than a list of lines: every task may name the tasks that must finish before it,
/// and an edge that would close a cycle is refused.
///
/// One spelling in here is worth reading twice. `task_patch`'s `description` is a **three-way**
/// edit, and `text_edit` says all three without a sentinel: leave it at its default to keep the
/// description you have, `text_edit::clear()` to empty it, `text_edit::set(…)` to replace it.
namespace tasks {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Add a task to the task DAG and hand back the task budget.
///
/// `options.blocked_by` names the tasks that must finish before this one and defaults to none.
///
/// \param id The id you choose for it. It is what every other task call takes, and no two tasks
///   may share one.
/// \param title A short line naming the work.
/// \param options The parts you may leave out: a description, and the tasks this one waits on.
/// \returns how much of the task budget is used.
/// \throws tool_error `conflict` on a duplicate id or on an edge that would close a cycle.
task_usage add_task(std::string_view id, std::string_view title, task_options options = {});

/// Revise a task's title, description and/or status; supply at least one.
///
/// A field left at its default is left alone, `text_edit::clear()` empties the description, and
/// `text_edit::set(…)` replaces it.
///
/// \param id The task to revise.
/// \param patch The fields to change. Supply at least one; a field left at its default is left
///   alone.
/// \throws tool_error `not_found` for an unknown id.
void update_task(std::string_view id, task_patch patch);

/// Replace a task's whole blocker set; an empty vector clears every blocker.
///
/// \param id The task whose blockers to replace.
/// \param blocked_by The ids of every task that must now be done before it. An empty vector clears
///   them all.
/// \throws tool_error `not_found` for an unknown id, and `conflict` when an edge would close a
///   cycle.
void set_blocked_by(std::string_view id, std::vector<std::string> blocked_by);

/// Mark a task done. Tasks it was blocking become actionable once every one of their blockers is
/// done.
///
/// \param id The task to mark done.
/// \throws tool_error `not_found` for an unknown id.
void complete_task(std::string_view id);

/// Remove a task and every blocker edge pointing at it, and hand back the task budget.
///
/// \param id The task to remove.
/// \returns how much of the task budget is left in use.
/// \throws tool_error `not_found` for an unknown id.
task_usage remove_task(std::string_view id);

}  // namespace tasks

}  // namespace gg
