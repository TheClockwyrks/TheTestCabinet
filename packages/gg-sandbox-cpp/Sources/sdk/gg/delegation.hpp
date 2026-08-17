// The **delegation** module: child agents, and the two ways a session hands itself on.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core.hpp"

namespace gg {

/// Delegate work to child agents, and hand this session on to another agent.
///
/// Waiting can dominate a turn's wall clock, because it blocks while real agents run and the run's
/// budget keeps ticking, so a program spawns broadly and waits once rather than spawning and
/// waiting in a loop.
///
/// <ggmodule>delegation</ggmodule>
namespace delegation {

/// What a child agent is briefed with: self-contained instructions, or a board issue.
///
/// One value with two named factories rather than two optional arguments, so that "both" and
/// "neither" are programs which do not compile instead of calls that fail at run time. There is
/// nothing to read back off it: a program builds one and hands it over.
class brief {
 public:
  /// Brief the child with self-contained instructions, which it needs no other context to act on.
  ///
  /// \param instructions What the child is to do, written for a reader with no other context.
  static delegation::brief prompt(std::string instructions);

  /// Brief the child from a board issue, which becomes its instructions.
  ///
  /// The issue's scope, non-scope and completion criteria are what the child is given.
  ///
  /// \param id The issue's id, as the board assigned it.
  static delegation::brief issue(std::string id);

  // Not model-facing: what the bridge reads back out of one.
  bool is_issue() const noexcept { return issue_; }
  const std::string& text() const noexcept { return text_; }

 private:
  brief(bool issue, std::string text) : issue_(issue), text_(std::move(text)) {}

  bool issue_;
  std::string text_;
};

/// A child agent that was spawned and is now running in parallel.
struct subagent_handle {
  /// The child's id, which is what waiting for it and messaging it take.
  std::string id;
  /// The agent profile it runs as.
  std::string slot;
  /// The model actually bound to that agent.
  std::string model_id;

  /// Deliver a message to this child's inbox, which it reads at its next turn.
  ///
  /// <ggop-alias>delegation.send_message</ggop-alias>
  ///
  /// \param message What to put in its inbox.
  /// \throws gg::core::api_error `conflict` when this child has already returned.
  void send(std::string_view message) const;
};

/// How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
enum class agent_status {
  /// It finished normally, and its summary is what it returned.
  completed,
  /// It hit the per-run turn ceiling.
  exhausted,
  /// It passed its wall-clock deadline.
  timed_out,
  /// A model turn failed.
  model_error,
  /// The run's credential was refused.
  auth_error,
  /// An execution ceiling stopped it: consecutive errors, error rate, or cost.
  limit_exceeded,
};

/// One child agent's collected result.
struct subagent_result {
  /// The child's id.
  std::string id;
  /// How it finished; empty when it produced no return value at all.
  std::optional<delegation::agent_status> status;
  /// Its final message.
  std::string summary;
};

/// Delegate scoped work to a child agent and hand back its handle immediately.
///
/// The child runs in parallel while the program continues, and shares the workspace. The agent
/// profile selects its model, its tools and its instructions, and the system prompt lists the ones
/// this agent may spawn.
///
/// <ggop>delegation.spawn_subagent</ggop>
///
/// \param agent The agent profile to run the child as, from the ones this agent may spawn.
/// \param task What the child is to do: `gg::delegation::brief::prompt` with self-contained
///   instructions, or `gg::delegation::brief::issue` with a board issue's id.
/// \returns the child's handle, for waiting on it or messaging it.
/// \throws gg::core::api_error `limit_exceeded` at the delegation depth cap, and `invalid_argument`
///   for an agent this agent may not spawn.
delegation::subagent_handle spawn_subagent(std::string_view agent, delegation::brief task);

// Two overloads rather than one function taking an optional list, because "every outstanding
// child" and "these children" are two calls in C++ and an `std::optional<std::vector<…>>` would
// have made the common one write `std::nullopt`. The catalogue documents the FULLER of the two, so
// its comment is the one that has to describe both shapes — which is why the shorter one's is a
// sentence and the longer one's is the paragraph.
/// Block until every outstanding child has finished; see the overload that names them.
///
/// \returns one result per child, in dispatch order.
std::vector<delegation::subagent_result> wait_for_subagents();

/// Block until the named children have finished, and collect their results in dispatch order.
///
/// Called with no arguments at all it waits for every child still outstanding, which is the usual
/// shape: the run's wall-clock budget keeps running throughout, so one wait for many children
/// costs less than one wait per child.
///
/// <ggop>delegation.wait_for_subagents</ggop>
///
/// \param ids The children to wait for, as spawning them returned their handles.
/// \returns one result per named child, in dispatch order.
/// \throws gg::core::api_error `not_found` for an unknown id.
std::vector<delegation::subagent_result> wait_for_subagents(std::vector<std::string> ids);

/// Deliver a message to a running child agent's inbox, which it reads at its next turn.
///
/// <ggop>delegation.send_message</ggop>
///
/// \param agent_id The child to deliver to, as spawning it returned its handle.
/// \param message What to put in its inbox.
/// \throws gg::core::api_error `not_found` for an unknown agent id, and `conflict` when that child
///   has already returned.
void send_message(std::string_view agent_id, std::string_view message);

/// Move the process this agent is running inside on to another of its states.
///
/// It is bound only when a state machine is driving the agent and the current state has somewhere
/// to go. Like a compaction it is registered rather than performed: the call validates the target
/// and returns, the program runs on to its end, and the transition happens after that — replacing
/// the agent, and its window, mid-program would pull every remaining call out from under it. The
/// first declaration in a turn stands.
///
/// <ggop>delegation.transition_state</ggop>
///
/// \param state The state to move on to, named the way an agent to spawn is named.
/// \param note The opening message the next state's agent sees; empty tells it nothing.
/// \throws gg::core::api_error `invalid_argument` for a state this agent may not move to, and
///   `refused` for a second declaration in one turn.
void transition_state(std::string_view state, std::optional<std::string_view> note = std::nullopt);

/// Continue this session as a different agent from the next turn on.
///
/// The named agent takes over with its own model, tools and instructions, keeping every capability
/// the two of them share — the whole conversation above all, so it needs no catching up.
/// Registered rather than performed, exactly as a state transition is and for the same reason, and
/// a session makes one succession per turn. It is bound only for an agent that may make agent
/// transitions and has agents it may become, and never while a state machine is driving it.
///
/// <ggop>delegation.exec</ggop>
///
/// \param agent The agent to become, from the ones this agent may become.
/// \param prompt Its opening message. It already has the whole conversation, so this is the
///   instruction rather than a briefing; empty tells it nothing.
/// \throws gg::core::api_error `invalid_argument` for an agent this agent may not become, and
///   `refused` for a second succession in one turn.
void exec(std::string_view agent, std::optional<std::string_view> prompt = std::nullopt);

/// Run a copy of this agent, in parallel, on something it will not do itself.
///
/// The copy has the same model, the same tools and a private copy of the whole conversation, so
/// the prompt is the difference rather than a briefing. Its handle comes back immediately, but the
/// copy starts once this turn's results are recorded — the conversation it inherits has to be a
/// complete one — so it can only be collected on a later turn and never in the program that made
/// it.
///
/// <ggop>delegation.fork</ggop>
///
/// \param prompt What the copy is to do instead. It has the whole conversation already, so this is
///   the difference rather than a briefing.
/// \returns the copy's handle.
/// \throws gg::core::api_error `limit_exceeded` at the delegation depth cap.
delegation::subagent_handle fork(std::string_view prompt);

}  // namespace delegation

}  // namespace gg
