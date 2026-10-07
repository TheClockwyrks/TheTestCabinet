//! Tests for the skills gg ships — one per family of its own functions.

use serde_json::json;

use super::*;
use crate::model::ToolDefinition;
use crate::sandbox::{FILES_READ_FILE, FILES_WRITE_FILE, capability_operations};
use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_READ_FILE, GgCapabilityConfig};

/// A profile whose skills capability is **on** and **fully specified**: the params the
/// [authoring catalog](test_cabinet_core::gg::gg_authoring_catalog) writes, with `params`' own keys
/// written over them.
///
/// The one shape a built-in catalogue is built for, and it is authored rather than completed — the
/// document an operator would have in front of them, not one gg filled a hole in. A test about
/// *which families are offered* says only the toggles it means and inherits the rest.
fn skills_on(params: serde_json::Value) -> GgAgentConfig {
    let mut capability = GgCapabilityConfig::enabled(CAPABILITY_SKILLS);
    for (key, value) in params.as_object().expect("params is an object") {
        capability = capability.with_param(key.as_str(), value.clone());
    }
    GgAgentConfig {
        capabilities: vec![capability],
        ..GgAgentConfig::root()
    }
}

/// A profile carrying the skills capability with the given switch and **exactly** these params —
/// how the tests about what an enabled capability *owes* say that it wrote none.
fn skills_capability(enabled: bool, params: serde_json::Value) -> GgAgentConfig {
    GgAgentConfig {
        capabilities: vec![GgCapabilityConfig {
            id: CAPABILITY_SKILLS.to_string(),
            enabled,
            implementation: None,
            params,
        }],
        ..GgAgentConfig::root()
    }
}

/// A `read_file` definition, as the registry would build one.
fn read_file() -> ToolDefinition {
    ToolDefinition::new(
        "read_file",
        "Read a file from the workspace.",
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "The path to read." },
                "limit": { "type": "integer", "description": "How many lines." }
            },
            "required": ["path"]
        }),
    )
}

/// The names of the skills produced for an agent offering `offered`, in native tool-calling mode.
///
/// The grant is empty because a native agent's built-ins are decided by the tools it is *offered*:
/// nothing here reads the code surface at all, which is what makes the two arms of this file
/// separate rather than parameterised.
fn native(offered: &[&str], params: serde_json::Value) -> Vec<Skill> {
    native_for(offered, &skills_on(params))
}

/// [`native`] against a profile the caller built — how the two arms where there is no catalogue at
/// all (no skills capability, and one switched off) are reached.
fn native_for(offered: &[&str], profile: &GgAgentConfig) -> Vec<Skill> {
    let names: Vec<String> = offered.iter().map(|name| (*name).to_string()).collect();
    builtin_skills(
        &names,
        &[read_file()],
        EndingRole::Standard,
        &[],
        &[],
        /* program_language */ None,
        profile,
    )
}

/// The skills produced for a code agent granted `capabilities` and every operation they offer, in
/// `role`, on `language`.
fn code(
    capabilities: &[&str],
    role: EndingRole,
    language: GgProgramLanguage,
    params: serde_json::Value,
) -> Vec<Skill> {
    let operations = capability_operations(capabilities.iter().copied());
    builtin_skills(
        &[],
        &[],
        role,
        &capabilities
            .iter()
            .map(|id| (*id).to_string())
            .collect::<Vec<_>>(),
        &operations,
        Some(language),
        &skills_on(params),
    )
}

#[test]
fn a_family_with_nothing_bound_is_not_offered() {
    let skills = native(&["read_file"], json!({}));
    let names: Vec<&str> = skills.iter().map(Skill::name).collect();
    // The one family this agent has anything from, and no others: a skill that described a tool the
    // agent lacks is the one thing a catalogue must never do.
    assert_eq!(names, vec!["gg-filesystem"]);
}

#[test]
fn an_agent_with_nothing_at_all_gets_no_built_ins() {
    assert!(native(&[], json!({})).is_empty());
}

#[test]
fn the_native_body_is_built_from_the_live_tool_definitions() {
    let skills = native(&["read_file"], json!({}));
    let body = skills[0].body();
    assert!(body.contains("`read_file`"), "{body}");
    assert!(body.contains("Read a file from the workspace."), "{body}");
    // The parameters come from the schema the model is really held to, required-ness included.
    assert!(
        body.contains("`path` (string) — The path to read."),
        "{body}"
    );
    assert!(body.contains("`limit` (integer, optional)"), "{body}");
    // Native mode has no programs to bind code into, so a built-in carries none — in any
    // language, which is what `has_code` asks.
    assert!(!skills[0].has_code());
}

