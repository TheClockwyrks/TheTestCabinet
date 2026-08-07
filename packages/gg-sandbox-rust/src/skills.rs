//! read authored skills
//!
//! A skill name is a plain `&str` rather than an arm of an `enum`, because the catalogue is per run
//! while this crate is compiled once. The names available are listed in the system prompt, and an
//! unknown one comes back as `NotFound` carrying the full list.

use crate::bindings::test_cabinet::gg::skills;
use crate::error::ToolError;
use crate::wire;

/// The gg tools this object dispatches — see [`fs::TOOLS`](crate::fs::TOOLS).
pub(crate) const TOOLS: &[&str] = &["read_skill"];

crate::meta::directory_of!("skills");

/// Read a skill by name and hand back its body with the front matter stripped; reading it also pins
/// that body permanently into your context, so a skill you have read stays read.
///
/// A skill may be **code** rather than prose, or as well as it. If it carries code, reading it binds
/// that code at `lib::<key>` for the rest of your session and the reply names the key and what it
/// offers. If it carries an on-use program, gg runs it once your program has ended, and whatever it
/// shows you arrives on your next turn.
///
/// # Arguments
///
/// * `name` — The skill's name, as the system prompt lists it.
///
/// # Errors
///
/// `NotFound` — listing the skills that do exist — when the name is unknown.
pub fn read_skill(name: &str) -> Result<String, ToolError> {
    wire::lift(skills::read_skill(name))
}
