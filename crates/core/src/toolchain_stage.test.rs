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
use crate::toolchain::{ToolchainCommandResult, ToolchainCommands};

/// A resolved version carrying `build` and (optionally) `toolchain`, and nothing
/// else the stage reads.
fn version(toolchain: Option<ToolchainCommands>, build: Option<BuildCommands>) -> TestCaseVersion {
    TestCaseVersion {
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
        asset_dimension: crate::test_case::AssetDimension::TwoD,
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
        showcase: None,
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
        gg_model_providers: std::collections::BTreeMap::new(),
        gg_model_modalities: std::collections::BTreeMap::new(),
        gg_model_prices: std::collections::BTreeMap::new(),
        model_prices: None,
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
    let artifacts = ArtifactCollection::new(repo.to_path_buf());
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
    ToolchainStage {
        install_retry_delay: Duration::ZERO,
    }
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
    let result = run_command(
        repo.path(),
        "printf 'on stdout\\n'; printf 'on stderr\\n' >&2",
        Duration::from_secs(30),
    )
    .await;
    assert!(result.ran && result.succeeded);
    assert_eq!(result.exit_code, Some(0));
    assert!(result.output.contains("on stdout") && result.output.contains("on stderr"));
    assert!(!result.truncated);
}

/// A non-zero exit is recorded as a failure that *ran* — the distinction the gate
/// turns on.
#[tokio::test]
async fn a_command_that_fails_records_its_exit_code() {
    let repo = tempfile::tempdir().expect("repo");
    let result = run_command(repo.path(), "exit 3", Duration::from_secs(30)).await;
    assert!(result.ran);
    assert!(!result.succeeded);
    assert_eq!(result.exit_code, Some(3));
}

/// A command that never terminates is recorded as *not run*, with the reason — not
/// as a failure it did not earn. A timed-out typecheck must not gate the run.
#[tokio::test]
async fn a_command_that_outruns_its_timeout_is_recorded_as_not_run() {
    let repo = tempfile::tempdir().expect("repo");
    let result = run_command(repo.path(), "sleep 30", Duration::from_millis(200)).await;
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
    let result = run_command(
        repo.path(),
        "i=0; while [ $i -lt 4000 ]; do printf 'error TS2322: a very long diagnostic line\\n'; i=$((i+1)); done",
        Duration::from_secs(60),
    )
    .await;
    assert!(result.ran);
    assert!(
        result.truncated,
        "the fixture must actually overflow the cap"
    );
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

/// The shell line a fixture `test` command runs to stand in for the case's build
/// vitest config: it writes the two report files into `coverage/` exactly where the
/// config's `outputFile` and istanbul's default directory put them.
///
/// The paths inside the reports are absolute, under `repo`, the tree the command
/// runs in, because that is how both reporters really key them, and relativising
/// them is the reader's job. They are JSON-encoded here and the heredocs are quoted,
/// so a Windows path's backslashes reach the file untouched by the shell. `exit_code`
/// is the status the command then exits with, so a suite that failed can be shown to
/// have reported anyway.
fn writes_reports(repo: &Path, exit_code: i32) -> String {
    let inside = |relative: &str| repo.join(relative).to_string_lossy().into_owned();
    let json = |text: &str| serde_json::to_string(text).expect("a string is json");
    let test_file = json(&inside("src/game.test.ts"));
    let failure = json(&format!(
        "AssertionError: expected 0 to be 7\n    at run ({}:12:3)",
        inside("src/game.test.ts")
    ));
    let source_file = json(&inside("src/game.ts"));
    format!(
        r#"mkdir -p coverage
cat > coverage/test-report.json <<'JSON'
{{"numTotalTestSuites":2,"numTotalTests":3,"numPassedTests":2,"numFailedTests":1,
  "numPendingTests":0,"numTodoTests":0,"success":false,
  "testResults":[{{"name":{test_file},"message":"","assertionResults":[
    {{"fullName":"the game advances","title":"advances","status":"passed","failureMessages":[]}},
    {{"fullName":"the game scores","title":"scores","status":"passed","failureMessages":[]}},
    {{"fullName":"the game ends","title":"ends","status":"failed",
      "failureMessages":[{failure}]}}]}}]}}
JSON
cat > coverage/coverage-summary.json <<'JSON'
{{"total":{{"lines":{{"total":50,"covered":41,"skipped":0,"pct":82}},
           "statements":{{"total":52,"covered":42,"skipped":0,"pct":80.77}},
           "functions":{{"total":10,"covered":9,"skipped":0,"pct":90}},
           "branches":{{"total":8,"covered":5,"skipped":0,"pct":62.5}},
           "branchesTrue":{{"total":0,"covered":0,"skipped":0,"pct":"Unknown"}}}},
 {source_file}:{{"lines":{{"total":50,"covered":41,"skipped":0,"pct":82}},
                      "statements":{{"total":52,"covered":42,"skipped":0,"pct":80.77}},
                      "functions":{{"total":10,"covered":9,"skipped":0,"pct":90}},
                      "branches":{{"total":8,"covered":5,"skipped":0,"pct":62.5}}}}}}
JSON
exit {exit_code}"#
    )
}

/// The whole happy path: install runs, every declared command runs, the test figures
/// come out of the REPORT FILES the command wrote, and a passing typecheck gates
/// nothing.
#[tokio::test]
async fn a_passing_toolchain_records_every_command_and_gates_nothing() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: Some("true".to_string()),
        format: Some("true".to_string()),
        test: Some(writes_reports(repo.path(), 0)),
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    assert!(summary.install.succeeded);
    assert!(summary.typecheck.ran && summary.typecheck.succeeded);
    assert!(summary.lint.as_ref().expect("lint declared").succeeded);
    assert!(summary.format.as_ref().expect("format declared").succeeded);

    let test = summary.test.as_ref().expect("test declared");
    let tests = test.tests.as_ref().expect("the runner wrote a report");
    assert_eq!((tests.total, tests.passed, tests.failed), (3, 2, 1));
    assert_eq!(tests.files_run, 1);
    // The absolute path the reporter wrote is relativised against the tree it was
    // written in, which is the whole point of reading the file from the stage.
    assert_eq!(tests.files[0].path, "src/game.test.ts");
    assert_eq!(
        tests.failures[0].message.as_deref(),
        Some("AssertionError: expected 0 to be 7"),
        "the failure's stack frames never reach the record"
    );

    let coverage = test.coverage.as_ref().expect("and a coverage summary");
    assert_eq!(coverage.totals.lines.pct, Some(82.0));
    assert_eq!(coverage.files_measured, 1);
    assert_eq!(coverage.files[0].path, "src/game.ts");

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

/// A failing suite still wrote its reports — `reportOnFailure` is what makes that
/// true — so the figures are read whatever the command exited with. A red suite is
/// the one whose coverage is most worth having, and it still gates nothing.
#[tokio::test]
async fn a_failing_test_command_still_records_the_figures_it_reported() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: None,
        format: None,
        test: Some(writes_reports(repo.path(), 1)),
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    let test = summary.test.as_ref().expect("test declared");
    assert!(test.result.ran && !test.result.succeeded);
    assert_eq!(
        test.tests
            .as_ref()
            .expect("a report was still written")
            .failed,
        1
    );
    assert!(test.coverage.is_some());
    assert!(!summary.gates(), "only the typecheck gates");
}

/// A case whose configuration writes no report files records **nothing** — not
/// zeroes. Every case version predating the report-file contract is in this arm, and
/// a console renders no widget at all for it rather than an empty one.
#[tokio::test]
async fn a_test_command_that_writes_no_reports_records_no_figures() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: None,
        format: None,
        test: Some(" Test Files  3 passed (3)\n      Tests  27 passed (27)".to_string())
            .map(|line| format!("printf '{line}\n'")),
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    let test = summary.test.as_ref().expect("test declared");
    assert!(test.result.ran && test.result.succeeded);
    assert!(
        test.result.output.contains("27 passed"),
        "the excerpt still carries what the command said, as a transcript"
    );
    assert!(
        test.tests.is_none() && test.coverage.is_none(),
        "nothing is ever derived from that transcript again"
    );
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
    // The tree holds a green report the MODEL's own in-container test run left behind,
    // which is what makes the assertion below about behaviour rather than about an
    // empty directory.
    seed_reports(repo.path());

    let report = drive(repo.path(), Some(toolchain), Some(build), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    assert!(!summary.install.succeeded);
    assert!(!summary.typecheck.ran);
    assert!(!summary.lint.as_ref().expect("lint declared").ran);
    assert!(!summary.format.as_ref().expect("format declared").ran);
    let test = summary.test.as_ref().expect("test declared");
    assert!(!test.result.ran);
    assert!(
        test.tests.is_none() && test.coverage.is_none(),
        "a command that never ran reports no figures, whatever the tree happens to hold"
    );
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

/// Write the two report files into `repo` as the model's own in-container test run
/// leaves them: a green suite over a file that is not this stage's doing.
///
/// The collector copies everything but `node_modules`, so a `coverage/` the model
/// produced arrives on the host intact. This is the tree every test below starts from.
fn seed_reports(repo: &Path) {
    std::fs::create_dir_all(repo.join("coverage")).expect("a coverage directory");
    std::fs::write(
        repo.join(crate::toolchain::TOOLCHAIN_TEST_REPORT_PATH),
        r#"{"numTotalTestSuites":1,"numTotalTests":27,"numPassedTests":27,
            "numFailedTests":0,"numPendingTests":0,"numTodoTests":0,"success":true,
            "testResults":[]}"#,
    )
    .expect("a seeded test report");
    std::fs::write(
        repo.join(crate::toolchain::TOOLCHAIN_COVERAGE_SUMMARY_PATH),
        r#"{"total":{"lines":{"total":10,"covered":10,"skipped":0,"pct":100},
                    "statements":{"total":10,"covered":10,"skipped":0,"pct":100},
                    "functions":{"total":2,"covered":2,"skipped":0,"pct":100},
                    "branches":{"total":2,"covered":2,"skipped":0,"pct":100}}}"#,
    )
    .expect("a seeded coverage summary");
}

