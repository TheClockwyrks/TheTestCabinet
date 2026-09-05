//! The vitest validator runner: how a reporter document becomes verdicts, how a test
//! file is matched to the review point that declared it, and what a run the runner
//! could not perform reports.
//!
//! Nothing here runs vitest. What is under test is the runner's own behaviour — the
//! shape of the report it reads, the mapping it applies, the caps it holds to, and the
//! difference between a check the build failed and a check that never ran — and a test
//! that needed a node toolchain on the host would prove less and fail more.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::*;
use crate::engine::{EngineCatalog, EngineSelection};
use crate::test_case::{
    AssetDimension, AssetKind, MediaKind, ReviewItem, ReviewOutput, ReviewValidation,
    SubReviewItem, TestCaseVersion, TestType, Variant,
};

// --- Fixtures ---------------------------------------------------------------

/// A resolved version rooted at `root`, carrying `items` as its common review
/// checklist and nothing else the runner reads.
fn version(root: PathBuf, items: Vec<ReviewItem>) -> TestCaseVersion {
    TestCaseVersion {
        engine_format: false,
        instrumentation: None,
        slug: "carom".to_string(),
        version: "v3.0.0".to_string(),
        experimental: false,
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: PathBuf::new(),
        root,
        prompt_path: PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 3600,
        test_type: TestType::EndToEnd,
        build: None,
        toolchain: None,
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
        engines: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: items,
        domains: Vec::new(),
        cases: Vec::new(),
        errata: Vec::new(),
    }
}

/// The variant the fixture case is validated for.
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

/// A review item decided by the validator at `script_rel`.
fn item(id: &str, script_rel: &str) -> ReviewItem {
    ReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        id: id.to_string(),
        title: format!("The {id} point"),
        text: String::new(),
        reference: None,
        proof: None,
        sequences: Vec::new(),
        frames: Vec::new(),
        weight: 1,
        graded: true,
        domain: None,
        sub_items: Vec::new(),
        scored: true,
        validation: Some(validation(script_rel)),
    }
}

/// A sub-item decided by the validator at `script_rel`.
fn sub_item(id: &str, script_rel: &str) -> SubReviewItem {
    SubReviewItem {
        failure_cap: None,
        domains: Vec::new(),
        id: id.to_string(),
        title: format!("The {id} sub-point"),
        description: None,
        weight: 1,
        reference: None,
        proof: None,
        scored: true,
        validation: Some(validation(script_rel)),
    }
}

fn validation(script_rel: &str) -> ReviewValidation {
    ReviewValidation {
        script: Some(PathBuf::from(script_rel)),
        script_rel: script_rel.to_string(),
        engines: Vec::new(),
        outputs: Vec::new(),
    }
}

/// A review item decided by the validator at `script_rel`, which declares `outputs`
/// as its proof media.
fn item_with_outputs(id: &str, script_rel: &str, outputs: Vec<ReviewOutput>) -> ReviewItem {
    let mut item = item(id, script_rel);
    item.validation = Some(ReviewValidation {
        outputs,
        ..validation(script_rel)
    });
    item
}

/// One declared media output.
fn output(id: &str, kind: MediaKind) -> ReviewOutput {
    ReviewOutput {
        id: id.to_string(),
        name: format!("The {id}"),
        kind,
    }
}

/// The `simple-2d` engine, which vendors a runtime.
fn engine() -> crate::engine::ResolvedEngine {
    EngineCatalog::default()
        .resolve(&EngineSelection::new("simple-2d"))
        .expect("simple-2d is a built-in engine")
}

/// The suite for the first verdict unit `items` declares.
fn suite_for(items: &[ReviewItem]) -> Suite {
    let units = drive_units(items);
    Suite::of(&units[0], "simple-2d")
}

/// The `simple-2d` suites for a checklist of `(point id, declared script)` pairs, in
/// declared order — the shape `run_vitest_suites` builds its filters from.
fn suites_for(points: &[(&str, &str)]) -> Vec<Suite> {
    let items: Vec<ReviewItem> = points
        .iter()
        .map(|(id, script_rel)| item(id, script_rel))
        .collect();
    drive_units(&items)
        .iter()
        .map(|unit| Suite::of(unit, "simple-2d"))
        .collect()
}

/// A realistic vitest JSON reporter document over three files: one whose checks all
/// passed, one with a failing check beside a passing one, and one whose single check
/// was skipped.
fn reporter_document(repo: &Path) -> String {
    let file = |name: &str| repo.join(name).to_string_lossy().replace('\\', "/");
    serde_json::json!({
        "numTotalTestSuites": 3,
        "numTotalTests": 4,
        "success": false,
        "startTime": 1_700_000_000_000i64,
        "testResults": [
            {
                "name": file("validation/gameplay/serve-speed.test.ts"),
                "status": "passed",
                "message": "",
                "startTime": 1_700_000_000_001i64,
                "endTime": 1_700_000_000_100i64,
                "assertionResults": [{
                    "ancestorTitles": [],
                    "fullName": "serves the ball at the base serve speed",
                    "title": "serves the ball at the base serve speed",
                    "status": "passed",
                    "duration": 42,
                    "failureMessages": [],
                }],
            },
            {
                "name": file("validation/ball/no-tunnel.test.ts"),
                "status": "failed",
                "message": "",
                "startTime": 1_700_000_000_001i64,
                "endTime": 1_700_000_000_300i64,
                "assertionResults": [
                    {
                        "ancestorTitles": [],
                        "fullName": "the ball stays inside the field",
                        "title": "the ball stays inside the field",
                        "status": "passed",
                        "duration": 12,
                        "failureMessages": [],
                    },
                    {
                        "ancestorTitles": [],
                        "fullName": "the ball never passes through a paddle",
                        "title": "the ball never passes through a paddle",
                        "status": "failed",
                        "duration": 30,
                        "failureMessages": [
                            "AssertionError: expected 1 to be 0\n  - Expected\n  + Received\n  - 0\n  + 1"
                        ],
                    },
                ],
            },
            {
                "name": file("validation/gyre/obstacle-clock.test.ts"),
                "status": "passed",
                "message": "",
                "startTime": 1_700_000_000_001i64,
                "endTime": 1_700_000_000_010i64,
                "assertionResults": [{
                    "ancestorTitles": [],
                    "fullName": "a swaying obstacle deflects the ball",
                    "title": "a swaying obstacle deflects the ball",
                    "status": "skipped",
                    "failureMessages": [],
                }],
            },
        ],
    })
    .to_string()
}

// --- The reporter document --------------------------------------------------

#[test]
fn the_json_reporter_is_parsed_into_one_report_per_file() {
    let repo = Path::new("/runs/impl");
    let reports = parse_report(&reporter_document(repo), repo).expect("the document parses");

    let files: Vec<&str> = reports.iter().map(|r| r.file.as_str()).collect();
    assert_eq!(
        files,
        [
            "validation/gameplay/serve-speed.test.ts",
            "validation/ball/no-tunnel.test.ts",
            "validation/gyre/obstacle-clock.test.ts",
        ],
        "each file is keyed by its path relative to the repository root",
    );
    assert_eq!(
        reports[1].tests[1].status,
        TestStatus::Failed,
        "a failing check is reported failed",
    );
    assert_eq!(
        reports[2].tests[0].status,
        TestStatus::Skipped,
        "a skipped check is reported skipped",
    );
}