#[test]
fn a_native_skill_only_lists_the_tools_the_agent_really_has() {
    // `write_file` is in the filesystem family but is not offered here, so it must not appear.
    let body = native(&["read_file"], json!({}))[0].body().to_string();
    assert!(!body.contains("write_file"), "{body}");
}

#[test]
fn the_code_arm_carries_an_on_use_script_and_no_body() {
    let skills = code(
        &[CAPABILITY_READ_FILE],
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
        json!({}),
    );
    let fs = skills
        .iter()
        .find(|skill| skill.name() == "gg-filesystem")
        .expect("the filesystem family is offered");
    assert_eq!(fs.body(), "");
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    assert_eq!(
        fs.code(language),
        None,
        "a built-in exposes no importable code"
    );
    let script = fs.on_use(language).expect("the code arm carries a script");
    assert!(script.contains("views.openDocsView(name)"), "{script}");
    assert!(script.contains("\"readFile\""), "{script}");
}

/// **A built-in family skill is generated for every registered arm.**
///
/// The script is generated from the family's own functions, and a family that came back empty makes
/// `built_in_code` decline to generate a skill at all — silently, because declining is also the
/// right answer for a family this agent was not granted. That is exactly what happens if the
/// functions are asked for by the **arm's own grouping**: an arm files the filesystem family under
/// `gg::files` and another under `fs`, so a word matched against one matches nothing on the other
/// and that arm quietly loses all eleven of its built-in skills. They are asked for by family, which
/// is gg's identity for the grouping, and this is the gate that says so for every arm at once rather
/// than for whichever one the tests above picked.
#[test]
fn every_arm_generates_the_built_in_family_skills() {
    for language in crate::sandbox::all_languages() {
        let skills = code(
            &[CAPABILITY_READ_FILE, CAPABILITY_PROGRAM_LIBRARY],
            EndingRole::Standard,
            language.id(),
            json!({}),
        );
        let offered = |name: &str| skills.iter().find(|skill| skill.name() == name);
        let files = offered("gg-filesystem").unwrap_or_else(|| {
            panic!(
                "{} offers no filesystem skill for an agent holding `read_file`",
                language.display_name()
            )
        });
        let script = files.on_use(language).unwrap_or_else(|| {
            panic!(
                "{}'s filesystem skill carries no script",
                language.display_name()
            )
        });
        // The read is in it under this arm's own spelling, and the write — which this run withheld —
        // is not, whatever that arm calls it. The script names each function by the name it is
        // called by rather than by a qualified path, so the qualifier comes off the spelling gg
        // resolved.
        let named = |id: crate::sandbox::OperationId| {
            let spelled = crate::sandbox::spell(language, id);
            spelled
                .rsplit(language.member_separator())
                .next()
                .unwrap_or(&spelled)
                .to_string()
        };
        let read = named(FILES_READ_FILE);
        assert!(
            script.contains(&read),
            "{}'s filesystem skill does not open `{read}`:\n{script}",
            language.display_name()
        );
        let write = named(FILES_WRITE_FILE);
        assert!(
            !script.contains(&write),
            "{}'s filesystem skill opens `{write}`, which this run withheld:\n{script}",
            language.display_name()
        );
        // And the three carve-out families, which every program has whatever a run enables.
        for family in ["gg-views", "gg-session", "gg-programs"] {
            assert!(
                offered(family).is_some(),
                "{} offers no `{family}` skill",
                language.display_name()
            );
        }
    }
}

#[test]
fn the_code_arm_offers_the_carve_out_families_a_native_run_has_no_tools_for() {
    let skills = code(
        &[CAPABILITY_PROGRAM_LIBRARY],
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
        json!({}),
    );
    let names: Vec<&str> = skills.iter().map(Skill::name).collect();
    // `view` and `harness` are bound to every program whatever a run enables; `programs` follows the
    // library flag.
    assert!(names.contains(&"gg-views"), "{names:?}");
    assert!(names.contains(&"gg-session"), "{names:?}");
    assert!(names.contains(&"gg-programs"), "{names:?}");
}

#[test]
fn the_program_library_family_follows_the_library_flag() {
    let without = code(
        &[],
        EndingRole::Standard,
        GgProgramLanguage::TypeScript,
        json!({}),
    );
    assert!(!without.iter().any(|skill| skill.name() == "gg-programs"));
}

#[test]
fn a_reviewers_session_skill_documents_the_reviewers_ending() {
    let skills = code(
        &[],
        EndingRole::Review,
        GgProgramLanguage::TypeScript,
        json!({}),
    );
    let session = skills
        .iter()
        .find(|skill| skill.name() == "gg-session")
        .expect("every role has an ending");
    let script = session
        .on_use(crate::sandbox::language(GgProgramLanguage::TypeScript))
        .expect("a script");
    // A reviewer has no `finish`, so its skill must not open a view of one.
    assert!(script.contains("\"approve\""), "{script}");
    assert!(!script.contains("\"finish\""), "{script}");
}

