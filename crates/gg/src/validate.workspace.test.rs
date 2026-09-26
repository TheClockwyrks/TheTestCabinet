//! **The workspace gate** — the second refusal, over the seeded workspace rather than the
//! invocation document.
//!
//! Two capabilities are written in the document and *satisfied* by the workspace, and until this
//! gate existed both failed by quietly shrinking: a skills directory that did not load left the
//! agent with no skills, and a specification that could not be read left it with part of the brief
//! and a synthesized transcript rewritten to hide the hole. Neither is decidable from the document,
//! and both are decidable before the first turn — the container's workspace is fully seeded by the
//! time gg's process starts.
//!
//! The property the file is really about is the same one [`validate_launch`]'s tests are about: one
//! refusal, naming everything.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_AUTOLOAD_SPECS, CAPABILITY_SKILLS, GgCapabilityConfig, GgCapabilitySet,
    PARAM_SKILLS_DIR,
};

use super::*;

/// A workspace as the session hands it to this gate: gg's own
/// [skills library](test_cabinet_core::gg::GG_WORKSPACE_SKILLS_DIR) stood up and empty.
///
/// The session creates it before it reads the workspace, because everything under `.gg` is gg's
/// rather than the seeder's, and it is the directory a freshly authored skills capability names. A
/// case that is about something else has to start from the workspace a run really starts from, or
/// it is refused for a directory that is always there.
fn seeded() -> TempDir {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(
        dir.path()
            .join(test_cabinet_core::gg::GG_WORKSPACE_SKILLS_DIR),
    )
    .unwrap();
    dir
}

/// An invocation over `dir` carrying `set` — the smallest thing the gate can be asked about.
fn invocation(dir: &Path, set: GgCapabilitySet) -> GgInvocation {
    let model_windows = set
        .bound_model_ids()
        .into_iter()
        .map(|id| (id.to_string(), 200_000))
        .collect::<BTreeMap<_, _>>();
    let model_providers = set
        .bound_model_ids()
        .into_iter()
        .map(|id| {
            let provider = id.split(['/', ':']).next().unwrap_or(id);
            (
                id.to_string(),
                vec![test_cabinet_core::gg::GgProviderCandidate::new(
                    provider, "fp8",
                )],
            )
        })
        .collect::<BTreeMap<_, _>>();
    GgInvocation {
        session_id: "run-workspace-gate".to_string(),
        workspace_dir: dir.to_path_buf(),
        prompt: "Build a tiny game.".to_string(),
        capability_set: set,
        model_windows,
        model_providers,
        model_modalities: BTreeMap::new(),
        provided_files: Vec::new(),
        cancel_file: None,
    }
}

/// Every defect the workspace earns, as the lines an operator reads.
fn defects(invocation: &GgInvocation) -> Vec<String> {
    validate_workspace(invocation)
        .err()
        .unwrap_or_default()
        .iter()
        .map(ToString::to_string)
        .collect()
}

/// A set whose one agent enables `capability`, configured with `params`.
fn set_with(capability: &str, params: serde_json::Value) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    let agent = &mut set.agents[0];
    agent.capabilities.retain(|held| held.id != capability);
    agent.capabilities.push(GgCapabilityConfig {
        id: capability.to_string(),
        enabled: true,
        implementation: None,
        params,
    });
    set
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/// **A workspace that authored no skills launches.** The `dir` a fresh capability set is authored
/// with is [gg's own](test_cabinet_core::gg::GG_WORKSPACE_SKILLS_DIR), stood up by the session and
/// left empty, so an empty library is the ordinary case and not a value gg failed to honour. This is
/// the test that keeps the gate from refusing every run there is.
#[test]
fn the_authored_skills_directory_is_the_one_gg_stands_up() {
    let dir = TempDir::new().unwrap();
    let set = GgCapabilitySet::minimal("mock/echo");
    assert!(set.is_enabled(CAPABILITY_SKILLS));
    assert_eq!(
        set.root()
            .capability(CAPABILITY_SKILLS)
            .and_then(|capability| capability.params.get(PARAM_SKILLS_DIR))
            .and_then(serde_json::Value::as_str),
        Some(test_cabinet_core::gg::GG_WORKSPACE_SKILLS_DIR),
        "an authored skills capability names gg's own directory"
    );
    std::fs::create_dir_all(
        dir.path()
            .join(test_cabinet_core::gg::GG_WORKSPACE_SKILLS_DIR),
    )
    .expect("the session stands this directory up before the gate reads it");
    let invocation = invocation(dir.path(), set);
    assert!(defects(&invocation).is_empty());
}

