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

/// End this session, in the shape this session's role ends one.
///
/// Each role is bound one of these calls. None of them stops the program: whatever follows still
/// runs, and a program that then fails cancels the ending.
///
/// <ggmodule>session</ggmodule>
namespace session {

/// End this session, reporting what was done in a sentence or two.
///
/// It does not stop the program: whatever follows it still runs.
///
/// <ggop>session.finish</ggop>
///
/// \param summary What was done, in a sentence or two.
/// \throws gg::core::api_error `unavailable` when this session's role does not end this way, and
///   `invalid_argument` for an empty summary.
void finish(std::string_view summary);

/// Accept the work under review: it meets every completion criterion and stays in scope.
///
/// It ends the reviewing session, takes nothing, and does not stop the program.
///
/// <ggop>session.approve</ggop>
///
/// \throws gg::core::api_error `unavailable` when this session's role is not to review.
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
/// \throws gg::core::api_error `unavailable` when this session's role is not to review, and
///   `invalid_argument` when the list is empty.
void request_changes(std::vector<std::string> items);

}  // namespace session

}  // namespace gg
