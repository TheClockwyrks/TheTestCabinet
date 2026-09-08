//! Unit tests for the dependency install validation reports.
//!
//! The case's `[build]` install is run once per tree. A
//! [post-run stage](crate::post_run) that already ran it hands validation the step it
//! recorded, whatever it came to; anything else makes validation run the command
//! itself. These tests pin both paths and the shape of what is reported on each.

use super::BuildValidator;
use crate::execution::{ArtifactCollection, PreparedInstall};
use crate::post_run::PostRunReport;
use crate::test_case::{
    AssetDimension, AssetKind, BuildCommands, TestCaseVersion, TestType, Variant,
};
use crate::toolchain::{ToolchainCommandResult, ToolchainSummary};
use crate::validation::{StepResult, Validator};

/// The install command every case in this file declares. It appends a line to
/// `installs.log`, which is how a test counts the times the command actually ran.
const INSTALL: &str = "echo ran >> installs.log";

/// A bare variant: this validator reads nothing from it.
fn variant() -> Variant {
    Variant {
        slug: "base".to_string(),
        name: "Base".to_string(),
        description: None,
        specs: vec![],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
        domains: vec![],
        voxel: None,
        reference_impls: Default::default(),
        showcase: None,
    }
}

/// A minimal end-to-end version whose install is observable and whose build fails.
///
/// The failing build stops validation immediately after the two required steps, which
/// is everything these tests read: no server is started and no browser is driven.
fn version() -> TestCaseVersion {
    TestCaseVersion {
        toolchain: None,
        instrumentation: None,
        slug: "carom".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        engine_format: false,
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root: std::path::PathBuf::new(),
        prompt_path: std::path::PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 1800,
        test_type: TestType::EndToEnd,
        build: Some(BuildCommands {
            install: INSTALL.to_string(),
            build: "exit 1".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: AssetKind::Sprite,
        asset_dimension: AssetDimension::TwoD,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        audio_packs: Vec::new(),
        common_specs: Vec::new(),
        common_workspace: Default::default(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        engines: vec![crate::EngineSupport::unbounded(crate::engine::NONE_SLUG)],
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
        errata: Vec::new(),
    }
}

/// A produced tree with the `package.json` the validator requires.
fn produced_tree(dir: &std::path::Path) -> std::path::PathBuf {
    let repo = dir.join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    std::fs::write(repo.join("package.json"), "{}").expect("package.json");
    repo
}

/// How many times the install command ran in `repo`.
fn installs(repo: &std::path::Path) -> usize {
    std::fs::read_to_string(repo.join("installs.log"))
        .map(|log| log.lines().count())
        .unwrap_or(0)
}

/// Validate `artifacts` and return the install step the summary reported.
fn reported_install(artifacts: &ArtifactCollection) -> StepResult {
    let dir = tempfile::tempdir().expect("screenshots");
    BuildValidator::new(dir.path())
        .validate(&version(), &variant(), artifacts, &[], &[])
        .expect("validate")
        .install
        .expect("the install step is always reported")
}

/// A toolchain summary whose install is `result` and which checked nothing else.
fn toolchain_summary(install: ToolchainCommandResult) -> ToolchainSummary {
    ToolchainSummary {
        install,
        typecheck: ToolchainCommandResult::skipped("npx tsc --noEmit", "not run"),
        lint: None,
        format: None,
        test: None,
        smoke: None,
    }
}

#[test]
fn validation_installs_when_nothing_prepared_the_tree() {
    // The standalone path: `tcab validate` builds a collection over an
    // implementation directory, and nothing has touched it.
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = produced_tree(dir.path());
    let artifacts = ArtifactCollection::new(repo.clone());
    assert!(artifacts.prepared_install.is_none());

    let install = reported_install(&artifacts);

    assert_eq!(installs(&repo), 1, "the command ran exactly once");
    assert_eq!(install.command, INSTALL);
    assert!(install.succeeded);
    assert_eq!(install.detail, None);
}

#[test]
fn validation_reuses_an_install_a_stage_already_completed() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = produced_tree(dir.path());
    // What the toolchain stage records for an install that ran and exited zero,
    // carried through the report exactly as the engine carries it.
    let report = PostRunReport::toolchain(toolchain_summary(ToolchainCommandResult::ran(
        INSTALL,
        Some(0),
        "added 1 package",
    )));
    let prepared = report
        .prepared_install
        .clone()
        .expect("a successful install prepares the tree");
    let artifacts = ArtifactCollection::new(repo.clone()).prepared_by(Some(prepared.clone()));

    let install = reported_install(&artifacts);

    assert_eq!(installs(&repo), 0, "the command was not run a second time");
    assert_eq!(
        install, prepared.step,
        "the step the stage recorded is what the summary reports",
    );
}

#[test]
fn validation_reports_a_prepared_install_that_failed_without_running_it() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = produced_tree(dir.path());
    // The stage's install exited non-zero on its last attempt. The verified install
    // has no attempts left, so validation reports that outcome as its own install
    // step and never builds the tree, rather than running the attempts over again.
    let mut recorded = ToolchainCommandResult::ran(
        INSTALL,
        Some(1),
        "npm ERR! code E503\nnpm ERR! 503 Service Unavailable",
    );
    recorded.attempts = Some(3);
    let report = PostRunReport::toolchain(toolchain_summary(recorded));
    let prepared = report
        .prepared_install
        .clone()
        .expect("an install that ran is recorded, whatever it came to");
    assert!(!prepared.step.succeeded);
    let artifacts = ArtifactCollection::new(repo.clone()).prepared_by(report.prepared_install);

    let summary = BuildValidator::new(dir.path())
        .validate(&version(), &variant(), &artifacts, &[], &[])
        .expect("validate");

    assert_eq!(installs(&repo), 0, "the command was not run a second time");
    let install = summary
        .install
        .expect("the install step is always reported");
    assert_eq!(install, prepared.step);
    assert_eq!(install.attempts, Some(3));
    assert!(!summary.loaded);
    assert_eq!(
        summary.build, None,
        "a tree whose install failed is never built"
    );
    assert!(
        summary
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("E503"),
        "the load failure is the install's own reason: {:?}",
        summary.detail
    );
}

#[test]
fn the_reported_install_step_has_the_same_shape_either_way() {
    let dir = tempfile::tempdir().expect("temp dir");
    let fresh = reported_install(&ArtifactCollection::new(produced_tree(
        &dir.path().join("fresh"),
    )));
    // What the stage records for a verified install that completed on its first
    // attempt.
    let mut recorded = ToolchainCommandResult::ran(INSTALL, Some(0), "added 1 package");
    recorded.attempts = Some(1);
    let reused = reported_install(
        &ArtifactCollection::new(produced_tree(&dir.path().join("reused")))
            .prepared_by(PostRunReport::toolchain(toolchain_summary(recorded)).prepared_install),
    );

    // A reader of the summary sees one install step, naming the command the manifest
    // declared, with the same outcome, no failure detail, its captured output and the
    // attempts it took, however it was obtained. Only the output's text differs: it
    // is what each command actually printed.
    for step in [&fresh, &reused] {
        assert_eq!(step.command, INSTALL);
        assert!(step.succeeded);
        assert_eq!(step.detail, None);
        assert_eq!(step.attempts, Some(1));
        assert!(step.output.is_some(), "a step that ran carries its output");
    }
    assert_eq!(reused.output.as_deref(), Some("added 1 package"));
}

#[test]
fn a_tree_prepared_by_another_command_is_not_reused() {
    // The tree answers for the command that was run over it and no other, so a case
    // whose install differs installs for itself.
    let prepared = PreparedInstall::recorded(&StepResult {
        command: "pnpm install --frozen-lockfile".to_string(),
        succeeded: true,
        detail: None,
        output: None,
        attempts: None,
    });
    let artifacts = ArtifactCollection::new("/tmp/tree").prepared_by(Some(prepared));

    assert!(artifacts.prepared_install_for(INSTALL).is_none());
    assert!(
        artifacts
            .prepared_install_for("  pnpm install --frozen-lockfile  ")
            .is_some(),
        "the same command is the same command however the manifest spaced it",
    );
}