/// **A `dir` the capability *named* and gg cannot open refuses the launch.** A path an operator
/// wrote is a promise about the workspace; loading the default instead would hand every agent a set
/// of skills nobody configured, which is the substitution this whole remediation deletes.
#[test]
fn a_configured_skills_directory_that_is_not_there_is_refused() {
    let dir = TempDir::new().unwrap();
    let invocation = invocation(
        dir.path(),
        set_with(CAPABILITY_SKILLS, json!({ PARAM_SKILLS_DIR: "guides" })),
    );
    let defects = defects(&invocation);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].contains("skills.params.dir"), "{defects:?}");
    assert!(defects[0].contains("guides"), "{defects:?}");
}

/// Every entry the directory holds that will not load is named, in one refusal — the gate hands the
/// library loader's defects straight through.
#[test]
fn every_entry_that_will_not_load_is_named_in_one_refusal() {
    let dir = TempDir::new().unwrap();
    let skills = dir.path().join(".gg").join("skills");
    std::fs::create_dir_all(&skills).unwrap();
    std::fs::write(
        skills.join("a-good.md"),
        "---\nname: a\ndescription: d.\n---\nb",
    )
    .unwrap();
    std::fs::write(skills.join("b-bare.md"), "no front matter").unwrap();
    std::fs::write(skills.join("c-notes.txt"), "not a skill").unwrap();

    let invocation = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));
    let defects = defects(&invocation);
    assert_eq!(defects.len(), 2, "{defects:?}");
    assert!(defects[0].contains("b-bare.md"), "{defects:?}");
    assert!(defects[1].contains("c-notes.txt"), "{defects:?}");
}

// ---------------------------------------------------------------------------
// Autoloaded specifications
// ---------------------------------------------------------------------------

/// **A provided file gg cannot read refuses the launch, naming it.**
///
/// The capability's promise is the *whole* brief. A skipped file used to be a warning, and the
/// synthesized opening program was then written from the files that did arrive — so the transcript
/// showed a complete opening move over an incomplete specification, and the run measured something
/// other than the arm it was configured as.
#[test]
fn a_provided_file_that_cannot_be_read_is_refused() {
    let dir = seeded();
    std::fs::write(dir.path().join("SPEC.md"), "# The spec").unwrap();

    let mut invocation = invocation(dir.path(), set_with(CAPABILITY_AUTOLOAD_SPECS, json!({})));
    invocation.provided_files = vec![
        PathBuf::from("SPEC.md"),
        PathBuf::from("reference/title.png"),
    ];

    let defects = defects(&invocation);
    assert_eq!(defects.len(), 1, "{defects:?}");
    assert!(defects[0].contains("reference/title.png"), "{defects:?}");
    assert!(
        defects[0].contains(CAPABILITY_AUTOLOAD_SPECS),
        "{defects:?}"
    );
}

/// The same missing file is **not** a defect when no agent autoloads: a run whose agents read what
/// they need for themselves was never promised these files, and a spec nobody opens is not gg's
/// business.
#[test]
fn provided_files_are_only_checked_when_some_agent_autoloads_them() {
    let dir = seeded();
    let mut invocation = invocation(dir.path(), GgCapabilitySet::minimal("mock/echo"));
    invocation.provided_files = vec![PathBuf::from("SPEC.md")];
    assert!(
        !invocation
            .capability_set
            .is_enabled(CAPABILITY_AUTOLOAD_SPECS)
    );
    assert!(defects(&invocation).is_empty());
}

/// Both halves of the gate report into one list, so an operator fixing a workspace sees everything
/// wrong with it in one pass — the same property the document's refusal has.
#[test]
fn a_workspace_wrong_in_both_ways_is_refused_once() {
    let dir = TempDir::new().unwrap();
    let skills = dir.path().join(".gg").join("skills");
    std::fs::create_dir_all(&skills).unwrap();
    std::fs::write(skills.join("bare.md"), "no front matter").unwrap();

    let mut invocation = invocation(dir.path(), set_with(CAPABILITY_AUTOLOAD_SPECS, json!({})));
    invocation.provided_files = vec![PathBuf::from("SPEC.md")];

    let defects = defects(&invocation);
    assert_eq!(defects.len(), 2, "{defects:?}");
    assert!(defects[0].contains("bare.md"), "{defects:?}");
    assert!(defects[1].contains("SPEC.md"), "{defects:?}");
}
