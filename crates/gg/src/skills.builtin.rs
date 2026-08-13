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
use test_cabinet_core::gg::GgProgramLanguage;

use super::{CodeFiles, Skill, parse_skill};
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
/// model-facing surface** — the order the system prompt's API table uses — and the
/// [reference](crate::reference) projects that grouping as the categories the console's Reference
/// section is organized by. There is one list of families, and it is this one.
///
/// A family's grouping is resolved through the [operation](crate::sandbox::operation_of) each call
/// binds, which every arm answers, rather than through gg's own word for an API object, which
/// answers nothing on an arm whose surface is capability modules.
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
    /// The gg tool names in it. Empty for the four families that are responses-as-code carve-outs
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
        tools: &["read_file", "write_file", "edit_file", "list_dir"],
    },
    Family {
        id: "gg-shell",
        title: "Shell",
        description: "Running shell commands in the workspace.",
        tools: &["shell"],
    },
    Family {
        id: "gg-project",
        title: "Project management",
        description: "The epic/issue board — decomposing work into issues other agents implement.",
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
        tools: &["read_skill"],
    },
    Family {
        id: "gg-context",
        title: "Context",
        description: "Managing your own context window: evicting, archiving, searching, compacting.",
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
        tools: &[
            "spawn_subagent",
            "wait_for_subagents",
            "send_message",
            "transition_state",
            "exec",
            "fork",
        ],
    },
    Family {
        id: "gg-docs",
        title: "Documentation",
        description: "Finding a function by keyword, and reclaiming the documentation you have read.",
        tools: &[],
    },
    Family {
        id: "gg-views",
        title: "Views",
        description: "Showing yourself a file, a value, or a function's documentation.",
        tools: &[],
    },
    Family {
        id: "gg-programs",
        title: "Program library",
        description: "Fetching a program you already ran, and handing a patched copy back.",
        tools: &[],
    },
    Family {
        id: "gg-session",
        title: "Ending the session",
        description: "Ending your session — the one call that does.",
        tools: &[],
    },
];

/// The built-in skills this agent is offered.
///
/// `offered` is the agent's own tool vocabulary (the registry's names, which is what
/// [`scope_tools`](crate::sandbox::scope_tools) hands the sandbox); `definitions` is the same
/// registry's live [`ToolDefinition`]s, which the native arm renders its bodies from;
/// `program_language` picks which of the two arms a family's skill is built in — `Some(l)` is the
/// code arm, written in `l`'s spellings, and `None` is the native one; `params` is the skills
/// capability's params, read for the [`builtIns`](PARAM_BUILT_INS) toggles.
///
/// The language and "is this the code arm?" are one parameter rather than two, because they are one
/// fact: a family's skill is built from a [directory](crate::docs::DocsRuntime) exactly when the
/// agent writes programs, and the language is only there to say how the entries in it are spelled.
///
/// A family with nothing bound is not offered at all. In code mode the four carve-out families
/// (`docs`, `view`, `programs`, `harness`) are decided by [`DocsRuntime`](crate::docs::DocsRuntime)
/// rather than by a tool name, so they are asked for their directory; under native tool calling they
/// do not exist, and are absent.
pub fn builtin_skills(
    offered: &[String],
    definitions: &[ToolDefinition],
    role: EndingRole,
    library: bool,
    docview_close: bool,
    program_language: Option<GgProgramLanguage>,
    params: &Value,
) -> Vec<Skill> {
    let off = switched_off(params);
    let offered: BTreeSet<&str> = offered.iter().map(String::as_str).collect();
    // The capabilities that buy part of the model-facing surface, as the documentation runtime takes
    // them: ids rather than the booleans this function is handed, because gg's gating vocabulary is
    // capability ids and the booleans are this caller's resolved answers about them. Turned into ids
    // by the one function that does that, so this catalogue and the membrane cannot come to hold
    // different grants — which they did, this side never carrying `docview-close` at all.
    let capabilities = crate::sandbox::surface_capabilities(library, docview_close);
    let docs = program_language.map(|language| {
        crate::docs::DocsRuntime::new(
            offered.iter().map(|name| (*name).to_string()).collect(),
            role,
            &capabilities,
            language,
        )
    });

    FAMILIES
        .iter()
        .filter(|family| !off.contains(family.id))
        .filter_map(|family| {
            if let Some(docs) = &docs {
                built_in_code(family, docs)
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
/// The script is generated rather than authored because the set of functions is: it is exactly the
/// family this agent binds, so a skill that hard-coded a list would be a second answer to a question
/// the catalogue already answers. What the model gets is the same material
/// `view.openDocsView` gives it — the signature, the description, and every type they refer to — for
/// the whole family at once, on the turn after it read the skill.
fn built_in_code(family: &Family, docs: &crate::docs::DocsRuntime) -> Option<Skill> {
    // Asked by FAMILY rather than by object, because an object is the arm's own grouping and a
    // family is gg's: an arm whose surface is capability modules files these same functions under
    // `gg::files` rather than under `fs`, and a lookup by object name would answer nothing there and
    // silently generate no skill. Nothing has to be filtered out of the answer: every entry a family
    // holds is an operation this agent binds, so every one of them is worth a view.
    let functions: Vec<String> = docs
        .family(family.id)
        .into_iter()
        .map(|function| function.name)
        .collect();
    if functions.is_empty() {
        return None;
    }
    // The program itself is the language's to write — its list syntax, its loop, its statement
    // terminator, and the spelling of the call. gg supplies the names and nothing else.
    let names: Vec<&str> = functions.iter().map(String::as_str).collect();
    // Generated for **this** agent's language, so it is keyed under the extension that language
    // writes — the same key a skill directory would have spelled it with.
    let language = docs.language();
    let script = language.open_docs_views_statement(&names);
    Some(skill(
        family,
        String::new(),
        Some((language.module_file_extension(), script)),
    ))
}

/// A [`Skill`] for `family` with the given body and on-use script.
///
/// It goes through [`parse_skill`] rather than constructing a `Skill` directly so a built-in is
/// assembled by exactly the code an authored skill is, front matter included — there is one parser,
/// and no second way for a skill to come into being. Nothing on the result marks it as gg's, and
/// nothing needs to: being built in is a fact about *how a catalogue was assembled*
/// ([`with_builtins`](super::SkillLibrary::with_builtins)), not a property of the skill, and an
/// authored skill of the same name simply keeps the name.
fn skill(family: &Family, body: String, on_use: Option<(&'static str, String)>) -> Skill {
    let raw = format!(
        "---\nname: {}\ndescription: {}\n---\n{body}",
        family.id, family.description
    );
    parse_skill(&raw, family.id).with_code(
        CodeFiles::new(),
        on_use
            .map(|(extension, source)| CodeFiles::from([(extension.to_string(), source)]))
            .unwrap_or_default(),
    )
}

#[cfg(test)]
#[path = "skills.builtin.test.rs"]
mod tests;
