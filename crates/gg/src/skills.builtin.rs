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
//! described a call this agent was not given would be the one thing a directory must never do, and
//! it is the same rule the [docs runtime](crate::docs::DocsRuntime) already obeys — which is why the
//! responses-as-code arm can simply hand it the agent's own
//! [grant](crate::sandbox::Grants) and let it answer.
//!
//! # Selecting them
//!
//! Each is a checkbox on the skills capability: the [`builtIns`](PARAM_BUILT_INS) param records the
//! ones an operator switched **off**, so `{}` offers all of them and a run that wants to measure an
//! agent without a manual withholds exactly the families it means to. Every enabled skills
//! capability writes the param, which is what makes `{}` a declaration that the whole catalogue was
//! meant rather than a silence gg read as one.

use std::collections::BTreeSet;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_SKILLS, GgAgentConfig, GgProgramLanguage};

use super::{CodeFiles, Skill, parse_skill};
use crate::ending::EndingRole;
use crate::model::ToolDefinition;
use crate::sandbox::OperationId;

/// The `params` key on the [skills](CAPABILITY_SKILLS) capability naming which built-in skills the
/// agent is offered — read here, declared with the capability it belongs to.
///
/// An object of `{ "<id>": false }` recording only the ones switched **off**, so `{}` is the
/// declaration that offers every family. Required of an enabled capability: an absent `builtIns`
/// would be gg deciding which of its own manuals an agent gets, and the arm of a skills study that
/// withheld none is a thing an operator writes rather than a thing gg assumes.
pub use test_cabinet_core::gg::PARAM_BUILT_INS;

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
/// The two arms take their vocabulary from the surface the agent actually has, and each takes only
/// its own. `offered` and `definitions` are the tool arm's: the names of the tools the agent's
/// [registry](crate::tools::ToolRegistry) offers, and the live [`ToolDefinition`]s the native bodies
/// are rendered from. `capabilities` and `operations` are the program arm's: what its agent was
/// [granted](crate::sandbox::Grants), handed down from the loop so that this catalogue, the
/// membrane and the model's own lookups are built from one reading of one profile. `role` is the
/// [ending role](EndingRole) the agent was dispatched in, which decides which verdict calls its
/// session family carries.
///
/// `profile` is the agent's own configuration rather than the skills capability's `params`, because
/// the built-ins **are** the [skills](CAPABILITY_SKILLS) capability and nothing else: a profile that
/// does not declare it, or declares it switched **off**, is offered no catalogue at all and this
/// answers with none. A params object on its own cannot say that — an absent capability and one
/// that withholds nothing hand down the same empty block — and a manual generated for an agent with
/// no `read_skill` is prose nothing in the run could open.
///
/// `program_language` picks which of the two arms a family's skill is built in — `Some(l)` is the
/// code arm, written in `l`'s spellings, and `None` is the native one. The language and "is this the
/// code arm?" are one parameter rather than two, because they are one fact: a family's skill is
/// built from a [directory](crate::docs::DocsRuntime) exactly when the agent writes programs, and
/// the language is only there to say how the entries in it are spelled. The unused arm's parameters
/// are simply not read — an agent has one surface, so one of the two pairs describes something it
/// does not have.
///
/// A family with nothing bound is not offered at all. In code mode the four carve-out families
/// (`docs`, `view`, `programs`, `harness`) are decided by [`DocsRuntime`](crate::docs::DocsRuntime)
/// rather than by a tool name, so they are asked for their directory; under native tool calling they
/// do not exist, and are absent.
pub fn builtin_skills(
    offered: &[String],
    definitions: &[ToolDefinition],
    role: EndingRole,
    capabilities: &[String],
    operations: &[OperationId],
    program_language: Option<GgProgramLanguage>,
    profile: &GgAgentConfig,
) -> Vec<Skill> {
    // No skills capability on this profile, or one switched off: the agent holds no catalogue, so
    // there is none of gg's own to join to it.
    let Some(capability) = profile
        .capability(CAPABILITY_SKILLS)
        .filter(|capability| capability.enabled)
    else {
        return Vec::new();
    };
    // A discarding sink: `check_launch` read this same param, through this same resolver, before
    // the run started — and refused the launch if it was absent or held a toggle gg could not
    // honour.
    let off = switched_off(
        &capability.params,
        &mut crate::validate::LaunchReport::Discarding,
    );
    let offered: BTreeSet<&str> = offered.iter().map(String::as_str).collect();
    let docs = program_language.map(|language| {
        crate::docs::DocsRuntime::new(capabilities.to_vec(), role, operations, language)
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

/// The set gg answers with when the [`builtIns`](PARAM_BUILT_INS) param cannot be read — because an
/// enabled capability wrote none, or because what it wrote is not a set of families.
///
/// **Empty**, and empty because there is nothing left to withhold from: the launch is already
/// refused by the time it comes back, and no agent will be offered the catalogue it would have
/// narrowed. It is written here rather than reached through `Default` so the next reader of the two
/// call sites can see which of the two empties they are looking at — this one, or the `{}` an
/// operator wrote to offer every family.
fn withholding_of_a_refused_launch() -> BTreeSet<String> {
    BTreeSet::new()
}

/// The ids an operator switched **off** in the [`builtIns`](PARAM_BUILT_INS) param of an **enabled**
/// skills capability.
///
/// Required, and read here at the constant it is named by: a capability that is on and writes no
/// `builtIns` [refuses the launch](crate::validate), because the alternative is gg choosing which of
/// its own manuals the agent gets and a record that says the operator did. `{}` is how every family
/// is asked for.
///
/// Only for a capability the caller has established is **on** — requirement is a property of the
/// switch, and a disabled capability's written toggles are read by
/// [`withheld_families`] directly. An `id` that names no family gg ships, a value
/// that is not a toggle, and a `builtIns` that is not an object all refuse the launch on either
/// path: each of them switches **nothing** off while reading as an instruction that something was,
/// and a run offered a skill its configuration says it withheld is the wrong-arm failure in its
/// purest form — the skills experiment measured on the arm it was written to exclude.
fn switched_off(params: &Value, report: &mut crate::validate::LaunchReport) -> BTreeSet<String> {
    let Some(value) =
        crate::validate::required_param(params, CAPABILITY_SKILLS, PARAM_BUILT_INS, report)
    else {
        return withholding_of_a_refused_launch();
    };
    withheld_families(value, report)
}

/// One written [`builtIns`](PARAM_BUILT_INS) value read as a set of withheld families — the half of
/// [`switched_off`] that judges what is there, shared with the **disabled** capability whose toggles
/// are still read and still refused if gg cannot honour them.
fn withheld_families(
    value: &Value,
    report: &mut crate::validate::LaunchReport,
) -> BTreeSet<String> {
    let locus = || crate::validate::param_locus(CAPABILITY_SKILLS, PARAM_BUILT_INS);
    let Some(toggles) = value.as_object() else {
        report.report(
            crate::validate::LaunchDefect::run_level(
                locus(),
                crate::validate::as_written(value),
                format!(
                    "the `{PARAM_BUILT_INS}` param withholds built-in skills by name, as an object \
                     of `{{ \"<id>\": false }}`; there is nothing here gg can read a set of \
                     families from."
                ),
            )
            .known(FAMILIES.iter().map(|family| family.id)),
        );
        return withholding_of_a_refused_launch();
    };
    let mut off = BTreeSet::new();
    for (id, on) in toggles {
        let known = FAMILIES.iter().any(|family| family.id == id.trim());
        match (known, on.as_bool()) {
            (true, Some(false)) => {
                off.insert(id.trim().to_string());
            }
            (true, Some(true)) => {}
            (true, None) => report.report(crate::validate::LaunchDefect::run_level(
                format!("{}.{id}", locus()),
                crate::validate::as_written(on),
                format!(
                    "a built-in skill is withheld with `false` and offered with `true`; gg cannot \
                     read this as either, and offering `{id}` anyway would hand the agent a skill \
                     this line was written to take away."
                ),
            )),
            (false, _) => report.report(
                crate::validate::LaunchDefect::run_level(
                    format!("{}.{id}", locus()),
                    crate::validate::as_written(on),
                    format!(
                        "`{id}` names no built-in skill family, so it withholds nothing; the agent \
                         would be offered every family while the configuration says one was held \
                         back."
                    ),
                )
                .known(FAMILIES.iter().map(|family| family.id)),
            ),
        }
    }
    off
}

/// The skills capability's built-ins half of the [launch pass](crate::validate::validate_launch):
/// the [`builtIns`](PARAM_BUILT_INS) toggles `profile` declares, read exactly as the run will read
/// them.
///
/// An **enabled** capability is read the way the run reads it, so a `builtIns` it does not write is
/// refused here. A **disabled** one is owed nothing — it configures no catalogue — but whatever it
/// *does* write is still judged, which is what keeps the two arms of a built-ins comparison one
/// document with one switch moved.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    let Some(capability) = profile.capability(CAPABILITY_SKILLS) else {
        return;
    };
    if capability.enabled {
        switched_off(&capability.params, report);
    } else if let Some(written) = capability
        .params
        .get(PARAM_BUILT_INS)
        .filter(|value| !value.is_null())
    {
        withheld_families(written, report);
    }
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
    // `expect` rather than a report: the front matter above is *generated* two lines up from two
    // constants of gg's own, so a failure here is an unreachable defect in this function rather
    // than anything an operator wrote — the same footing the embedded prompt templates are on.
    parse_skill(&raw)
        .expect("a built-in skill's generated front matter parses")
        .with_code(
            CodeFiles::new(),
            on_use
                .map(|(extension, source)| CodeFiles::from([(extension.to_string(), source)]))
                .unwrap_or_default(),
        )
}

#[cfg(test)]
#[path = "skills.builtin.test.rs"]
mod tests;
