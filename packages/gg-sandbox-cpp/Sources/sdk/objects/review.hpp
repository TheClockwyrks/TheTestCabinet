#pragma once

#include <string>
#include <vector>

#include "../api.hpp"
#include "../types.hpp"

namespace gg {

/// return your verdict on the work you are reviewing
///
/// An ending is a **result**, and a reviewer's result has a shape of its own: not what was done,
/// but whether it may stand. So it is its own pair of calls rather than a `finish` carrying a
/// verdict in prose, and they are bound only for a program whose agent is reviewing — an agent
/// doing work has `harness::finish` and no `review` object at all.
namespace review {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Accept the work you are reviewing: it meets every completion criterion and stays in scope. This
/// ends your session.
///
/// It does not stop your program — whatever follows it still runs — so call it last, once you have
/// actually read the change. It takes nothing: an approval carries no obligation beyond itself.
///
/// \throws tool_error `unavailable` when your role is not to review.
void approve();

/// Reject the work you are reviewing, listing every change that must be made before it can be
/// accepted. This ends your session, and does not stop your program.
///
/// Each item says what is wrong and what to change; the list may not be empty.
///
/// \param items Every change that must be made before the work can be accepted, one per entry:
///   what is wrong, and what to change. It may not be empty.
/// \throws tool_error `unavailable` when your role is not to review, and `invalid_argument` when
///   the list is empty.
void request_changes(std::vector<std::string> items);

}  // namespace review

}  // namespace gg
