//! The skills **gg itself ships**: one per family of the functions it offers.
//!
//! Without these the [skills](super) capability is a mechanism with nothing in it. A run's skills
//! directory is authored by whoever set the run up, and the overwhelming majority of runs author
//! none — so an agent was offered a capability whose library was empty, and the feature did nothing
//! at all unless somebody had thought to fill it.
//!
//! # Generated, never written
//!
//! Not one word of a built-in skill's content is prose kept here. Everything comes from the same two
//! places the rest of gg's model-facing surface comes from:
//!
//! * under **native tool calling**, from the live [`ToolDefinition`]s of the agent's own registry —
//!   the name, the description and the parameters it will really be called with;
//! * under **responses-as-code**, from an [on-use script](super::Skill::on_use) that opens one
//!   documentation view per function, which routes through the same
//!   [`view.openDocsView`](crate::docs::DocsRuntime) the model could have called itself.
//!
//! So a built-in skill cannot drift from the tools it describes: there is no second copy of the
//! description to fall out of date, and a tool that is renamed is renamed in the only place its name
//! appears.
//!
//! # Only what the agent has
//!
//! A family is offered **only when the agent has at least one of its functions**. A skill that
//! described a tool this run withheld would be the one thing a directory must never do, and it is
//! the same rule the [docs runtime](crate::docs::DocsRuntime) already obeys — which is why the
//! responses-as-code arm can simply hand it the names and let it answer.
//!
//! # Selecting them
//!
//! Each is a checkbox on the skills capability: the `builtIns` param records the ones an operator
//! switched **off**, so an unconfigured run gets all of them and a run that wants to measure an
//! agent without a manual can withhold exactly the families it means to.

use std::collections::BTreeSet;

use serde_json::Value;

use super::{Skill, parse_skill};
use crate::ending::EndingRole;
use crate::model::ToolDefinition;

/// The `params` key on the [skills](test_cabinet_core::gg::CAPABILITY_SKILLS) capability naming
/// which built-in skills the agent is offered.
///
/// Read the way every toggle set is: an object of `{ "<id>": false }` recording only the ones
/// switched **off**, so an absent param — the default — offers all of them.
pub const PARAM_BUILT_INS: &str = "builtIns";

/// One family gg ships a skill for: what the skill is called, what it is for, and how to tell
/// whether this agent has any of it.
///
/// Crate-visible rather than private because the families are also gg's own **grouping of its
/// model-facing surface** — the order the system prompt's API table uses, the objects a program
/// reaches each family through — and the [reference](crate::reference) projects that grouping as
/// the categories the console's Reference section is organized by. There is one list of families,
/// and it is this one.
pub(crate) struct Family {
    /// The skill's name — the handle `read_skill` takes, and the id the `builtIns` param uses.
    pub(crate) id: &'static str,
    /// The display title for the family, for a **human** reading a catalogue of gg's surface.
    ///
    /// Deliberately not part of anything a model is shown: a skill's front matter carries the
    /// [`id`](Self::id) and the [`description`](Self::description) and nothing else, and adding a
    /// third string to it would be prose gg wrote for itself sitting in the model's window.
    pub(crate) title: &'static str,
    /// The one-line description the skills index carries.
    pub(crate) description: &'static str,
    /// The [API objects](crate::sandbox::CatalogueFunction) its functions are grouped under in a
    /// program's scope, which is also what the responses-as-code arm asks the catalogue for.
    ///
    /// A list rather than one name because of the ending family: `harness`, `review` and `judge` are
    /// one family grouped by **role**, and exactly one of them is bound. Asking for all three and
    /// keeping what comes back is how the skill describes the ending this agent really has.
    pub(crate) objects: &'static [&'static str],
    /// The gg tool names in it. Empty for the three families that are responses-as-code carve-outs
    /// and have no native tools at all — they are offered only in code mode.
    pub(crate) tools: &'static [&'static str],
}