/// Whether either report file is still in `repo`.
fn reports_present(repo: &Path) -> bool {
    repo.join(crate::toolchain::TOOLCHAIN_TEST_REPORT_PATH)
        .exists()
        || repo
            .join(crate::toolchain::TOOLCHAIN_COVERAGE_SUMMARY_PATH)
            .exists()
}

/// A command that ran and wrote nothing reports nothing, even when the tree arrived
/// holding a green report of its own.
///
/// The model runs its own suite inside the container while the build is green, and the
/// collected tree carries what that wrote. Any number of ordinary things then stop the
/// host's own invocation from producing a report of its own: a `vitest.config.ts` the
/// build renamed, the runner dropped from `devDependencies`, a crash before the
/// reporter flushes. Reading whatever is lying there would put another invocation's
/// figures on this run's record, under a `100%` no command here produced.
#[tokio::test]
async fn a_stale_report_left_by_the_model_is_never_recorded_as_this_commands_figures() {
    let repo = produced_tree();
    seed_reports(repo.path());
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: None,
        format: None,
        test: Some("exit 7".to_string()),
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    let test = summary.test.as_ref().expect("test declared");
    assert!(test.result.ran && !test.result.succeeded);
    assert!(
        test.tests.is_none() && test.coverage.is_none(),
        "the figures must describe THIS invocation or no invocation at all"
    );
    assert!(
        !reports_present(repo.path()),
        "the stale reports are cleared, not carried into the published tree"
    );
}

