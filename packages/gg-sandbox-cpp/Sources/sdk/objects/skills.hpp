#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "../api.hpp"
#include "../types.hpp"

namespace gg {

/// read authored skills
///
/// A skill name is a plain string rather than an enumerator, because the catalogue is per run
/// while this SDK is compiled once. The names available are listed in the system prompt, and an
/// unknown one comes back as `not_found` carrying the full list.
namespace skills {

/// \copydoc gg::detail::api_object_list
std::vector<function_summary> list();

/// Read a skill by name and hand back its body with the front matter stripped; reading it also
/// pins that body permanently into your context, so a skill you have read stays read.
///
/// A skill may be **code** rather than prose, or as well as it. If it carries code, reading it
/// binds that code at `lib::<key>` for the rest of your session and the reply names the key and
/// what it offers. If it carries an on-use program, gg runs it once your program has ended, and
/// whatever it shows you arrives on your next turn.
///
/// \param name The skill's name, as the system prompt lists it.
/// \returns the skill's body, with its front matter stripped.
/// \throws tool_error `not_found` — listing the skills that do exist — when the name is unknown.
std::string read_skill(std::string_view name);

}  // namespace skills

}  // namespace gg
