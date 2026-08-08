#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../options.hpp"
#include "../types.hpp"

namespace gg {

/// the epic/issue board — decompose work into dispatchable issues
///
/// An issue is the heavyweight unit of work — its scope, non-scope and completion criteria are
/// exactly what a delegated child agent is briefed from — which is why `create_issue` asks for
/// more than `tasks::add_task` does.
///
/// Two of `issue_patch`'s fields are **three-way**: `text_edit` leaves, empties or replaces a
/// description, and `epic_assignment` leaves, detaches or regroups an epic. Neither needs a
/// sentinel, and both keep the field alone when the patch says nothing about them.
namespace project {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Create an epic to group related issues, and hand back the id its prefix resolved to together
/// with the board budget.
///
/// `prefix` is 3-6 letters naming the epic; it is upper-cased and becomes the epic's id, which is
/// also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`,
/// and so on.
///
/// \param prefix 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
///   issues are numbered from.
/// \param title A short line naming the body of work.
/// \param description What the epic covers, for a reader who has not seen its issues.
/// \returns the id the prefix resolved to, and the board budget.
/// \throws tool_error `invalid_argument` when the prefix is not 3-6 letters, and `conflict` when
///   another epic already holds it.
epic_created create_epic(std::string_view prefix, std::string_view title,
                         std::string_view description);

/// Create a self-contained, dispatchable issue, and hand back the id the board **assigned** it
/// together with the board budget.
///
/// The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it
/// has no epic; you do not choose it, so keep the returned one to block a later issue on this one
/// or to wait for it. `in_scope`, `out_of_scope` and `completion_criteria` are what a child agent
/// is briefed from, so write them for a reader with no other context.
///
/// \param title A short line naming the work.
/// \param in_scope What the issue covers, precisely. Part of the brief a child agent is given.
/// \param out_of_scope What the issue deliberately does not cover, so the work stops where you
///   meant it to.
/// \param completion_criteria What must be true for the issue to be done. It is what a reviewer
///   checks the work against.
/// \param agent The agent the issue is dispatched to. It must be one you may spawn.
/// \param options The parts you may leave out: a description, blockers, an epic, reviewers.
/// \returns the id the board assigned, and the board budget.
/// \throws tool_error `invalid_argument` when `agent` or a reviewer is not yours to assign, and
///   `conflict` on a blocker edge that would close a cycle.
issue_created create_issue(std::string_view title, std::string_view in_scope,
                           std::string_view out_of_scope, std::string_view completion_criteria,
                           std::string_view agent, issue_options options = {});

/// Revise an issue; supply at least one field.
///
/// A field left at its default is left alone, `text_edit::clear()` empties the description, and
/// `epic_assignment::ungroup()` detaches the issue from its epic.
///
/// \param id The issue to revise.
/// \param patch The fields to change. Supply at least one; a field left at its default is left
///   alone.
/// \throws tool_error `not_found` for an unknown id.
void update_issue(std::string_view id, issue_patch patch);

/// Replace an issue's whole blocker set; an empty vector clears every blocker.
///
/// \param id The issue whose blockers to replace.
/// \param blocked_by The ids of every issue that must now be done before it. An empty vector
///   clears them all.
/// \throws tool_error `not_found` for an unknown id, and `conflict` when an edge would close a
///   cycle.
void set_issue_blocked_by(std::string_view id, std::vector<std::string> blocked_by);

/// Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
///
/// \param id The epic to remove.
/// \returns how much of the board budget is left in use.
/// \throws tool_error `not_found` for an unknown id.
board_usage remove_epic(std::string_view id);

/// Remove an issue and every blocker edge pointing at it, and hand back the board budget.
///
/// \param id The issue to remove.
/// \returns how much of the board budget is left in use.
/// \throws tool_error `not_found` for an unknown id.
board_usage remove_issue(std::string_view id);

/// Register a wait on an issue and hand back an acknowledgement.
///
/// It does not block inside your program — it records the wait and returns at once, so the rest of
/// your program still runs; the suspension happens after the program ends, between turns. Once the
/// program finishes the run suspends, freeing this agent's slot for others, until the issue is
/// terminal (done, or failed if its assigned agent could not complete it), then resumes on the
/// next turn. Use it to sequence your next turn's work behind an issue you depend on. You cannot
/// wait on the issue you were assigned to implement.
///
/// \param id The issue to wait on. It may not be the issue you were assigned.
/// \returns gg's acknowledgement of the registered wait.
/// \throws tool_error `not_found` for an unknown id.
std::string wait_for_issue(std::string_view id);

}  // namespace project

}  // namespace gg