/// The reports the stage's own command wrote do not survive into the published tree.
///
/// `implementation/` is copied and served as what the model produced. Both files are the
/// host's writing: istanbul keys its summary by absolute host path and the test report
/// embeds the whole instrumentation map plus unstripped stack frames, all of which the
/// record itself takes care to strip before storing anything.
#[tokio::test]
async fn the_reports_are_removed_once_they_have_been_read() {
    let repo = produced_tree();
    let toolchain = ToolchainCommands {
        typecheck: "true".to_string(),
        lint: None,
        format: None,
        test: Some(writes_reports(repo.path(), 0)),
    };
    let report = drive(repo.path(), Some(toolchain), Some(noop_build()), false).await;
    let summary = report.toolchain.expect("a declared toolchain is recorded");

    let test = summary.test.as_ref().expect("test declared");
    assert!(
        test.tests.is_some() && test.coverage.is_some(),
        "the figures were read before the files were removed"
    );
    assert!(!reports_present(repo.path()));
}

/// A command that never ran contributes no figures, whatever the tree holds — and a
/// command that ran and failed contributes all of them.
///
/// The gate is on `ran`, not on the exit code, and both halves matter. A timed-out or
/// unstartable command has no result to describe, including when it flushed a partial
/// report on its way to being killed. A red suite, on the other hand, wrote its coverage
/// (`reportOnFailure`) and is the one whose coverage is most worth having.
#[test]
fn only_a_test_command_that_ran_contributes_the_figures_in_the_tree() {
    let repo = tempfile::tempdir().expect("repo");
    seed_reports(repo.path());

    let never_ran = ToolchainCommandResult::skipped("npx vitest run --coverage", "timed out");
    assert_eq!(reported_figures(repo.path(), &never_ran), (None, None));

    let ran_and_failed = ToolchainCommandResult::ran("npx vitest run --coverage", Some(1), "");
    let (tests, coverage) = reported_figures(repo.path(), &ran_and_failed);
    assert_eq!(
        tests.expect("a failing suite still wrote its report").total,
        27
    );
    assert!(coverage.is_some());
}