#[test]
fn an_unreadable_report_is_a_runner_failure() {
    let error = parse_report("not json at all", Path::new("/runs/impl"))
        .expect_err("a malformed document cannot be read");
    assert!(
        error.contains("could not be read"),
        "the reason names the report: {error}",
    );
}

// --- The file-to-item mapping -----------------------------------------------

#[test]
fn a_declared_validator_maps_to_the_file_staged_for_the_runs_engine() {
    assert_eq!(
        staged_path(
            "validation/simple-2d/gameplay/serve-speed.test.ts",
            "simple-2d"
        ),
        Some("validation/gameplay/serve-speed.test.ts".to_string()),
        "the engine level is what the staged tree drops",
    );
    assert_eq!(
        staged_path("validation/simple-2d/gameplay/serve-speed.test.ts", "other"),
        None,
        "a validator written for a different engine names no file in this tree",
    );
}

#[test]
fn a_file_that_passed_earns_its_declaring_item_a_passing_verdict() {
    let repo = Path::new("/runs/impl");
    let reports = parse_report(&reporter_document(repo), repo).expect("the document parses");
    let items = vec![item(
        "serve-speed",
        "validation/simple-2d/gameplay/serve-speed.test.ts",
    )];
    let suite = suite_for(&items);

    let result = suite.result(
        reports
            .iter()
            .find(|r| r.file == "validation/gameplay/serve-speed.test.ts"),
    );
    assert!(result.ran, "the suite ran");
    assert_eq!(result.item_id, "serve-speed");
    assert_eq!(
        result.script, "validation/simple-2d/gameplay/serve-speed.test.ts",
        "the result names the validator the manifest declared, not the staged copy",
    );
    assert_eq!(result.verdicts.len(), 1);
    assert!(result.verdicts[0].pass, "every check passed");
    assert_eq!(result.verdicts[0].id, "serve-speed");
    assert!(
        result.outputs.is_empty(),
        "this point declares no media, so there is nothing to report the presence of",
    );
}

#[test]
fn a_sub_item_validator_decides_the_composite_verdict_id() {
    let mut parent = item("ball", "validation/simple-2d/ball/whole.test.ts");
    parent.validation = None;
    parent.sub_items = vec![sub_item(
        "no-tunnel",
        "validation/simple-2d/ball/no-tunnel.test.ts",
    )];
    let items = vec![parent];
    let suite = suite_for(&items);

    let repo = Path::new("/runs/impl");
    let reports = parse_report(&reporter_document(repo), repo).expect("the document parses");
    let result = suite.result(
        reports
            .iter()
            .find(|r| r.file == "validation/ball/no-tunnel.test.ts"),
    );
    assert_eq!(result.item_id, "ball");
    assert_eq!(result.sub_item_id.as_deref(), Some("no-tunnel"));
    assert_eq!(result.verdicts[0].id, "ball.no-tunnel");
}

#[test]
fn a_file_with_a_failing_check_fails_its_point_and_names_the_assertion() {
    let repo = Path::new("/runs/impl");
    let reports = parse_report(&reporter_document(repo), repo).expect("the document parses");
    let items = vec![item(
        "no-tunnel",
        "validation/simple-2d/ball/no-tunnel.test.ts",
    )];
    let suite = suite_for(&items);

    let result = suite.result(
        reports
            .iter()
            .find(|r| r.file == "validation/ball/no-tunnel.test.ts"),
    );
    assert!(result.ran, "the suite ran; it is the build that failed");
    assert!(!result.precondition_unmet);
    let verdict = &result.verdicts[0];
    assert!(!verdict.pass, "a failing check fails the point");
    assert_eq!(verdict.assertions.len(), 2, "both checks are proof");
    assert!(verdict.assertions[0].pass, "the check that held is kept");
    let failed = &verdict.assertions[1];
    assert!(!failed.pass);
    assert_eq!(failed.label, "the ball never passes through a paddle");
    assert_eq!(
        failed.expected.as_deref(),
        Some("0"),
        "the chai message's bound is the expected: {failed:?}",
    );
    assert_eq!(
        failed.actual.as_deref(),
        Some("1"),
        "the chai message's measured value is the actual: {failed:?}",
    );
}

/// A one-file, one-test reporter document whose test failed with `messages`.
fn failing_document(repo: &Path, messages: &[&str]) -> String {
    let file = repo
        .join("validation/rendering/window-fit.test.ts")
        .to_string_lossy()
        .replace('\\', "/");
    serde_json::json!({
        "testResults": [{
            "name": file,
            "status": "failed",
            "message": "",
            "assertionResults": [{
                "fullName": "leaves the letterbox bars bare",
                "title": "leaves the letterbox bars bare",
                "status": "failed",
                "failureMessages": messages,
            }],
        }],
    })
    .to_string()
}

/// The one assertion the suite built over `failing_document(messages)` stores.
fn stored_assertion(messages: &[&str]) -> Assertion {
    let repo = Path::new("/runs/impl");
    let reports =
        parse_report(&failing_document(repo, messages), repo).expect("the document parses");
    let items = vec![item(
        "window-fit",
        "validation/simple-2d/rendering/window-fit.test.ts",
    )];
    let result = suite_for(&items).result(reports.first());
    result.verdicts[0].assertions[0].clone()
}

#[test]
fn a_stack_traced_chai_failure_is_stored_as_its_own_pair_with_no_frames() {
    let stored = stored_assertion(&[concat!(
        "AssertionError: expected 9.097252332435328 to be less than or equal to 8\n",
        "    at /home/node/workspace/validation/rendering/window-fit.test.ts:175:21\n",
        "    at processTicksAndRejections (node:internal/process/task_queues:105:5)",
    )]);
    assert_eq!(
        stored.expected.as_deref(),
        Some("less than or equal to 8"),
        "the bound the matcher stated: {stored:?}",
    );
    assert_eq!(
        stored.actual.as_deref(),
        Some("9.097252332435328"),
        "the value the build produced: {stored:?}",
    );
}

#[test]
fn a_helper_shaped_failure_carries_its_stated_pair() {
    let stored = stored_assertion(&[concat!(
        "Error: Expected: at most 8\n",
        "Actual: 9.097252332435328\n",
        "    at fail (/home/node/workspace/validation/assert.ts:38:9)\n",
        "    at assertLessThanOrEqual (/home/node/workspace/validation/assert.ts:104:26)",
    )]);
    assert_eq!(stored.expected.as_deref(), Some("at most 8"));
    assert_eq!(stored.actual.as_deref(), Some("9.097252332435328"));
}

#[test]
fn a_failure_stating_no_comparison_falls_back_to_the_frameless_excerpt() {
    let stored = stored_assertion(&[concat!(
        "Error: the harness could not settle the scene\n",
        "    at arrange (/home/node/workspace/validation/harness.ts:1846:11)",
    )]);
    assert_eq!(stored.expected.as_deref(), Some("the check holds"));
    assert_eq!(
        stored.actual.as_deref(),
        Some("Error: the harness could not settle the scene"),
        "the message survives, the frames do not: {stored:?}",
    );
}

#[test]
fn a_negated_matcher_is_not_forced_into_a_pair() {
    let stored = stored_assertion(&["AssertionError: expected 5 not to be 3"]);
    assert_eq!(
        stored.expected.as_deref(),
        Some("the check holds"),
        "a negation has no honest expected value: {stored:?}",
    );
}

