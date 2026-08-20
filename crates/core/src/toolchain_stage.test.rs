//! The toolchain stage: what it runs, what it refuses to run, and what it records.
//!
//! The commands here are shell built-ins (`true`, `exit 3`, `printf`) rather than a
//! real `tsc`, because what is under test is the stage's own behaviour — which
//! commands it starts, what it does with an exit code, and how it reports a step it
//! never reached. A test that needed a TypeScript toolchain on the host would prove
//! less and fail more.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::*;
use crate::execution::ArtifactCollection;
use crate::test_case::{BuildCommands, TestCaseVersion, TestType, Variant};
use crate::toolchain::ToolchainCommands;

/// A resolved version carrying `build` and (optionally) `toolchain`, and nothing
/// else the stage reads.
fn version(toolchain: Option<ToolchainCommands>, build: Option<BuildCommands>) -> TestCaseVersion {
    TestCaseVersion {
        instrumentation: None,
        slug: "carom".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: PathBuf::new(),
        root: PathBuf::from("/tmp/carom"),
        prompt_path: PathBuf::from("/tmp/carom/prompt.hbs"),
        max_runtime_seconds: 3600,
        test_type: TestType::EndToEnd,
        build,
        toolchain,
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: crate::test_case::AssetKind::Sprite,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        engines: Vec::new(),
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

/// The variant the fixture run was seeded from.
fn variant() -> Variant {
    Variant {
        slug: "base".to_string(),
        name: "Base".to_string(),
        description: None,
        specs: Vec::new(),
        workspace: None,
        references: Vec::new(),
        proofs: Vec::new(),
        review_items: Vec::new(),
        domains: Vec::new(),
        voxel: None,
        reference_impls: Default::default(),
    }
}

/// The request the fixture run was launched with. The stage never reads it.
fn request(version: &TestCaseVersion, variant: &Variant) -> crate::RunRequest {
    crate::RunRequest {
        test_case_slug: version.slug.clone(),
        test_case_version: Some(version.version.clone()),
        variant: variant.slug.clone(),
        harness: crate::HarnessSlug::Gg,
        model_id: "some-model".to_string(),
        orchestrator: crate::OrchestratorSelection::default(),
        engine: crate::EngineSelection::default(),
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: std::collections::BTreeMap::new(),
        gg_model_modalities: std::collections::BTreeMap::new(),
    }
}

/// The minimal produced tree the stage will act on: a directory with a
/// `package.json` in it.
fn produced_tree() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("produced tree");
    std::fs::write(dir.path().join("package.json"), "{}").expect("write package.json");
    dir
}

/// Run the stage over `repo` for a case declaring `toolchain` and `build`.
async fn drive(
    repo: &Path,
    toolchain: Option<ToolchainCommands>,
    build: Option<BuildCommands>,
    canceled: bool,
) -> crate::post_run::PostRunReport {
    let version = version(toolchain, build);
    let variant = variant();
    let request = request(&version, &variant);
    let artifacts = ArtifactCollection {
        repo_path: repo.to_path_buf(),
    };
    let run_dir = tempfile::tempdir().expect("run dir");
    let seed_commit = "0".repeat(40);
    let context = crate::post_run::PostRunContext {
        run_id: "run-1",
        run_dir: run_dir.path(),
        artifacts: &artifacts,
        seed_commit: &seed_commit,
        test_case: &version,
        variant: &variant,
        request: &request,
        canceled,
    };
    ToolchainStage
        .run(&context)
        .await
        .expect("the stage reports through the record, never by failing the run")
}

/// The `[build]` commands the fixture cases use: both no-ops that succeed.
fn noop_build() -> BuildCommands {
    BuildCommands {
        install: "true".to_string(),
        build: "true".to_string(),
        module: None,
    }
}

/// A command that exits zero is recorded as having run and succeeded, with its
/// output captured from both streams.
#[tokio::test]
async fn a_command_that_succeeds_is_recorded_with_its_output() {
    let repo = tempfile::tempdir().expect("repo");
    let (result, raw) = run_command_raw(
        repo.path(),
        "printf 'on stdout\\n'; printf 'on stderr\\n' >&2",
        Duration::from_secs(30),
    )
    .await;
    assert!(result.ran && result.succeeded);
    assert_eq!(result.exit_code, Some(0));
    assert!(raw.contains("on stdout") && raw.contains("on stderr"));
    assert!(!result.truncated);
}

/// A non-zero exit is recorded as a failure that *ran* — the distinction the gate
/// turns on.
#[tokio::test]
async fn a_command_that_fails_records_its_exit_code() {
    let repo = tempfile::tempdir().expect("repo");
    let (result, _) = run_command_raw(repo.path(), "exit 3", Duration::from_secs(30)).await;
    assert!(result.ran);
    assert!(!result.succeeded);
    assert_eq!(result.exit_code, Some(3));
}

/// A command that never terminates is recorded as *not run*, with the reason — not
/// as a failure it did not earn. A timed-out typecheck must not gate the run.
#[tokio::test]
async fn a_command_that_outruns_its_timeout_is_recorded_as_not_run() {
    let repo = tempfile::tempdir().expect("repo");
    let (result, _) = run_command_raw(repo.path(), "sleep 30", Duration::from_millis(200)).await;
    assert!(!result.ran);
    assert!(!result.succeeded);
    assert_eq!(result.exit_code, None);
    assert!(
        result
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("timed out"),
        "the reason must say what happened: {:?}",
        result.detail
    );
}

/// The output cap applies to what a command actually printed, not only to synthetic
/// strings: a command that floods stdout still lands a bounded excerpt.
#[tokio::test]
async fn a_flood_of_output_is_capped_on_the_record() {
    let repo = tempfile::tempdir().expect("repo");
    let (result, raw) = run_command_raw(
        repo.path(),
        "i=0; while [ $i -lt 4000 ]; do printf 'error TS2322: a very long diagnostic line\\n'; i=$((i+1)); done",
        Duration::from_secs(60),
    )
    .await;
    assert!(result.ran);
    assert!(
        raw.len() > crate::toolchain::TOOLCHAIN_OUTPUT_LIMIT,
        "the fixture must actually overflow the cap"
    );
    assert!(result.truncated);
    assert!(result.output.len() <= crate::toolchain::TOOLCHAIN_OUTPUT_LIMIT + 64);
}

/// A case that declares no `[toolchain]` table is not checked and carries no
/// summary. Every case version frozen before the table existed is in this arm, so
/// this is the property that keeps them running unchanged.
#[tokio::test]
async fn a_case_with_no_toolchain_records_nothing() {
    let repo = produced_tree();
    let report = drive(repo.path(), None, Some(noop_build()), false).await;
    assert!(report.toolchain.is_none());
}

/// A canceled run is not checked: these commands are fresh work over output an
/// operator chose to stop, and a gate derived from them would rate a deliberately
/// interrupted run broken.
#[tokio::test]
async fn a_canceled_run_is_not_checked() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "exit 2".to_string(),
        lint: None,
        format: None,
        test: None,
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), true).await;
    assert!(report.toolchain.is_none());
}

