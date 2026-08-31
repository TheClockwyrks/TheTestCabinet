//! Read the skills this run authored.
//!
//! The names available are listed in the system prompt, and an unknown one comes back as `NotFound`
//! carrying the full list.

use crate::bindings::test_cabinet::gg::skills;
use crate::core::ApiError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::OPERATIONS`](crate::files::OPERATIONS).
pub(crate) const OPERATIONS: &[&str] = &["read_skill"];

/// Read a skill by name and hand back its body with the front matter stripped.
///
/// The body is pinned permanently into context.
///
/// A skill may be code rather than prose, or as well as it. Its code becomes a crate every later
/// program this session writes reaches as `<key>::<name>`, and using it opens a documentation view
/// of each function that crate declares. An on-use program runs once this program has ended, and
/// whatever it shows arrives on the next turn.
///
/// # Arguments
///
/// * `name` — The skill's name, as the system prompt lists it.
///
/// # Returns
///
/// The skill's body with its front matter stripped.
///
/// # Errors
///
/// `NotFound` — listing the skills that do exist — when the name is unknown.
#[doc(alias = "ggop:skills.read_skill")]
pub fn read_skill(name: &str) -> Result<String, ApiError> {
    wire::lift(skills::read_skill(name))
}
