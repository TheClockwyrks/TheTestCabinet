#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../types.hpp"

namespace gg {

/// delegate work to child agents
///
/// `wait_for_subagents` can dominate a turn's wall clock — it blocks while real agents run — and
/// the run's budget keeps ticking while it does. A program should therefore spawn broadly and wait
/// once, not spawn-and-wait in a loop.
///
/// The brief is where this arm's types earn their keep: a child is briefed either with a
/// self-contained `brief::prompt(…)` or with a board `brief::issue(…)`, and because that choice is
/// one value with two factories rather than two optional arguments, "both" and "neither" are
/// programs that do not compile.
namespace agents {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Delegate scoped work to a child agent and hand back its handle immediately — the child runs in
/// parallel while your program continues.
///
/// Name the `agent` to run it as (one of the agents you may spawn — the system prompt lists them;
/// it selects the child's model, tools, and instructions) and brief it with either
/// `brief::prompt("self-contained instructions")` or `brief::issue("AUTH-1")`. The child shares
/// your workspace.
///
/// \param agent The agent profile to run the child as, from the ones you may spawn. It selects the
///   child's model, tools and instructions.
/// \param task What the child is to do: `brief::prompt` with self-contained instructions, or
///   `brief::issue` with the id of a board issue to brief it from.
/// \returns the child's handle, to wait for it or message it.
/// \throws tool_error `limit_exceeded` at the delegation depth cap, and `invalid_argument` if
///   `agent` is not one you may spawn.
subagent_handle spawn_subagent(std::string_view agent, brief task);

// Two overloads rather than one function taking an optional list, because "every outstanding
// child" and "these children" are two calls in C++ and an `std::optional<std::vector<…>>` would
// have made the common one write `std::nullopt`. The catalogue documents the FULLER of the two, so
// its comment is the one that has to describe both shapes — which is why the shorter one's is a
// sentence and the longer one's is the paragraph.
/// Block until every outstanding child has finished; see the overload below.
///
/// \returns one result per child, in dispatch order.
std::vector<subagent_result> wait_for_subagents();

/// Block until the named children have finished, and collect their results in dispatch order.
///
/// Called with **no arguments at all** it waits for every child still outstanding, which is the
/// usual shape: the run's wall-clock budget keeps running while you wait, so wait once for many
/// children rather than once per child.
///
/// \param ids The children to wait for, as `agents::spawn_subagent` returned them.
/// \returns one result per named child, in dispatch order.
/// \throws tool_error `not_found` for an unknown id.
std::vector<subagent_result> wait_for_subagents(std::vector<std::string> ids);

/// Deliver a message to a running child agent's inbox; it reads the message at its next turn.
///
/// \param agent_id The child to deliver to, as `agents::spawn_subagent` returned it.
/// \param message What to put in its inbox. It reads it at its next turn.
/// \throws tool_error `not_found` for an unknown agent id, and `conflict` when that child has
///   already returned.
void send_message(std::string_view agent_id, std::string_view message);

/// Move the process you are running inside on to another of its states, naming the state the way
/// you name an agent to spawn.
///
/// Bound only when a state machine is driving you and the state you are in has somewhere to go.
/// Like `context::compact` it is registered rather than performed: the call validates the target,
/// returns, and your program runs on to its end — the transition happens after that, because
/// replacing your agent (and your window) mid-program would pull every remaining call out from
/// under it. The FIRST declaration stands.
///
/// \param state The state to move on to, named the way you name an agent to spawn.
/// \param note The opening message the next state's agent sees; leave it out to tell it nothing.
/// \throws tool_error `invalid_argument` for a state you may not move to, and `refused` for a
///   second declaration in one turn.
void transition_state(std::string_view state, std::optional<std::string_view> note = std::nullopt);

/// Continue this session as a different agent: the named agent takes over from your next turn with
/// its own model, tools and instructions, keeping every capability the two of you both have — your
/// whole conversation above all, so it needs no catching up.
///
/// Registered rather than performed, exactly as `agents::transition_state` is and for the same
/// reason: your window would otherwise be pulled out from under the program still composing into
/// it. A session makes one succession per turn. Bound only when your agent may make agent
/// transitions and has agents it may become, and never while a state machine is driving you.
///
/// \param agent The agent to become, from the ones you may become.
/// \param prompt Its opening message. It already has your whole conversation, so this is the
///   instruction rather than a briefing; leave it out to tell it nothing.
/// \throws tool_error `invalid_argument` for an agent you may not become, and `refused` for a
///   second succession in one turn.
void exec(std::string_view agent, std::optional<std::string_view> prompt = std::nullopt);

/// Run a copy of yourself, in parallel, on something you will not do yourself.
///
/// The copy has your model, your tools and a private copy of your whole conversation, so `prompt`
/// is the *difference* rather than a briefing — everything you have worked out is already there.
///
/// Its handle comes back immediately, but the copy itself starts once this turn's tool results are
/// recorded (the conversation it inherits has to be a complete one), so
/// `agents::wait_for_subagents` can only collect it on a later turn — do not wait on it in the
/// program that made it.
///
/// \param prompt What the copy is to do instead of what you are doing. It has your whole
///   conversation already, so write the difference rather than a briefing.
/// \returns the copy's handle.
/// \throws tool_error `limit_exceeded` at the delegation depth cap.
subagent_handle fork(std::string_view prompt);

}  // namespace agents

}  // namespace gg