#[test]
fn a_close_to_failure_keeps_its_tolerance_in_the_expected() {
    // The message shape is vitest's own, verified against vitest 3.
    let stored = stored_assertion(&[
        "AssertionError: expected 9 to be close to 5, received difference is 4, but expected 0.005",
    ]);
    assert_eq!(stored.expected.as_deref(), Some("within 0.005 of 5"));
    assert_eq!(stored.actual.as_deref(), Some("9"));
}

#[test]
fn a_to_be_failure_drops_the_comparator_note() {
    let stored = stored_assertion(&["AssertionError: expected 2 to be 3 // Object.is equality"]);
    assert_eq!(stored.expected.as_deref(), Some("3"));
    assert_eq!(stored.actual.as_deref(), Some("2"));
}

#[test]
fn no_stored_assertion_carries_a_stack_frame() {
    // Whatever shape the failure takes, nothing with a file path or a line
    // number survives into what the UI renders.
    for messages in [
        &["AssertionError: expected 1 to be 0\n    at /a/b/c.test.ts:1:2"][..],
        &["Error: it broke\n    at run (file:///a/b/c.ts:3:4)\n    at node:internal/x:1:1"][..],
    ] {
        let stored = stored_assertion(messages);
        for field in [&stored.expected, &stored.actual] {
            let text = field.as_deref().unwrap_or_default();
            assert!(
                !text.contains(".ts:") && !text.contains("    at "),
                "no frame reaches the stored assertion: {text:?}",
            );
        }
    }
}

#[test]
fn an_unindented_line_opening_with_at_is_message_rather_than_frame() {
    let cleaned = sanitize_failure(concat!(
        "Error: the sweep read too little\n",
        "at least three samples were needed\n",
        "    at sweep (/home/node/workspace/validation/harness.ts:12:3)",
    ));
    assert_eq!(
        cleaned, "Error: the sweep read too little\nat least three samples were needed",
        "prose keeps its place; only the indented locator goes",
    );
}

#[test]
fn a_file_level_message_is_stored_without_frames() {
    let repo = Path::new("/runs/impl");
    let file = repo
        .join("validation/rendering/window-fit.test.ts")
        .to_string_lossy()
        .replace('\\', "/");
    let document = serde_json::json!({
        "testResults": [{
            "name": file,
            "status": "failed",
            "message": "Error: Cannot find module './surface'\n    at load (node:internal/modules/cjs/loader:1:1)",
            "assertionResults": [],
        }],
    })
    .to_string();
    let reports = parse_report(&document, repo).expect("the document parses");
    assert_eq!(
        reports[0].message.as_deref(),
        Some("Error: Cannot find module './surface'"),
        "the file-level error keeps its message and loses its frames",
    );
}

#[test]
fn a_suite_whose_checks_were_all_skipped_leaves_its_point_for_the_reviewer() {
    let repo = Path::new("/runs/impl");
    let reports = parse_report(&reporter_document(repo), repo).expect("the document parses");
    let items = vec![item(
        "obstacle-clock",
        "validation/simple-2d/gyre/obstacle-clock.test.ts",
    )];
    let suite = suite_for(&items);

    let result = suite.result(
        reports
            .iter()
            .find(|r| r.file == "validation/gyre/obstacle-clock.test.ts"),
    );
    assert!(!result.ran);
    assert!(
        result.precondition_unmet,
        "a fully skipped suite is inconclusive, not a failure",
    );
    assert!(result.verdicts.is_empty(), "no verdict is synthesized");
    assert!(
        result
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("skipped"),
        "the reason is recorded: {:?}",
        result.detail,
    );
}

#[test]
fn a_suite_that_ran_no_checks_at_all_fails_the_point_it_backs() {
    let report = SuiteReport {
        file: "validation/ball/no-tunnel.test.ts".to_string(),
        message: Some(
            "Error: Failed to load url ../../src/game.ts (resolved id: ../../src/game.ts)"
                .to_string(),
        ),
        tests: Vec::new(),
    };
    let items = vec![item(
        "no-tunnel",
        "validation/simple-2d/ball/no-tunnel.test.ts",
    )];
    let result = suite_for(&items).result(Some(&report));

    assert!(!result.ran);
    assert!(
        !result.precondition_unmet,
        "the case mandates the module the validator imports, so this is the build's failure",
    );
    assert_eq!(result.verdicts.len(), 1);
    assert!(!result.verdicts[0].pass);
    assert!(
        result
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("Failed to load url"),
        "the loader's error is carried: {:?}",
        result.detail,
    );
}

#[test]
fn a_declared_validator_the_project_does_not_contain_is_not_a_failure() {
    let items = vec![item(
        "serve-speed",
        "validation/simple-2d/gameplay/serve-speed.test.ts",
    )];
    let result = suite_for(&items).result(None);

    assert!(!result.ran);
    assert!(result.precondition_unmet);
    assert!(result.verdicts.is_empty());
    assert!(
        result
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("no suite at"),
        "the reason names the missing suite: {:?}",
        result.detail,
    );
}

// --- A run the runner could not perform -------------------------------------

#[test]
fn a_case_with_no_validator_project_for_the_engine_reports_every_point_as_not_run() {
    let root = tempfile::tempdir().expect("a scratch case root");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let items = vec![
        item(
            "serve-speed",
            "validation/simple-2d/gameplay/serve-speed.test.ts",
        ),
        item("no-tunnel", "validation/simple-2d/ball/no-tunnel.test.ts"),
    ];
    let test_case = version(root.path().to_path_buf(), items);
    let artifacts = ArtifactCollection::new(repo.path().to_path_buf());

    let results = run_vitest_suites(
        &test_case,
        &variant(),
        engine().slug(),
        &artifacts,
        "npm ci",
        &repo.path().join(crate::validator::VALIDATION_MEDIA_DIR),
    );

    assert_eq!(results.len(), 2, "every declared point is still reported");
    for result in &results {
        assert!(!result.ran);
        assert!(
            result.precondition_unmet,
            "a runner that could not execute earns the build no failure",
        );
        assert!(result.verdicts.is_empty());
        assert!(
            result
                .detail
                .as_deref()
                .unwrap_or_default()
                .contains("validator project"),
            "the reason is recorded: {:?}",
            result.detail,
        );
    }
}