#[test]
fn a_switched_off_family_is_withheld() {
    let skills = native(
        &["read_file"],
        json!({ "builtIns": { "gg-filesystem": false } }),
    );
    assert!(skills.is_empty());
}

#[test]
fn a_toggle_set_that_switches_nothing_off_offers_everything() {
    let skills = native(
        &["read_file"],
        json!({ "builtIns": { "gg-filesystem": true } }),
    );
    assert_eq!(skills.len(), 1);
}

/// A `builtIns` gg cannot read as a set of toggles **refuses the launch**: it withholds nothing
/// while reading as an instruction that something was withheld, so a run offered every family would
/// be the skills experiment measured on the arm the configuration was written to exclude.
#[test]
fn a_builtins_param_gg_cannot_read_is_refused() {
    for params in [
        // Not a set of toggles at all.
        json!({ "builtIns": "gg-filesystem" }),
        json!({ "builtIns": ["gg-filesystem"] }),
        // A family gg does not ship — the case that used to switch off nothing, silently.
        json!({ "builtIns": { "gg-fileystem": false } }),
        // A value that is not a toggle.
        json!({ "builtIns": { "gg-filesystem": 0 } }),
    ] {
        let mut report = crate::validate::LaunchReport::collecting();
        let off = switched_off(&params, &mut report);
        assert!(off.is_empty(), "{params}: the resolver stays total");
        let defects = report.into_defects();
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert!(
            defects[0].locus.starts_with("skills.params.builtIns"),
            "{params} -> {defects:?}"
        );
    }
}

/// An **absent** or `null` `builtIns` on an enabled capability **refuses the launch**. There is no
/// figure for gg to put there: which of its own manuals an agent is given is the whole of what the
/// param varies, and a run offered every family under a document that named none is a run whose
/// record describes a configuration nobody wrote. `{}` is how every family is asked for.
#[test]
fn an_absent_builtins_param_refuses_the_launch() {
    for params in [json!({}), json!({ "builtIns": null })] {
        let mut report = crate::validate::LaunchReport::collecting();
        let off = switched_off(&params, &mut report);
        assert!(off.is_empty(), "{params}: the resolver stays total");
        let defects = report.into_defects();
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].locus, "skills.params.builtIns", "{defects:?}");
    }
}

/// …and an empty object is not that: it is the declaration that withholds nothing, and it launches.
#[test]
fn an_empty_toggle_set_is_a_declaration_rather_than_a_silence() {
    let mut report = crate::validate::LaunchReport::collecting();
    let off = switched_off(&json!({ "builtIns": {} }), &mut report);
    assert!(off.is_empty());
    assert!(report.is_empty());
}

/// A profile that does not declare the skills capability is offered **no catalogue**. It has no
/// `read_skill` to reach one with, so a manual generated for it would be prose nothing could open —
/// and the absent capability is the setting, not a hole to fill.
#[test]
fn a_profile_with_no_skills_capability_is_offered_no_built_ins() {
    let profile = GgAgentConfig {
        capabilities: Vec::new(),
        ..GgAgentConfig::root()
    };
    assert!(native_for(&["read_file"], &profile).is_empty());
}

/// A skills capability switched **off** is the same answer: it configures no catalogue, so there is
/// none of gg's own to join to it, whatever its params say.
#[test]
fn a_disabled_skills_capability_is_offered_no_built_ins() {
    let profile = skills_capability(false, json!({ "builtIns": {} }));
    assert!(native_for(&["read_file"], &profile).is_empty());
}

/// What the launch pass asks of each of the three shapes: an enabled capability owes its
/// `builtIns`, a disabled one owes nothing, and a disabled one that *wrote* something is still held
/// to it — which is what keeps the two arms of a built-ins comparison one document with one switch
/// moved.
#[test]
fn the_switch_decides_what_is_owed_and_not_what_is_read() {
    let cases: [(GgAgentConfig, usize); 4] = [
        (skills_capability(true, json!({})), 1),
        (skills_capability(true, json!({ "builtIns": {} })), 0),
        (skills_capability(false, json!({})), 0),
        (
            skills_capability(false, json!({ "builtIns": { "gg-fileystem": false } })),
            1,
        ),
    ];
    for (profile, expected) in cases {
        let mut report = crate::validate::LaunchReport::collecting();
        check_launch(&profile, &mut report);
        let defects = report.into_defects();
        assert_eq!(
            defects.len(),
            expected,
            "{:?} {} -> {defects:?}",
            profile.capabilities[0].enabled,
            profile.capabilities[0].params
        );
    }
}
