//! The `read_skill` tool: load a [skill](crate::skills)'s body into context.
//!
//! Unlike `read_file`, `read_skill` takes a skill **name** (not a path), returns the
//! skill's body with its front matter stripped, and — crucially — the loop records the
//! result as a [`Skill`](test_cabinet_core::gg::GgContextSource)-sourced, **pinned**
//! context item so it is retained across a compaction boundary (see
//! [`crate::agent`]). The tool itself only resolves the name to a body; the pinning and
//! the "already read, do not duplicate" bookkeeping live in the loop, which owns the
//! context model and the [`SkillsRuntime`](crate::skills::SkillsRuntime).
//!
//! The tool is contributed to the registry only when the
//! [`skills`](test_cabinet_core::gg::CAPABILITY_SKILLS) capability is enabled **and** the
//! run's [`SkillLibrary`] actually holds skills — a run with no skills offers no
//! `read_skill` tool at all.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolFailure, ToolOutcome, required_str};
use crate::model::ToolDefinition;
use crate::skills::SkillLibrary;

/// The tool name the loop keys skill-specific context handling on.
pub const READ_SKILL_TOOL: &str = "read_skill";

/// Reads a skill by name, returning its body (front matter stripped).
pub struct ReadSkillTool {
    /// The shared skill catalog this tool resolves names against.
    library: Arc<SkillLibrary>,
}

impl ReadSkillTool {
    /// A tool resolving names against `library`.
    pub fn new(library: Arc<SkillLibrary>) -> Self {
        Self { library }
    }
}

#[async_trait]
impl Tool for ReadSkillTool {
    fn name(&self) -> &str {
        READ_SKILL_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        // The `name` enum carries the run's catalogue, so the schema is self-contained without the
        // description repeating the list the system prompt already gives with each skill's purpose.
        let available: Vec<&str> = self
            .library
            .skills()
            .iter()
            .map(|skill| skill.name())
            .collect();
        ToolDefinition::new(
            READ_SKILL_TOOL,
            "Read a skill by name.",
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Skill to read.",
                        "enum": available,
                    }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let name = match required_str(&args, "name") {
            Ok(name) => name,
            Err(error) => return error.into(),
        };
        self.read(name)
    }
}

impl ReadSkillTool {
    /// Read a skill body by name — the **standard, typed** `read_skill` API function both the JSON
    /// [adapter](Tool::invoke) and the [responses-as-code membrane](crate::sandbox) reach.
    pub(crate) fn read(&self, name: String) -> ToolOutcome {
        match self.library.get(&name) {
            // The skill's body *is* the structured result — there is nothing about it to describe
            // that the text does not already say — so this call carries no sidecar.
            Some(skill) => {
                ToolOutcome::ok(skill.body().to_string(), format!("read skill `{name}`"))
            }
            None => {
                let available: Vec<&str> = self
                    .library
                    .skills()
                    .iter()
                    .map(|skill| skill.name())
                    .collect();
                // A name that is not in this run's catalogue: not-found, with the catalogue in the
                // message so the model can pick a real one on the next call.
                ToolOutcome::failed(
                    ToolFailure::NotFound,
                    format!(
                        "no skill named `{name}`; available skills: {}",
                        available.join(", ")
                    ),
                )
            }
        }
    }
}

#[cfg(test)]
#[path = "skills.test.rs"]
mod tests;
