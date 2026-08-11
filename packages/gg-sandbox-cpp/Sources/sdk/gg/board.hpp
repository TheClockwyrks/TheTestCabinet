// The **board** module: epics and issues, and the work a child agent is briefed from.
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
#include "tasks.hpp"

namespace gg {

/// Decompose the work into epics and dispatchable issues.
///
/// An issue is the heavyweight unit of work: its scope, non-scope and completion criteria are
/// exactly what a delegated child agent is briefed from, which is why creating one asks for more
/// than adding a task does.
///
/// <ggmodule>board</ggmodule>
namespace board {

/// How an issue's epic grouping changes: leave it, detach it, or regroup it.
///
/// The same three-way shape `tasks::text_edit` has, for a field whose value is an epic id. A
/// default-constructed value keeps the grouping, so detaching an issue and saying nothing about
/// its epic cannot be confused.
class epic_assignment {
 public:
  /// Leave the grouping alone, which is what a default-constructed `board::epic_assignment` does.
  epic_assignment() = default;

  /// Detach the issue from its epic, leaving it ungrouped.
  static board::epic_assignment ungroup();

  /// Group the issue under an epic, by its id.
  ///
  /// \param epic_id The epic to move it under.
  static board::epic_assignment set(std::string epic_id);

  // Not model-facing: what the bridge reads back out of one. 0 keeps, 1 ungroups, 2 sets.
  std::uint8_t tag() const noexcept { return tag_; }
  const std::string& epic_id() const noexcept { return epic_id_; }

 private:
  std::uint8_t tag_{0};
  std::string epic_id_;
};

/// Where an issue stands.
enum class issue_status {
  /// Not started, and dispatchable once its blockers are done.
  open,
  /// Dispatched, with its assigned agent working on it.
  in_progress,
  /// Finished and, where this run requires reviewers, approved.
  done,
};

/// How much of the run's board budget is used, after the call that returned it.
struct board_usage {
  /// Epics currently on the board.
  std::uint32_t epics{};
  /// The most epics this run allows.
  std::uint32_t max_epics{};
  /// Issues currently on the board.
  std::uint32_t issues{};
  /// The most issues this run allows.
  std::uint32_t max_issues{};
};

/// An epic that was just created: the id its prefix resolved to, and the board budget.
struct epic_created {
  /// The epic's id — the given prefix, upper-cased, and the stem its issues are numbered from.
  std::string id;
  /// How much of the board budget is used.
  board::board_usage board;
};

/// An issue that was just created: the id the board assigned it, and the board budget.
struct issue_created {
  /// The id the board assigned (`AUTH-1`), which is not chosen by the caller.
  std::string id;
  /// How much of the board budget is used.
  board::board_usage board;