#[test]
fn a_run_that_outlives_its_cap_leaves_every_point_inconclusive_rather_than_failed() {
    // The one budget a test can expire in milliseconds is the install's, and it is
    // bounded by the same `run_bounded` the suite run is, so what it proves about the
    // cap holds for both: a host too slow to finish inside the budget decides nothing.
    //
    // The store is seeded because the run has to get PAST staging to reach the
    // install: a host with no shared harness to stage refuses the run as `not-run`
    // before any budget starts running down, which is a different outcome from the
    // one under test here.
    let store = package_store_with_case_harness();
    use_package_store(store.path());
    let root = tempfile::tempdir().expect("a scratch case root");
    let project = root
        .path()
        .join(crate::validator::VALIDATION_SCRIPT_DIR)
        .join("simple-2d");
    std::fs::create_dir_all(&project).expect("a scratch validator project");
    std::fs::write(project.join(VITEST_CONFIG_FILE), "export default {};")
        .expect("the project's config");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let items = vec![
        item(
            "serve-speed",
            "validation/simple-2d/gameplay/serve-speed.test.ts",
        ),
        item("no-tunnel", "validation/simple-2d/ball/no-tunnel.test.ts"),
    ];
    let test_case = version(root.path().to_path_buf(), items.clone());
    let artifacts = ArtifactCollection::new(repo.path().to_path_buf());

    let results = run_vitest_suites_bounded(
        &test_case,
        &variant(),
        engine().slug(),
        &artifacts,
        "sleep 30",
        &repo.path().join(crate::validator::VALIDATION_MEDIA_DIR),
        Caps {
            suite: Duration::from_millis(300),
            install: Duration::from_millis(300),
        },
    );

    assert_eq!(results.len(), 2, "every declared point is still reported");
    for result in &results {
        assert!(!result.ran);
        assert!(
            result.verdicts.is_empty(),
            "an expired budget synthesizes no verdict, so nothing fails the build",
        );
        assert!(
            result.precondition_unmet,
            "an expired budget is inconclusive about the build",
        );
        assert_eq!(
            result.inconclusive,
            Some(Inconclusive::TimedOut),
            "and it says so as a fact about the host, not an unmet precondition",
        );
        assert!(
            result.detail.as_deref().unwrap_or_default().contains("cap"),
            "the reason is recorded: {:?}",
            result.detail,
        );
    }

    // The scoring rule the reviewer's checklist and the automated score share: an
    // inconclusive point is not a lost point, it is an unanswered one.
    let score = crate::comparison::automated_only_score(&items, &results);
    assert_eq!(
        (score.earned, score.total),
        (0.0, 0),
        "a run stopped at its cap contributes to neither side of the score",
    );
}

#[test]
fn a_suite_that_declined_to_decide_is_held_apart_from_one_the_runner_could_not_execute() {
    let items = vec![item(
        "serve-speed",
        "validation/simple-2d/gameplay/serve-speed.test.ts",
    )];
    let suite = suite_for(&items);

    let skipped = suite.result(Some(&SuiteReport {
        file: "validation/gameplay/serve-speed.test.ts".to_string(),
        message: None,
        tests: vec![TestOutcome {
            label: "the serve leaves at the declared speed".to_string(),
            status: TestStatus::Skipped,
            failure: None,
        }],
    }));
    assert_eq!(
        skipped.inconclusive,
        Some(Inconclusive::PreconditionUnmet),
        "a suite that skipped every check declined to decide against this build",
    );

    let missing = suite.result(None);
    assert_eq!(
        missing.inconclusive,
        Some(Inconclusive::NotRun),
        "a suite the project does not contain is a fact about the case",
    );
}

#[test]
fn the_cap_is_the_default_until_the_environment_names_a_usable_one() {
    assert_eq!(timeout_from(None), VITEST_TIMEOUT);
    assert_eq!(timeout_from(Some(" 90 ")), Duration::from_secs(90));
    for unusable in ["", "0", "-1", "ninety", "90s", "1.5"] {
        assert_eq!(
            timeout_from(Some(unusable)),
            VITEST_TIMEOUT,
            "`{unusable}` names no budget, so the default stands",
        );
    }
}

#[test]
fn a_variant_whose_every_validator_belongs_to_another_engine_runs_nothing() {
    // The project for the run's engine is present, so the runner gets as far as
    // choosing what to run — and finds that nothing this variant declares names a
    // suite of this engine. Running vitest now would collect the WHOLE staged
    // directory, which is the one thing the filters exist to prevent, so the run is
    // refused and every point is left for the reviewer.
    let root = tempfile::tempdir().expect("a scratch case root");
    let project = root
        .path()
        .join(crate::validator::VALIDATION_SCRIPT_DIR)
        .join("simple-2d");
    std::fs::create_dir_all(&project).expect("a scratch validator project");
    std::fs::write(project.join(VITEST_CONFIG_FILE), "export default {};")
        .expect("the project's config");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let items = vec![item("ball-color", "validation/none/color/ball.test.ts")];
    let test_case = version(root.path().to_path_buf(), items);
    let artifacts = ArtifactCollection::new(repo.path().to_path_buf());

    let results = run_vitest_suites(
        &test_case,
        &variant(),
        engine().slug(),
        &artifacts,
        "npm ci",
        &repo.path().join(crate::validator::VALIDATION_MEDIA_DIR),
    );

    assert_eq!(results.len(), 1, "the declared point is still reported");
    assert!(!results[0].ran);
    assert!(results[0].verdicts.is_empty());
    assert!(
        results[0]
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("nothing for the runner to run"),
        "the reason is the empty filter list, not a failure the build earned: {:?}",
        results[0].detail,
    );
}

#[test]
fn a_case_declaring_no_validators_reports_nothing() {
    let root = tempfile::tempdir().expect("a scratch case root");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let test_case = version(root.path().to_path_buf(), Vec::new());
    let artifacts = ArtifactCollection::new(repo.path().to_path_buf());

    assert!(
        run_vitest_suites(
            &test_case,
            &variant(),
            engine().slug(),
            &artifacts,
            "npm ci",
            &repo.path().join(crate::validator::VALIDATION_MEDIA_DIR),
        )
        .is_empty(),
        "there is nothing to run and nothing to record",
    );
}

// --- The caps ---------------------------------------------------------------

#[test]
fn a_command_that_outlives_its_cap_is_stopped_and_reported_as_timed_out() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let started = std::time::Instant::now();
    let error = run_bounded(
        scratch.path(),
        "sleep 30",
        Duration::from_millis(300),
        scratch.path(),
        "hung",
        &[],
    )
    .expect_err("a command that never finishes cannot succeed");

    assert!(
        started.elapsed() < Duration::from_secs(10),
        "the cap returns rather than waiting the command out",
    );
    assert!(
        error.reason.contains("cap"),
        "the reason says the cap was reached: {}",
        error.reason,
    );
    assert_eq!(
        error.inconclusive,
        Inconclusive::TimedOut,
        "a cap that expired is a fact about the host, not about the build",
    );
}

