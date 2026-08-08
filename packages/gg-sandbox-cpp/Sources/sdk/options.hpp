// The **optional arguments** of the calls that have more than one of them, and the two three-way
// edits.
//
// Two rules decide whether an argument is here at all, and they are the seam's rather than this
// arm's: required arguments stay POSITIONAL, and an optional one uses the language's own idiom. In
// C++23 that idiom is a **default argument** where there is one optional value, and an **aggregate
// filled in with designated initialisers** where there are several:
//
//   fs::read_file("src/main.cpp", {.limit = 40});
//   project::create_issue(title, in_scope, out_of_scope, criteria, "worker",
//                         {.epic_id = "AUTH", .reviewers = {"reviewer"}});
//
// C++ has no keyword arguments, so a defaulted parameter cannot be skipped over — which is exactly
// why the calls with two or more optional parts take one of these instead: `{.limit = 40}` names
// the one field it sets and says nothing about the rest, where `read_file(path, std::nullopt, 40)`
// would make a model count commas.
//
// EVERY FIELD OWNS ITS TEXT. `std::string` rather than `std::string_view`, deliberately: an options
// aggregate is built at the call site out of whatever the program has to hand, and a view of a
// temporary — `{.description = prefix + name}` — would dangle before the call read it. A copy of a
// title is nothing beside a host call.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "types.hpp"

namespace gg {

/// A **three-way** edit of an optional text field: leave it, empty it, or replace it.
///
/// The field really has three states, and an `std::optional<std::string>` could only say two of
/// them — which is how gg's older stringly interface ended up treating "clear it" and "set it to
/// the empty string" as one request. A default-constructed `text_edit` keeps the field, so a patch
/// that says nothing about a description leaves it alone.
class text_edit {
 public:
  /// Leave the field exactly as it is. This is what a default-constructed `text_edit` does, so a
  /// patch that omits the field never has to say it.
  text_edit() = default;

  /// Empty the field.
  ///
  /// \returns the edit to put in a patch.
  static text_edit clear();

  /// Replace the field with this text.
  ///
  /// \param text What the field becomes.
  /// \returns the edit to put in a patch.
  static text_edit set(std::string text);

  // Not model-facing: what the bridge reads back out of one. 0 keeps, 1 clears, 2 sets.
  std::uint8_t tag() const noexcept { return tag_; }
  const std::string& text() const noexcept { return text_; }

 private:
  std::uint8_t tag_{0};
  std::string text_;
};

/// How an issue's epic grouping changes — the same three-way shape as `text_edit`, for a field
/// whose value is an epic id.
class epic_assignment {
 public:
  /// Leave the grouping alone. This is what a default-constructed `epic_assignment` does.
  epic_assignment() = default;

  /// Detach the issue from its epic, leaving it ungrouped.
  ///
  /// \returns the change to put in a patch.
  static epic_assignment ungroup();

  /// Group the issue under an epic, by its id.
  ///
  /// \param epic_id The epic to move it under, as `project::create_epic` returned it.
  /// \returns the change to put in a patch.
  static epic_assignment set(std::string epic_id);

  // Not model-facing: what the bridge reads back out of one. 0 keeps, 1 ungroups, 2 sets.
  std::uint8_t tag() const noexcept { return tag_; }
  const std::string& epic_id() const noexcept { return epic_id_; }

 private:
  std::uint8_t tag_{0};
  std::string epic_id_;
};

/// The window of lines a read covers. Leave it out — or write `{}` — to read the whole file.
///
/// Both fields are honoured only under a **capped** read policy; under the unlimited policy the
/// whole file comes back and both are ignored. The system prompt says which policy this run uses.
struct read_window {
  /// The 1-based line to start at. Leave it out to start at the first line.
  std::optional<std::uint32_t> offset;
  /// How many lines to return from `offset`. Leave it out to read to the end.
  std::optional<std::uint32_t> limit;
};

/// The parts of a new task you may leave out. `{}` adds a task with no description and no
/// blockers.
struct task_options {
  /// What the work is, at whatever length is useful.
  std::optional<std::string> description;
  /// The ids of the tasks that must be done before this one.
  std::vector<std::string> blocked_by;
};

/// The fields a task revision may change. `{}` changes nothing, which the call refuses — supply at
/// least one.
struct task_patch {
  /// The title to replace the old one with.
  std::optional<std::string> title;
  /// A three-way edit of the description: leave it default to keep it, `text_edit::clear()` to
  /// empty it, `text_edit::set(…)` to replace it.
  text_edit description;
  /// Where the task now stands.
  std::optional<task_status> status;
};

/// The parts of a new issue you may leave out. `{}` creates an ungrouped issue with no
/// description, no blockers and no reviewers.
struct issue_options {
  /// What the work is. Written for a child agent with no other context.
  std::optional<std::string> description;
  /// The ids of every issue that must be done before this one.
  std::vector<std::string> blocked_by;
  /// The id of an existing epic to group it under. Leave it out to leave the issue ungrouped and
  /// numbered under `ISSUE`.
  std::optional<std::string> epic_id;
  /// The agents that must approve the work, from the set you may spawn. Required when this run's
  /// reviewers feature is on.
  std::vector<std::string> reviewers;
};

/// The fields an issue revision may change. `{}` changes nothing, which the call refuses — supply
/// at least one.
struct issue_patch {
  /// The title to replace the old one with.
  std::optional<std::string> title;
  /// A three-way edit of the description: leave it default to keep it, `text_edit::clear()` to
  /// empty it, `text_edit::set(…)` to replace it.
  text_edit description;
  /// The scope statement to replace the old one with.
  std::optional<std::string> in_scope;
  /// The non-scope statement to replace the old one with.
  std::optional<std::string> out_of_scope;
  /// The completion criteria to replace the old ones with.
  std::optional<std::string> completion_criteria;
  /// Where the issue now stands.
  std::optional<issue_status> status;
  /// A three-way change of epic grouping: leave it default to keep it,
  /// `epic_assignment::ungroup()` to detach the issue, `epic_assignment::set(…)` to regroup it.
  epic_assignment epic;
};

/// The two code halves every write of a memory accepts, and may leave out. `{}` records a memory
/// that is only prose.
///
/// Neither is context: they cost you no window, are never shown back to you, and count against no
/// body limit.
struct memory_options {
  /// A C++ translation unit whose declarations are bound at `lib::<name>` in every later program
  /// you write, so a helper you get right once you never write again.
  std::optional<std::string> code;
  /// A program gg runs the first time the memory comes into use, whose views reach you on your
  /// next turn.
  std::optional<std::string> on_use;
};

}  // namespace gg