/// Every family gg ships a skill for, in the order the index lists them.
///
/// The order is the one the system prompt's API table uses, which is roughly "the workspace, then
/// the work, then yourself": a reader of the index meets the families in the order they matter. The
/// [reference](crate::reference) keeps it, so the console's categories arrive in the order gg means
/// them to be read in.
pub(crate) const FAMILIES: &[Family] = &[
    Family {
        id: "gg-filesystem",
        title: "Filesystem",
        description: "Reading, writing and editing files in the workspace.",
        objects: &["fs"],
        tools: &["read_file", "write_file", "edit_file", "list_dir"],
    },
    Family {
        id: "gg-shell",
        title: "Shell",
        description: "Running shell commands in the workspace.",
        objects: &["system"],
        tools: &["shell"],
    },
    Family {
        id: "gg-project",
        title: "Project management",
        description: "The epic/issue board — decomposing work into issues other agents implement.",
        objects: &["project"],
        tools: &[
            "create_epic",
            "create_issue",
            "update_issue",
            "set_issue_blocked_by",
            "remove_epic",
            "remove_issue",
            "wait_for_issue",
        ],
    },
    Family {
        id: "gg-tasks",
        title: "Tasks",
        description: "Your task list: a blocked-by DAG of the work you are steering by.",
        objects: &["tasks"],
        tools: &[
            "add_task",
            "update_task",
            "set_blocked_by",
            "complete_task",
            "remove_task",
        ],
    },
    Family {
        id: "gg-memory",
        title: "Memories",
        description: "Durable memories that outlive the conversation you wrote them in.",
        objects: &["memory"],
        tools: &[
            "write_memory",
            "update_memory",
            "create_memory",
            "read_memory",
            "edit_memory",
            "search_memories",
            "delete_memory",
        ],
    },
    Family {
        id: "gg-skills",
        title: "Skills",
        description: "Reading skills — including this one.",
        objects: &["skills"],
        tools: &["read_skill"],
    },
    Family {
        id: "gg-context",
        title: "Context",
        description: "Managing your own context window: evicting, archiving, searching, compacting.",
        objects: &["context"],
        tools: &[
            "evict_file_view",
            "archive_thread",
            "search_archive",
            "compact",
        ],
    },
    Family {
        id: "gg-delegation",
        title: "Delegation",
        description: "Delegating work to child agents, and handing your session on.",
        objects: &["agents"],
        tools: &[
            "spawn_subagent",
            "wait_for_subagents",
            "send_message",
            "run_workflow",
            "speculate",
            "transition_state",
            "exec",
            "fork",
        ],
    },
    Family {
        id: "gg-views",
        title: "Views",
        description: "Showing yourself a file, a value, or a function's documentation.",
        objects: &["view"],
        tools: &[],
    },
    Family {
        id: "gg-programs",
        title: "Program library",
        description: "Fetching a program you already ran, and handing a patched copy back.",
        objects: &["programs"],
        tools: &[],
    },
    Family {
        id: "gg-session",
        title: "Ending the session",
        description: "Ending your session — the one call that does.",
        objects: &["harness", "review", "judge"],
        tools: &[],
    },
];

/// The built-in skills this agent is offered.
///
/// `offered` is the agent's own tool vocabulary (the registry's names, which is what
/// [`scope_tools`](crate::sandbox::scope_tools) hands the sandbox); `definitions` is the same
/// registry's live [`ToolDefinition`]s, which the native arm renders its bodies from; `code_mode`
/// picks which of the two arms a family's skill is built in; `params` is the skills capability's
/// params, read for the [`builtIns`](PARAM_BUILT_INS) toggles.
///
/// A family with nothing bound is not offered at all. In code mode the three carve-out families
/// (`view`, `programs`, `harness`) are decided by [`DocsRuntime`](crate::docs::DocsRuntime) rather
/// than by a tool name, so they are asked for their directory; under native tool calling they do not
/// exist, and are absent.
pub fn builtin_skills(
    offered: &[String],
    definitions: &[ToolDefinition],
    role: EndingRole,
    library: bool,
    code_mode: bool,
    params: &Value,
) -> Vec<Skill> {
    let off = switched_off(params);
    let offered: BTreeSet<&str> = offered.iter().map(String::as_str).collect();
    let docs = crate::docs::DocsRuntime::new(
        offered.iter().map(|name| (*name).to_string()).collect(),
        role,
        library,
    );

    FAMILIES
        .iter()
        .filter(|family| !off.contains(family.id))
        .filter_map(|family| {
            if code_mode {
                built_in_code(family, &docs)
            } else {
                built_in_native(family, &offered, definitions)
            }
        })
        .collect()
}

