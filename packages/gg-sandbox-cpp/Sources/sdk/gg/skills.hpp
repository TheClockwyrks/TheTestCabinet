// The **skills** module: authored skills, read by name.
//
// This file is model-facing: everything a `///` says here is reflected into the signature catalogue
// and reaches a model. `//` comments are for whoever maintains it.

#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "core.hpp"

namespace gg {

/// Read the skills this run was given.
///
/// The system prompt lists the names available; an unknown one comes back as `not_found` carrying
/// the full list.
///
/// <ggmodule>skills</ggmodule>
namespace skills {

/// Read a skill by name, which also pins its body permanently into the context window.
///
/// The body comes back with its front matter stripped. A skill may be code rather than prose, or
/// as well as it: its code becomes a module every later program reaches by writing
/// `import lib.<key>;`, a documentation view opens on each function that module declares, and an
/// on-use program runs once this program has ended, with whatever it shows arriving on the next
/// turn.
///
/// <ggop>skills.read_skill</ggop>
///
/// \param name The skill's name, as the system prompt lists it.
/// \returns the skill's body, with its front matter stripped.
/// \throws gg::core::api_error `not_found`, listing the skills that do exist, when the name is
///   unknown.
std::string read_skill(std::string_view name);

}  // namespace skills

}  // namespace gg