/// The whole happy path: install runs, every declared command runs, the test
/// figures are parsed out of what the command printed, and a passing typecheck
/// gates nothing.
#[tokio::test]
async fn a_passing_toolchain_records_every_command_and_gates_nothing() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: Some("true".to_string()),
        format: Some("true".to_string()),
        test: Some(
            "printf ' Test Files  2 passed (2)\\n      Tests  12 passed | 1 failed (13)\\n'; \
             printf 'File       | %% Stmts | %% Branch | %% Funcs | %% Lines | Uncovered\\n'; \
             printf 'All files  |   85.71 |    72.22 |     100 |   84.13 |\\n'"
                .to_string(),
        ),
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    assert!(summary.install.succeeded);
    assert!(summary.typecheck.ran && summary.typecheck.succeeded);
    assert!(summary.lint.as_ref().expect("lint declared").succeeded);
    assert!(summary.format.as_ref().expect("format declared").succeeded);

    let test = summary.test.as_ref().expect("test declared");
    assert_eq!(test.tests_total, Some(13));
    assert_eq!(test.tests_passed, Some(12));
    assert_eq!(test.tests_failed, Some(1));
    assert_eq!(test.coverage_percent, Some(84.13));

    assert!(!summary.gates(), "a passing typecheck must not gate");

    // `true` builds nothing, so the smoke check has no site to serve and says so
    // rather than reporting a boot failure the build never had.
    let smoke = summary
        .smoke
        .as_ref()
        .expect("a smoke result is always recorded");
    assert!(!smoke.ran);
    assert!(smoke.detail.is_some());
}

/// A failing typecheck gates the run, and the other commands still run and are
/// still recorded — the gate is a verdict on one command, not a reason to stop
/// reporting.
#[tokio::test]
async fn a_failing_typecheck_gates_the_run() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "printf 'src/main.ts(3,7): error TS2322\\n'; exit 2".to_string(),
        lint: Some("true".to_string()),
        format: None,
        test: None,
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    assert!(summary.typecheck.ran && !summary.typecheck.succeeded);
    assert!(summary.typecheck.output.contains("error TS2322"));
    assert!(summary.gates());
    assert!(
        summary.lint.as_ref().expect("lint declared").ran,
        "a gating typecheck must not stop the recorded commands"
    );
}

/// When the install fails, nothing below it ran — and every command says so rather
/// than reporting a failure it never got the chance to earn. Crucially the run is
/// NOT gated: a host that could not install dependencies has learned nothing about
/// whether the code compiles.
#[tokio::test]
async fn a_failed_install_skips_every_command_without_gating() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: Some("true".to_string()),
        format: Some("true".to_string()),
        test: Some("true".to_string()),
    };
    let build = BuildCommands {
        install: "exit 1".to_string(),
        build: "true".to_string(),
        module: None,
    };
    let report = drive(repo.path(), Some(toolchain), Some(build), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    assert!(!summary.install.succeeded);
    assert!(!summary.typecheck.ran);
    assert!(!summary.lint.as_ref().expect("lint declared").ran);
    assert!(!summary.format.as_ref().expect("format declared").ran);
    assert!(!summary.test.as_ref().expect("test declared").result.ran);
    assert!(
        !summary.gates(),
        "a typecheck that never ran must never gate the run"
    );
}

/// A tree that never reached the host, or that is not a node project, is not
/// checked at all.
#[tokio::test]
async fn a_tree_with_no_package_manifest_is_not_checked() {
    let toolchain = ToolchainCommands {
        typecheck: "exit 2".to_string(),
        lint: None,
        format: None,
        test: None,
    };
    let empty = tempfile::tempdir().expect("empty tree");
    let report = drive(
        empty.path(),
        Some(toolchain.clone()),
        Some(noop_build()),
        false,
    )
    .await;
    assert!(report.toolchain.is_none());

    let missing = empty.path().join("never-collected");
    let report = drive(&missing, Some(toolchain), Some(noop_build()), false).await;
    assert!(report.toolchain.is_none());
}