/// The ids an operator switched **off** in the `builtIns` param.
///
/// The same shape every toggle set uses: an object whose `false` entries are the withheld ones. A
/// param of any other shape is ignored rather than rejected, in line with how gg reads every other
/// capability value it cannot make sense of.
fn switched_off(params: &Value) -> BTreeSet<String> {
    params
        .get(PARAM_BUILT_INS)
        .and_then(Value::as_object)
        .map(|toggles| {
            toggles
                .iter()
                .filter(|(_, on)| on.as_bool() == Some(false))
                .map(|(id, _)| id.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// The native-tool-calling arm: a plain-text body, one section per tool the agent really has, built
/// from the live [`ToolDefinition`]s.
///
/// The parameters are rendered from the schema rather than described, because the schema is what the
/// model is held to. Only the top-level properties are listed — a schema printed whole would be
/// several screens per family, and what a reader of a skill wants is the shape of the call, not its
/// full grammar.
fn built_in_native(
    family: &Family,
    offered: &BTreeSet<&str>,
    definitions: &[ToolDefinition],
) -> Option<Skill> {
    let mut sections: Vec<String> = Vec::new();
    for tool in family.tools {
        if !offered.contains(tool) {
            continue;
        }
        let Some(definition) = definitions.iter().find(|candidate| candidate.name == *tool) else {
            continue;
        };
        let mut section = format!("## `{}`\n\n{}", definition.name, definition.description);
        let parameters = describe_parameters(&definition.parameters);
        if !parameters.is_empty() {
            section.push_str("\n\nParameters:\n");
            for parameter in parameters {
                section.push_str(&format!("\n- {parameter}"));
            }
        }
        sections.push(section);
    }
    if sections.is_empty() {
        return None;
    }
    Some(skill(
        family,
        format!("# {}\n\n{}", family.description, sections.join("\n\n")),
        None,
    ))
}

/// One line per top-level property of a tool's JSON schema: its name, whether it is required, and
/// its one-line description.
fn describe_parameters(schema: &Value) -> Vec<String> {
    let required: BTreeSet<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            properties
                .iter()
                .map(|(name, property)| {
                    let kind = property
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("any");
                    let optional = if required.contains(name.as_str()) {
                        ""
                    } else {
                        ", optional"
                    };
                    let description = property
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    format!("`{name}` ({kind}{optional}) — {description}")
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The responses-as-code arm: an **on-use script** that opens one documentation view per function in
/// the family, and no body and no importable code at all.
///
/// The script is generated rather than authored because the set of functions is: it is exactly what
/// `<object>.list()` would answer for this agent, so a skill that hard-coded a list would be a
/// second answer to a question that already has one. What the model gets is the same material
/// `view.openDocsView` gives it — the signature, the description, and every type they refer to — for
/// the whole family at once, on the turn after it read the skill.
fn built_in_code(family: &Family, docs: &crate::docs::DocsRuntime) -> Option<Skill> {
    // `list` is on every object and documents itself; a skill that opened a view of it for each of
    // eleven families would put eleven identical blocks in the window.
    let functions: Vec<String> = family
        .objects
        .iter()
        .flat_map(|object| docs.list(object))
        .map(|function| function.name)
        .filter(|name| name != "list")
        .collect();
    if functions.is_empty() {
        return None;
    }
    let opens = functions
        .iter()
        .map(|name| format!("  {:?},", name))
        .collect::<Vec<_>>()
        .join("\n");
    let script = format!(
        "const functions = [\n{opens}\n];\nfor (const name of functions) {{\n  \
         view.openDocsView(name);\n}}\n"
    );
    Some(skill(family, String::new(), Some(script)))
}

/// A [`Skill`] for `family` with the given body and on-use script, marked
/// [built in](super::SkillOrigin::BuiltIn).
///
/// It goes through [`parse_skill`] rather than constructing a `Skill` directly so a built-in is
/// assembled by exactly the code an authored skill is, front matter included — there is one parser,
/// and no second way for a skill to come into being.
fn skill(family: &Family, body: String, on_use: Option<String>) -> Skill {
    let raw = format!(
        "---\nname: {}\ndescription: {}\n---\n{body}",
        family.id, family.description
    );
    parse_skill(&raw, family.id).with_code(None, on_use)
}

#[cfg(test)]
#[path = "skills.builtin.test.rs"]
mod tests;
