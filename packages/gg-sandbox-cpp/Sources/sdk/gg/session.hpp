// The **session** module: the three calls that end one.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "core.hpp"

namespace gg {

/// End this session, in the shape the agent's own role ends one.
///
/// Under responses as code every reply is a program, so there is no prose turn that could mean "I
/// am done": a model that answers "task complete" has written a reply that failed to be a program
/// rather than an ending. These are the calls that mean it, and an agent is bound the one its role
/// uses — an agent doing work ends by reporting what it did, and a reviewer ends with a verdict.
///
/// None of them stops the program: whatever follows still runs, so an ending belongs last, once
/// the work is confirmed done. A program that then fails cancels the ending and earns another
/// turn.
///
/// <ggmodule>session</ggmodule>
namespace session {

/// \copydoc gg::detail::module_directory
std::vector<core::function_summary> list();

/// End this session, reporting what was done in a sentence or two.
///
/// It is the only thing that ends a working agent's session, and it does not stop the program:
/// whatever follows it still runs, so it belongs last, once the tools have confirmed the work is
/// really done.
///
/// <ggop>session.finish</ggop>
///
/// \param summary What was done, in a sentence or two.
/// \throws core::tool_error `unavailable` when this agent's role does not end this way, and
///   `invalid_argument` for an empty summary.
void finish(std::string_view summary);

/// Accept the work under review: it meets every completion criterion and stays in scope.
///
/// It ends the reviewing session and takes nothing, because an approval carries no obligation
/// beyond itself. It does not stop the program, so it belongs after the change has actually been
/// read.
///
/// <ggop>session.approve</ggop>
///
/// \throws core::tool_error `unavailable` when this agent's role is not to review.
void approve();

/// Reject the work under review, listing every change that must be made before it can stand.
///
/// It ends the reviewing session and does not stop the program. Each item says what is wrong and
/// what to change, and the list may not be empty.
///
/// <ggop>session.request_changes</ggop>
///
/// \param items Every change that must be made before the work can be accepted, one per entry. It
///   may not be empty.
/// \throws core::tool_error `unavailable` when this agent's role is not to review, and
///   `invalid_argument` when the list is empty.
void request_changes(std::vector<std::string> items);

}  // namespace session

}  // namespace gg
