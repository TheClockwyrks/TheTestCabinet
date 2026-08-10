//! Read the skills this run authored.
//!
//! The names available are listed in the system prompt, and an unknown one comes back as `NotFound`
//! carrying the full list.

use crate::bindings::test_cabinet::gg::skills;
use crate::core::ToolError;
use crate::wire;

/// The gg tools this module dispatches — see [`files::TOOLS`](crate::files::TOOLS).
pub(crate) const TOOLS: &[&str] = &["read_skill"];

crate::directory::directory_of!();

/// Read a skill by name and hand back its body with the front matter stripped.
///
/// Reading it also pins that body permanently into context, so a skill that has been read stays read.
///
/// A skill may be **code** rather than prose, or as well as it. Code is bound at `lib::<key>` for the
/// rest of the session and the reply names the key and what it offers. An on-use program runs once
/// this program has ended, and whatever it shows arrives on the next turn.
///
/// # Arguments
///
/// * `name` — The skill's name, as the system prompt lists it.
///
/// # Errors
///
/// `NotFound` — listing the skills that do exist — when the name is unknown.
#[doc(alias = "ggop:skills.read_skill")]
pub fn read_skill(name: &str) -> Result<String, ToolError> {
    wire::lift(skills::read_skill(name))
}
