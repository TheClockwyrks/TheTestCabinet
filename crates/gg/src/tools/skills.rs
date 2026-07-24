//! The `read_skill` tool: load an authored [skill](crate::skills)'s body into context.
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

use super::{Tool, ToolContext, ToolOutcome, required_str};
use crate::model::ToolDefinition;
use crate::skills::SkillLibrary;

/// The tool name the loop keys skill-specific context handling on.
pub const READ_SKILL_TOOL: &str = "read_skill";

/// Reads an authored skill by name, returning its body (front matter stripped).
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
        // List the available skill names in the description so the schema is self-contained
        // even apart from the system-prompt catalog.
        let available: Vec<&str> = self
            .library
            .skills()
            .iter()
            .map(|skill| skill.name())
            .collect();
        let description = format!(
            "Read an authored skill by name and load its full contents into your context \
             (they remain available for the rest of the session). Skills are short guides \
             for parts of this task; their names and descriptions are listed in your \
             system prompt. Available skills: {}.",
            available.join(", ")
        );
        ToolDefinition::new(
            READ_SKILL_TOOL,
            description,
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name of the skill to read (as listed in the system prompt).",
                        "enum": available,
                    }
                },
                "required": ["name"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        let name = match required_str(&args, "name", READ_SKILL_TOOL) {
            Ok(name) => name,
            Err(message) => return ToolOutcome::error(message),
        };

        match self.library.get(&name) {
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
                ToolOutcome::error(format!(
                    "read_skill: no skill named `{name}`; available skills: {}",
                    available.join(", ")
                ))
            }
        }
    }
}

#[cfg(test)]
#[path = "skills.test.rs"]
mod tests;