  /// Register a wait on this issue, which suspends the agent between turns until it is terminal.
  ///
  /// <ggop-alias>board.wait_for_issue</ggop-alias>
  ///
  /// \returns gg's acknowledgement of the registered wait.
  /// \throws core::tool_error `not_found` when the issue has since been removed.
  std::string wait() const;
};

/// The parts of a new issue that may be left out; `{}` leaves out every one of them.
struct issue_options {
  /// What the work is, written for a child agent with no other context.
  std::optional<std::string> description;
  /// The ids of every issue that must be done before this one.
  std::vector<std::string> blocked_by;
  /// The id of an existing epic to group it under; empty leaves it ungrouped.
  ///
  /// An ungrouped issue is numbered under `ISSUE` instead of under an epic's prefix.
  std::optional<std::string> epic_id;
  /// The agents that must approve the work. Required where the run's reviewers feature is on.
  std::vector<std::string> reviewers;
};

/// The fields an issue revision may change; `{}` changes nothing, which the call refuses.
struct issue_patch {
  /// The title to replace the old one with.
  std::optional<std::string> title;
  /// A three-way edit of the description: left alone, emptied, or replaced.
  tasks::text_edit description;
  /// The scope statement to replace the old one with.
  std::optional<std::string> in_scope;
  /// The non-scope statement to replace the old one with.
  std::optional<std::string> out_of_scope;
  /// The completion criteria to replace the old ones with.
  std::optional<std::string> completion_criteria;
  /// Where the issue now stands.
  std::optional<board::issue_status> status;
  /// A three-way change of epic grouping: left alone, detached, or regrouped.
  board::epic_assignment epic;
};

/// Create an epic to group related issues, and hand back its id and the board budget.
///
/// The prefix is upper-cased and becomes the epic's id, which is also the stem its issues are
/// numbered from: a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and so on.
///
/// <ggop>board.create_epic</ggop>
///
/// \param prefix 3-6 letters naming it. Upper-cased, it becomes the epic's id.
/// \param title A short line naming the body of work.
/// \param description What the epic covers, for a reader who has not seen its issues.
/// \returns the id the prefix resolved to, and the board budget.
/// \throws core::tool_error `invalid_argument` when the prefix is not 3-6 letters, and `conflict`
///   when another epic already holds it.
board::epic_created create_epic(std::string_view prefix, std::string_view title,
                                std::string_view description);

/// Create a self-contained, dispatchable issue, and hand back the id the board assigned it.
///
/// The id is numbered under its epic's prefix (`AUTH-1`), or under `ISSUE` when the issue has no
/// epic, and the board rather than the caller chooses it — so the returned one is what blocks a
/// later issue on this one or waits for it. The scope, non-scope and completion criteria are what
/// a child agent is briefed from, so they are written for a reader with no other context.
///
/// <ggop>board.create_issue</ggop>
///
/// \param title A short line naming the work.
/// \param in_scope What the issue covers, precisely. Part of the brief a child agent is given.
/// \param out_of_scope What the issue deliberately does not cover, so the work stops where it was
///   meant to.
/// \param completion_criteria What must be true for the issue to be done, which is what a reviewer
///   checks the work against.
/// \param agent The agent the issue is dispatched to. It must be one this agent may spawn.
/// \param options The parts that may be left out: a description, blockers, an epic, reviewers.
/// \returns the id the board assigned, and the board budget.
/// \throws core::tool_error `invalid_argument` when the agent or a reviewer is not one this agent
///   may assign, and `conflict` on a blocker edge that would close a cycle.
board::issue_created create_issue(std::string_view title, std::string_view in_scope,
                                  std::string_view out_of_scope,
                                  std::string_view completion_criteria, std::string_view agent,
                                  board::issue_options options = {});

/// Revise an issue; at least one field of the patch is required.
///
/// A field left at its default is left alone, `tasks::text_edit::clear()` empties the description,
/// and `board::epic_assignment::ungroup()` detaches the issue from its epic.
///
/// <ggop>board.update_issue</ggop>
///
/// \param id The issue to revise.
/// \param patch The fields to change. At least one is required; a field left at its default is
///   left alone.
/// \throws core::tool_error `not_found` for an unknown id.
void update_issue(std::string_view id, board::issue_patch patch);

/// Replace an issue's whole blocker set; an empty vector clears every blocker.
///
/// <ggop>board.set_issue_blocked_by</ggop>
///
/// \param id The issue whose blockers to replace.
/// \param blocked_by The ids of every issue that must now be done before it.
/// \throws core::tool_error `not_found` for an unknown id, and `conflict` when an edge would close
///   a cycle.
void set_issue_blocked_by(std::string_view id, std::vector<std::string> blocked_by);

/// Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
///
/// <ggop>board.remove_epic</ggop>
///
/// \param id The epic to remove.
/// \returns how much of the board budget is left in use.
/// \throws core::tool_error `not_found` for an unknown id.
board::board_usage remove_epic(std::string_view id);

/// Remove an issue and every blocker edge pointing at it, and hand back the board budget.
///
/// <ggop>board.remove_issue</ggop>
///
/// \param id The issue to remove.
/// \returns how much of the board budget is left in use.
/// \throws core::tool_error `not_found` for an unknown id.
board::board_usage remove_issue(std::string_view id);

/// Register a wait on an issue and hand back an acknowledgement.
///
/// It does not block inside the program: it records the wait and returns at once, so the rest of
/// the program still runs and the suspension happens after the program ends, between turns. The
/// run then frees this agent's slot for others until the issue is terminal — done, or failed
/// because its assigned agent could not complete it — and resumes on the next turn. The issue this
/// agent was assigned to implement cannot be waited on.
///
/// <ggop>board.wait_for_issue</ggop>
///
/// \param id The issue to wait on. It may not be the issue this agent was assigned.
/// \returns gg's acknowledgement of the registered wait.
/// \throws core::tool_error `not_found` for an unknown id.
std::string wait_for_issue(std::string_view id);

}  // namespace board

}  // namespace gg