#[test]
fn a_stopped_command_takes_the_workers_it_started_with_it() {
    // The claim the cap makes is that a suite costs the run its budget and nothing
    // more. A `sh -c` line is a process tree, so killing the shell alone would leave
    // node and its workers loading the host afterwards; the group kill is what makes
    // the claim true. The background child here stands in for those workers.
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let marker = scratch.path().join("worker-survived");
    let command = format!(
        "(sleep 1; touch {}) & wait",
        marker.to_string_lossy().replace('\'', ""),
    );

    run_bounded(
        scratch.path(),
        &command,
        Duration::from_millis(200),
        scratch.path(),
        "tree",
        &[],
    )
    .expect_err("the command outlives its cap");

    // Past when the survivor would have written, had it survived.
    let watch = std::time::Instant::now();
    while watch.elapsed() < Duration::from_secs(3) {
        assert!(
            !marker.exists(),
            "a worker outlived the run that stopped waiting for it",
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_command_that_finishes_reports_its_status_and_output() {
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let ran = run_bounded(
        scratch.path(),
        "printf 'out'; printf 'err' >&2; exit 3",
        Duration::from_secs(30),
        scratch.path(),
        "quick",
        &[],
    )
    .expect("the command runs");

    assert_eq!(ran.code, Some(3));
    assert_eq!(ran.combined(), "out\nerr");
}

#[test]
fn a_suites_retained_output_is_capped() {
    let noisy = "x".repeat(VITEST_OUTPUT_LIMIT * 4);
    let tests: Vec<TestOutcome> = (0..8)
        .map(|index| TestOutcome {
            label: format!("check {index}"),
            status: TestStatus::Failed,
            failure: Some(noisy.clone()),
        })
        .collect();
    let report = SuiteReport {
        file: "validation/ball/no-tunnel.test.ts".to_string(),
        message: None,
        tests,
    };
    let items = vec![item(
        "no-tunnel",
        "validation/simple-2d/ball/no-tunnel.test.ts",
    )];
    let result = suite_for(&items).result(Some(&report));

    let retained: usize = result.verdicts[0]
        .assertions
        .iter()
        .filter_map(|assertion| assertion.actual.as_ref())
        .map(String::len)
        .sum();
    assert!(
        retained <= VITEST_OUTPUT_LIMIT + VITEST_ASSERTION_LIMIT,
        "the whole suite retains at most its budget, not {retained} bytes",
    );
    assert_eq!(
        result.verdicts[0].assertions.len(),
        8,
        "every failing check is still named, however little of it is kept",
    );
}

#[test]
fn a_bounded_excerpt_keeps_both_ends() {
    let text = format!("HEAD{}TAIL", "-".repeat(1000));
    let excerpt = bounded(&text, 64);
    assert!(excerpt.len() <= 64, "the cap holds: {}", excerpt.len());
    assert!(excerpt.starts_with("HEAD"), "the head is kept: {excerpt}");
    assert!(excerpt.ends_with("TAIL"), "the tail is kept: {excerpt}");
    assert!(
        excerpt.contains("truncated"),
        "the cut is marked: {excerpt}"
    );
}

#[test]
fn a_short_excerpt_is_left_alone() {
    assert_eq!(bounded("  a short reason  ", 64), "a short reason");
}

// --- The command ------------------------------------------------------------

#[test]
fn vitest_is_run_over_the_cases_project_with_the_json_reporter() {
    let command = vitest_command(
        Path::new("/tmp/tcab-vitest/report.json"),
        &["validation/color/ball.test.ts".to_string()],
    );
    assert!(
        command.contains("--config 'validation/vitest.config.ts'"),
        "the case's project is named, not the build's own: {command}",
    );
    assert!(
        command.contains("--reporter=json"),
        "the result is parsed rather than scraped: {command}",
    );
    assert!(
        command.contains("--outputFile='/tmp/tcab-vitest/report.json'"),
        "the report is written where the runner reads it: {command}",
    );
}

#[test]
fn the_declared_suites_are_named_to_vitest_after_its_options() {
    let command = vitest_command(
        Path::new("/tmp/tcab-vitest/report.json"),
        &[
            "validation/color/ball.test.ts".to_string(),
            "validation/gameplay/serve-initial.test.ts".to_string(),
        ],
    );
    assert!(
        command.ends_with(
            "'validation/color/ball.test.ts' 'validation/gameplay/serve-initial.test.ts'",
        ),
        "each filter is quoted and follows the options: {command}",
    );
}

#[test]
fn a_variant_is_filtered_to_its_own_suites_and_the_common_ones() {
    // The shape Carom has: a checklist every variant shares, plus a point only the
    // `gyre` variant declares, whose suite the staged directory carries either way.
    // The run is scoped by the checklist, so `base` must never name that suite.
    let common = vec![
        item("serve-initial", "gameplay/serve-initial.test.ts"),
        item("ball-color", "color/ball.test.ts"),
    ];
    let test_case = version(PathBuf::new(), common);

    let mut gyre = variant();
    gyre.slug = "gyre".to_string();
    gyre.review_items = vec![item("obstacles-sway", "gyre/obstacles-sway.test.ts")];

    let filters_for = |variant: &Variant| {
        let items = test_case.review_items_for(variant);
        let units = drive_units(&items);
        let suites: Vec<Suite> = units
            .iter()
            .map(|unit| Suite::of(unit, "simple-2d"))
            .collect();
        suite_filters(&suites)
    };

    assert_eq!(
        filters_for(&variant()),
        vec![
            "validation/gameplay/serve-initial.test.ts".to_string(),
            "validation/color/ball.test.ts".to_string(),
        ],
        "`base` names the common suites and nothing the staged directory holds for `gyre`",
    );
    assert_eq!(
        filters_for(&gyre),
        vec![
            "validation/gameplay/serve-initial.test.ts".to_string(),
            "validation/color/ball.test.ts".to_string(),
            "validation/gyre/obstacles-sway.test.ts".to_string(),
        ],
        "`gyre` names its own suite as well as the common ones",
    );
}

#[test]
fn a_suite_of_another_engine_contributes_no_filter() {
    // A declared path naming ANOTHER engine's validator leaves `Suite::file` unset:
    // there is nothing to point vitest at, and the suite is already reported as not
    // having run, so it must not widen the run to the whole staged directory either.
    let filters = suite_filters(&suites_for(&[(
        "ball-color",
        "validation/none/color/ball.test.ts",
    )]));
    assert!(
        filters.is_empty(),
        "a validator of another engine names no file in this run's tree: {filters:?}",
    );
}

// --- Reusing the prepared install -------------------------------------------

#[test]
fn a_tree_a_stage_already_installed_is_not_installed_again() {
    let repo = tempfile::tempdir().expect("a scratch tree");
    let prepared = crate::execution::PreparedInstall::completed(&crate::validation::StepResult {
        command: "npm ci".to_string(),
        succeeded: true,
        detail: None,
    });
    let artifacts = ArtifactCollection::new(repo.path().to_path_buf()).prepared_by(prepared);

    // `false` would fail if it were run; the tree is already prepared, so it is not.
    ensure_dependencies(repo.path(), &artifacts, "npm ci", VITEST_INSTALL_TIMEOUT)
        .expect("nothing is installed again");
}

#[test]
fn a_tree_nothing_prepared_is_installed_by_the_runner() {
    let repo = tempfile::tempdir().expect("a scratch tree");
    let artifacts = ArtifactCollection::new(repo.path().to_path_buf());

    let error = ensure_dependencies(repo.path(), &artifacts, "exit 7", VITEST_INSTALL_TIMEOUT)
        .expect_err("an install that fails leaves the tree unusable");
    assert!(
        error.reason.contains("exit 7") || error.reason.contains("did not succeed"),
        "the failure is reported as the install's: {}",
        error.reason,
    );
    assert_eq!(
        error.inconclusive,
        Inconclusive::NotRun,
        "an install the tree refused is a fact about the tree",
    );
}

// --- The media the suites produce -------------------------------------------

/// The directory a suite writes into, as the runner tells it to: the media root, then
/// the suite's own staged path.
/// Stand-in bytes for a recording a suite wrote: the first bytes of a gzip member
/// (RFC 1952 §2.3.1) and nothing more.
///
/// Collection moves what a suite left behind without ever reading it, so what these
/// tests need of the file is its name and its framing rather than a document. A
/// recording is written gzipped, and every consumer downstream of here reads it that
/// way, so the fixture is framed the way a real one is.
const GZIPPED_RECORDING: &[u8] = &[0x1f, 0x8b, 0x08, 0x00];

fn suite_media_dir(media_dir: &Path, staged: &str) -> PathBuf {
    let dir = media_dir.join(staged);
    std::fs::create_dir_all(&dir).expect("the suite's own media directory");
    dir
}

#[test]
fn a_suites_declared_media_is_flattened_out_of_the_directory_it_wrote_it_to() {
    // The whole collection contract in one run: the suite wrote each output under its
    // own id inside a directory named by its staged path, and the runner leaves the
    // flat `<verdict>__<output>.<ext>` names every consumer of validation media
    // addresses — with the scaffolding gone.
    let media = tempfile::tempdir().expect("a scratch media root");
    let items = vec![item_with_outputs(
        "no-tunnel",
        "validation/simple-2d/ball/no-tunnel.test.ts",
        vec![
            output("serve", MediaKind::Replay),
            output("rebound", MediaKind::Replay),
        ],
    )];
    let suite = suite_for(&items);
    let wrote = suite_media_dir(media.path(), "validation/ball/no-tunnel.test.ts");
    std::fs::write(wrote.join("serve.json.gz"), GZIPPED_RECORDING).expect("the first recording");
    std::fs::write(wrote.join("rebound.json.gz"), GZIPPED_RECORDING).expect("the second recording");

    let outputs = suite.collect_media(media.path());

    assert_eq!(outputs.len(), 2, "one entry per declared output, in order");
    assert_eq!(outputs[0].id, "serve");
    assert_eq!(outputs[0].kind, MediaKind::Replay);
    assert!(outputs[0].actual_present && outputs[1].actual_present);
    assert!(
        media.path().join("no-tunnel__serve.json.gz").is_file(),
        "the recording is keyed by the verdict it backs",
    );
    assert!(media.path().join("no-tunnel__rebound.json.gz").is_file());
    assert!(
        !media.path().join("validation").exists(),
        "the per-suite scaffolding is removed once its outputs are collected",
    );
}

#[test]
fn a_declared_output_the_suite_did_not_write_is_absent_rather_than_a_failure() {
    // Media is the evidence beside a verdict; the assertions are what decide the
    // point. A suite that passed every check while writing nothing still earns its
    // point, and the reviewer is told there is nothing to look at.
    let media = tempfile::tempdir().expect("a scratch media root");
    let items = vec![item_with_outputs(
        "serve-speed",
        "validation/simple-2d/gameplay/serve-speed.test.ts",
        vec![output("serve", MediaKind::Replay)],
    )];
    let suite = suite_for(&items);

    let repo = Path::new("/runs/impl");
    let reports = parse_report(&reporter_document(repo), repo).expect("the document parses");
    let mut result = suite.result(
        reports
            .iter()
            .find(|r| r.file == "validation/gameplay/serve-speed.test.ts"),
    );
    result.outputs = suite.collect_media(media.path());

    assert!(result.ran, "the suite ran");
    assert!(result.verdicts[0].pass, "and passed, media or no media");
    assert_eq!(
        result.outputs.len(),
        1,
        "the declared output is still named"
    );
    assert!(
        !result.outputs[0].actual_present,
        "it simply was not produced",
    );
}

#[test]
fn a_suite_that_never_ran_reports_its_declared_outputs_absent() {
    // Two ways to get here — a runner that could not execute at all, and a validator
    // belonging to another engine — and both must still name what the point declares,
    // so an empty list keeps meaning "this point declares no media".
    let media = tempfile::tempdir().expect("a scratch media root");
    let items = vec![item_with_outputs(
        "serve-speed",
        "validation/simple-2d/gameplay/serve-speed.test.ts",
        vec![output("serve", MediaKind::Replay)],
    )];
    let not_run = suite_for(&items).inconclusive("no vitest in the tree", Inconclusive::NotRun);
    assert_eq!(not_run.outputs.len(), 1);
    assert!(!not_run.outputs[0].actual_present);

    let elsewhere = vec![item_with_outputs(
        "ball-color",
        "validation/none/color/ball.test.ts",
        vec![output("title", MediaKind::Image)],
    )];
    let collected = suite_for(&elsewhere).collect_media(media.path());
    assert_eq!(collected.len(), 1);
    assert!(
        !collected[0].actual_present,
        "there was no staged suite to have written it",
    );
}

#[test]
fn collecting_one_suite_leaves_a_sibling_suites_directory_alone() {
    // The suites are collected one at a time and share the parents of their staged
    // paths. Pruning walks up only while it keeps emptying directories, so a sibling
    // that has not been collected yet still has somewhere to have written to.
    let media = tempfile::tempdir().expect("a scratch media root");
    let items = vec![
        item_with_outputs(
            "serve-speed",
            "validation/simple-2d/gameplay/serve-speed.test.ts",
            vec![output("serve", MediaKind::Replay)],
        ),
        item_with_outputs(
            "serve-initial",
            "validation/simple-2d/gameplay/serve-initial.test.ts",
            vec![output("first", MediaKind::Replay)],
        ),
    ];
    let suites: Vec<Suite> = drive_units(&items)
        .iter()
        .map(|unit| Suite::of(unit, "simple-2d"))
        .collect();
    let first = suite_media_dir(media.path(), "validation/gameplay/serve-speed.test.ts");
    let second = suite_media_dir(media.path(), "validation/gameplay/serve-initial.test.ts");
    std::fs::write(first.join("serve.json.gz"), GZIPPED_RECORDING).expect("the first recording");
    std::fs::write(second.join("first.json.gz"), GZIPPED_RECORDING).expect("the second recording");

    assert!(suites[0].collect_media(media.path())[0].actual_present);
    assert!(
        second.is_dir(),
        "the sibling's directory survives its neighbour's collection",
    );
    assert!(suites[1].collect_media(media.path())[0].actual_present);
    assert!(
        !media.path().join("validation").exists(),
        "the last one out removes the shared parents",
    );
    assert!(media.path().join("serve-speed__serve.json.gz").is_file());
    assert!(media.path().join("serve-initial__first.json.gz").is_file());
}

#[test]
fn the_media_directory_is_named_to_the_suites_in_the_environment() {
    // The one channel the runner has to code it never calls directly. A suite derives
    // its own staged path itself; where to put the result has to be handed to it.
    let scratch = tempfile::tempdir().expect("a scratch directory");
    let ran = run_bounded(
        scratch.path(),
        &format!("printf '%s' \"${VALIDATION_MEDIA_ENV}\""),
        Duration::from_secs(30),
        scratch.path(),
        "env",
        &[(
            VALIDATION_MEDIA_ENV,
            "/runs/impl/.vendor/validation".to_string(),
        )],
    )
    .expect("the command runs");

    assert_eq!(ran.stdout, "/runs/impl/.vendor/validation");
}

#[test]
fn the_exported_media_directory_is_absolute() {
    // A vitest project sets its own `root`, so a relative path would name one
    // directory to the runner and another to the suite.
    let media = tempfile::tempdir().expect("a scratch media root");
    assert!(
        Path::new(&absolute(&media.path().join(".vendor/validation"))).is_absolute(),
        "the suites are handed a path they cannot resolve differently",
    );
    assert!(Path::new(&absolute(Path::new("relative/media"))).is_absolute());
}

// --- Staging the shared harness ---------------------------------------------

/// A package store carrying `@clockwyrks/case-harness` with `src/` holding
/// `index.ts` and a `page/` subdirectory, returned with the temp dir that owns it.
fn package_store_with_case_harness() -> tempfile::TempDir {
    let store = tempfile::tempdir().expect("a scratch package store");
    let src = store.path().join(CASE_HARNESS_PACKAGE).join("src");
    std::fs::create_dir_all(src.join("page")).expect("the package's source tree");
    std::fs::write(src.join("index.ts"), "export const kit = 1;\n").expect("the barrel");
    std::fs::write(src.join("page/recorder-init.js"), "// recorder\n").expect("a page script");
    store
}

/// Point `package_store_dir` at `store` for the rest of this test's process.
///
/// Sound because nextest runs each test in its own process, so the variable cannot
/// leak into a test running beside this one.
fn use_package_store(store: &Path) {
    unsafe { std::env::set_var("TCAB_PACKAGE_STORE", store) };
}

#[test]
fn the_shared_harness_is_staged_beside_the_cases_own_project() {
    // The sibling placement is the whole contract: one import line has to resolve in
    // the case's `validation/<engine>/` in the checkout and in the staged
    // `validation/` here, which it only does if the package lands next to the case's
    // `harness.ts` rather than anywhere else.
    let store = package_store_with_case_harness();
    use_package_store(store.path());

    let project = tempfile::tempdir().expect("a scratch validator project");
    std::fs::write(project.path().join("harness.ts"), "// the case's own\n").expect("the harness");
    std::fs::create_dir_all(project.path().join("board")).expect("a suite directory");
    std::fs::write(project.path().join("board/beams.test.ts"), "// a suite\n").expect("a suite");

    let repo = tempfile::tempdir().expect("a scratch tree");
    let dest = repo.path().join(VALIDATION_SCRIPT_DIR);
    stage_project(project.path(), &dest).expect("the project stages");

    assert!(
        dest.join("harness.ts").is_file(),
        "the case's own files stage"
    );
    assert!(dest.join("board/beams.test.ts").is_file());
    assert!(
        dest.join(CASE_HARNESS_DIR).join("index.ts").is_file(),
        "the package's barrel is a sibling of the case's harness",
    );
    assert!(
        dest.join(CASE_HARNESS_DIR)
            .join("page/recorder-init.js")
            .is_file(),
        "the package's subdirectories stage with it",
    );
}

#[test]
fn only_the_packages_sources_are_staged() {
    // The package is staged as source for vitest to transpile, not installed: its
    // manifest and its own suite have no business in a case's validator project — and
    // a `*.test.ts` under it would be collected by every case's `validation/**` glob.
    let store = package_store_with_case_harness();
    use_package_store(store.path());
    let package = store.path().join(CASE_HARNESS_PACKAGE);
    std::fs::write(package.join("package.json"), "{}\n").expect("the manifest");
    std::fs::create_dir_all(package.join("test")).expect("the package's own suite");
    std::fs::write(package.join("test/replay.spec.ts"), "// spec\n").expect("a spec");

    let project = tempfile::tempdir().expect("a scratch validator project");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let dest = repo.path().join(VALIDATION_SCRIPT_DIR);
    stage_project(project.path(), &dest).expect("the project stages");

    let staged = dest.join(CASE_HARNESS_DIR);
    assert!(staged.join("index.ts").is_file());
    assert!(
        !staged.join("package.json").exists(),
        "only `src/` is staged, so nothing but source reaches the project",
    );
    assert!(!staged.join("test").exists());
}

#[test]
fn a_stale_copy_in_the_case_is_replaced_by_the_package() {
    // The package decides the case's points, so a case cannot shadow it with a copy of
    // its own that has drifted — whatever stands at that name is replaced wholesale.
    let store = package_store_with_case_harness();
    use_package_store(store.path());

    let project = tempfile::tempdir().expect("a scratch validator project");
    let stale = project.path().join(CASE_HARNESS_DIR);
    std::fs::create_dir_all(&stale).expect("the case's stale copy");
    std::fs::write(stale.join("index.ts"), "export const kit = 0;\n").expect("a stale barrel");
    std::fs::write(stale.join("gone.ts"), "// dropped\n").expect("a stale extra");

    let repo = tempfile::tempdir().expect("a scratch tree");
    let dest = repo.path().join(VALIDATION_SCRIPT_DIR);
    stage_project(project.path(), &dest).expect("the project stages");

    let staged = dest.join(CASE_HARNESS_DIR);
    assert_eq!(
        std::fs::read_to_string(staged.join("index.ts")).expect("the staged barrel"),
        "export const kit = 1;\n",
        "the store's copy wins over the one standing in the case",
    );
    assert!(
        !staged.join("gone.ts").exists(),
        "the stale copy is cleared rather than merged into",
    );
}

#[test]
fn a_host_with_no_staged_harness_is_a_runner_failure_that_names_both_fixes() {
    // Reported as a failure of the runner rather than of the build, which is what
    // leaves every point it backs for the reviewer. The message has to carry the two
    // ways out, because the store is a host fact no case can do anything about.
    let store = tempfile::tempdir().expect("an empty package store");
    use_package_store(store.path());

    let project = tempfile::tempdir().expect("a scratch validator project");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let message = stage_project(project.path(), &repo.path().join(VALIDATION_SCRIPT_DIR))
        .expect_err("an empty store cannot stage the harness");

    assert!(message.contains(CASE_HARNESS_PACKAGE), "{message}");
    assert!(
        message.contains(&store.path().display().to_string()),
        "{message}"
    );
    assert!(message.contains("stage-tcab-packages.mjs"), "{message}");
    assert!(message.contains("TCAB_PACKAGE_STORE"), "{message}");
}

#[test]
fn the_package_store_is_preferred_over_the_checkout() {
    // The store is what the driver image bakes and what `TCAB_PACKAGE_STORE` points
    // at, and it is the same store the seeder vendors engine runtimes out of — so a
    // run and its validators can never disagree about which sources they were built
    // from. The checkout is only the fallback for a `tcab` run out of the repository.
    let store = package_store_with_case_harness();
    use_package_store(store.path());

    assert_eq!(
        case_harness_source().expect("the store carries the package"),
        store.path().join(CASE_HARNESS_PACKAGE).join("src"),
    );
}

#[test]
fn a_store_without_the_package_falls_back_to_the_checkout() {
    // With neither a store nor a checkout under the current directory there is no
    // source at all, which is the case the error above reports. The candidates are
    // relative to the current directory, so this asserts the fallback is consulted
    // rather than that this test's own directory happens to be the repository root.
    let store = tempfile::tempdir().expect("an empty package store");
    use_package_store(store.path());

    assert_eq!(
        case_harness_source(),
        CASE_HARNESS_CANDIDATES
            .iter()
            .map(PathBuf::from)
            .find(|path| path.is_dir()),
    );
}

// --- The staged project's lifetime ------------------------------------------

/// A case root carrying a `simple-2d` validator project with one suite in it, and the
/// checklist that names that suite. The shape `run_vitest_suites` stages from.
fn case_with_a_project(root: &Path) -> TestCaseVersion {
    let project = root.join(VALIDATION_SCRIPT_DIR).join("simple-2d");
    std::fs::create_dir_all(project.join("gameplay")).expect("a scratch validator project");
    std::fs::write(project.join(VITEST_CONFIG_FILE), "export default {};").expect("the config");
    std::fs::write(project.join("gameplay/serve-speed.test.ts"), "// a suite\n").expect("a suite");
    version(
        root.to_path_buf(),
        vec![item(
            "serve-speed",
            "validation/simple-2d/gameplay/serve-speed.test.ts",
        )],
    )
}

/// Run the case's validators over `repo` with an install that succeeds and no vitest
/// in the tree, which is the shortest path that stages the project and then fails.
fn run_over(test_case: &TestCaseVersion, repo: &Path) -> Vec<DebugScriptResult> {
    run_vitest_suites(
        test_case,
        &variant(),
        engine().slug(),
        &ArtifactCollection::new(repo.to_path_buf()),
        "true",
        &repo.join(crate::validator::VALIDATION_MEDIA_DIR),
    )
}

#[test]
fn the_staged_project_is_taken_back_out_when_the_run_returns() {
    // The tree a run collects is published verbatim and the tree `tcab validate` is
    // pointed at is committed material, so the project the runner stages lives
    // exactly as long as the run that needs it — including a run that got no further
    // than finding no vitest to drive.
    let store = package_store_with_case_harness();
    use_package_store(store.path());
    let root = tempfile::tempdir().expect("a scratch case root");
    let test_case = case_with_a_project(root.path());
    let repo = tempfile::tempdir().expect("a scratch tree");

    let results = run_over(&test_case, repo.path());

    assert_eq!(results.len(), 1, "the declared point is still reported");
    assert!(!results[0].ran, "there was no vitest to run it with");
    assert!(
        results[0]
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains(VITEST_BIN),
        "the run got as far as staging the project and looking for vitest: {:?}",
        results[0].detail,
    );
    assert!(
        !repo.path().join(VALIDATION_SCRIPT_DIR).exists(),
        "the tree is left as validation found it",
    );
    assert!(
        !repo.path().join(DISPLACED_PROJECT_DIR).exists(),
        "nothing is held aside for a name that was free",
    );
}

#[test]
fn a_directory_the_build_authored_is_put_back() {
    // The staged project needs that one name for the length of the run. What stood
    // there is the build's own work, which the published tree and the reviewer both
    // have a claim on, so it is held aside and put back rather than replaced.
    let store = package_store_with_case_harness();
    use_package_store(store.path());
    let root = tempfile::tempdir().expect("a scratch case root");
    let test_case = case_with_a_project(root.path());
    let repo = tempfile::tempdir().expect("a scratch tree");
    let authored = repo.path().join(VALIDATION_SCRIPT_DIR);
    std::fs::create_dir_all(&authored).expect("the build's own directory");
    std::fs::write(authored.join("mine.ts"), "// the build's own\n").expect("the build's file");

    let results = run_over(&test_case, repo.path());

    assert!(
        results[0]
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains(VITEST_BIN),
        "the run got as far as staging over the build's directory: {:?}",
        results[0].detail,
    );
    assert_eq!(
        std::fs::read_to_string(authored.join("mine.ts")).expect("the build's file is back"),
        "// the build's own\n",
    );
    assert!(
        !authored.join("gameplay/serve-speed.test.ts").exists(),
        "the case's suites went out with the staged project",
    );
    assert!(
        !authored.join(CASE_HARNESS_DIR).exists(),
        "so did the shared harness staged beside them",
    );
    assert!(
        !repo.path().join(DISPLACED_PROJECT_DIR).exists(),
        "the holding directory is gone once what it held is back",
    );
}

#[test]
fn a_staging_that_could_not_finish_leaves_the_tree_as_it_found_it() {
    // The harness comes from the host rather than the case, so a host carrying
    // neither a store nor a checkout fails staging with the case's own files already
    // copied in. Those go too, and what stood at the name comes back.
    let store = tempfile::tempdir().expect("an empty package store");
    use_package_store(store.path());
    let project = tempfile::tempdir().expect("a scratch validator project");
    std::fs::write(project.path().join("harness.ts"), "// the case's own\n").expect("the harness");
    let repo = tempfile::tempdir().expect("a scratch tree");
    let authored = repo.path().join(VALIDATION_SCRIPT_DIR);
    std::fs::create_dir_all(&authored).expect("the build's own directory");
    std::fs::write(authored.join("mine.ts"), "// the build's own\n").expect("the build's file");

    let message = StagedProject::stage(project.path(), authored.clone())
        .err()
        .expect("an empty store and no checkout cannot stage the harness");

    assert!(message.contains(CASE_HARNESS_PACKAGE), "{message}");
    assert_eq!(
        std::fs::read_to_string(authored.join("mine.ts")).expect("the build's file is back"),
        "// the build's own\n",
    );
    assert!(
        !authored.join("harness.ts").exists(),
        "the case's files the staging did copy went back out with it",
    );
}

#[test]
fn a_holding_directory_an_earlier_run_left_behind_is_cleared() {
    // A validation run killed part way through can leave the holding directory on
    // disk. What the tree carries now is the only copy worth putting back, so the
    // stale one goes rather than standing in the way of the displacement.
    let repo = tempfile::tempdir().expect("a scratch tree");
    let stale = repo.path().join(DISPLACED_PROJECT_DIR);
    std::fs::create_dir_all(&stale).expect("the stale holding directory");
    std::fs::write(stale.join("stale.ts"), "// an earlier run\n").expect("a stale file");
    let at = repo.path().join(VALIDATION_SCRIPT_DIR);
    std::fs::create_dir_all(&at).expect("the build's own directory");
    std::fs::write(at.join("mine.ts"), "// the build's own\n").expect("the build's file");

    let held = displace(&at)
        .expect("the displacement succeeds")
        .expect("the name was taken, so something was held aside");

    assert_eq!(held, stale);
    assert!(held.join("mine.ts").is_file(), "what the tree carries now");
    assert!(!held.join("stale.ts").exists(), "and nothing older");
}

#[test]
fn a_point_scoped_away_from_the_run_s_engine_names_no_suite() {
    // A validator restricted to the engineless build decides nothing on an
    // engine-backed run: the point leaves the checklist, so no filter names its
    // suite and no result is reported for it.
    let mut overlay = item("debug-overlay", "hud/overlay.test.ts");
    overlay.validation = Some(ReviewValidation {
        engines: vec![crate::engine::NONE_SLUG.to_string()],
        ..validation("hud/overlay.test.ts")
    });
    let test_case = version(
        PathBuf::new(),
        vec![
            item("serve-initial", "gameplay/serve-initial.test.ts"),
            overlay,
        ],
    );

    let filters_for = |engine: &str| {
        let items = test_case.review_items_for_engine(&variant(), engine);
        let units = drive_units(&items);
        let suites: Vec<Suite> = units.iter().map(|unit| Suite::of(unit, engine)).collect();
        suite_filters(&suites)
    };

    assert_eq!(
        filters_for(crate::engine::NONE_SLUG),
        vec![
            "validation/gameplay/serve-initial.test.ts".to_string(),
            "validation/hud/overlay.test.ts".to_string(),
        ],
    );
    assert_eq!(
        filters_for("simple-2d"),
        vec!["validation/gameplay/serve-initial.test.ts".to_string()],
        "the engine-backed run never names the suite that decides a point it does not carry",
    );
}
