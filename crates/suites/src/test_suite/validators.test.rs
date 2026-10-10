//! Tests for the suite validator runner, driven by the committed fixture suite at
//! `crates/contracts/fixtures/test-suite/carom/versions/v1.0.0/`.
//!
//! The fixture's `end-to-end` definition covers `ball-physics` (a requirement
//! claiming three validators, one claiming a single validator, and one
//! non-functional) and the nested `ball-spin` (one requirement, one validator),
//! while leaving the `assets` specification out — which is exactly the shape every
//! rule in this module has to be proven against.
//!
//! Vitest itself is stood in for by an executable on the produced tree's
//! `node_modules/.bin` that copies a prepared reporter document to the `--outputFile`
//! it was handed and records the environment the runner named it. Everything from the
//! command line outwards is therefore the real path: the project is really staged, the
//! build is really served, the process is really run under its cap, and the document
//! is really parsed.

use crate::test_engines::fixture_catalog;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::*;
use crate::test_suite::TestSuiteCatalog;

/// The committed fixture checkout — the directory holding the `carom/` suite.
fn checkout() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// Resolve the fixture's `end-to-end` definition, which is the suite-defined case
/// every test here runs.
fn end_to_end(materials: &Path) -> TestCaseVersion {
    TestSuiteCatalog::with_materials(checkout(), materials)
        .resolve_with("carom", "v1.0.0", "end-to-end", &fixture_catalog())
        .expect("the fixture definition resolves")
}

/// A scratch directory for one test.
fn scratch() -> tempfile::TempDir {
    tempfile::tempdir().expect("a temporary directory")
}

/// One reported test within a file: its title, whether it passed, and the failure
/// message vitest carried for it.
struct Reported<'a> {
    title: &'a str,
    status: &'a str,
    failure: Option<&'a str>,
}

/// A passing reported test.
fn passed(title: &str) -> Reported<'_> {
    Reported {
        title,
        status: "passed",
        failure: None,
    }
}

/// A failing reported test carrying the detail the validator supplied.
#[cfg(unix)]
fn failed<'a>(title: &'a str, detail: &'a str) -> Reported<'a> {
    Reported {
        title,
        status: "failed",
        failure: Some(detail),
    }
}

/// A vitest JSON reporter document over the named staged files, each with its tests
/// and its optional file-level message (what vitest reports for a file that raised
/// before running anything).
fn document(repo: &Path, files: &[(&str, Option<&str>, Vec<Reported<'_>>)]) -> String {
    let results: Vec<serde_json::Value> = files
        .iter()
        .map(|(name, message, tests)| {
            serde_json::json!({
                "name": repo.join(name).to_string_lossy().replace('\\', "/"),
                "status": "passed",
                "message": message.unwrap_or(""),
                "assertionResults": tests
                    .iter()
                    .map(|test| serde_json::json!({
                        "ancestorTitles": [],
                        "fullName": test.title,
                        "title": test.title,
                        "status": test.status,
                        "failureMessages": test.failure.map(|f| vec![f]).unwrap_or_default(),
                    }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect();
    serde_json::json!({ "success": true, "testResults": results }).to_string()
}

/// The reporter document a conforming implementation earns: every validator the
/// fixture's covered specifications claim reports one passing assertion.
fn every_validator_passes(repo: &Path) -> String {
    document(
        repo,
        &[
            (
                "validators/ball/constant-speed.test.ts",
                None,
                vec![passed("speed is unchanged after 60 ticks")],
            ),
            (
                "validators/ball/constant-speed-after-cushion.test.ts",
                None,
                vec![passed("speed is unchanged across a cushion")],
            ),
            (
                "validators/ball/constant-speed-after-pocket-rim.test.ts",
                None,
                vec![passed("speed is unchanged across a pocket rim")],
            ),
            (
                "validators/ball/cushion-reflection.test.ts",
                None,
                vec![passed("the angle out matches the angle in")],
            ),
            (
                "validators/ball/spin-decay.test.ts",
                None,
                vec![passed("spin reaches zero")],
            ),
        ],
    )
}

/// A produced tree standing in for one a run collected: a served build and a fake
/// vitest that hands back whatever document the test prepared.
struct Produced {
    /// The scratch directory holding the tree.
    _dir: tempfile::TempDir,
    /// The collected tree itself.
    repo: PathBuf,
    /// The static build the validators are run against.
    output: PathBuf,
}

/// The file the fake vitest copies to the `--outputFile` it was handed.
const PREPARED_REPORT: &str = "report-source.json";

/// What the fake vitest does once it has resolved `$out` (the `--outputFile` it was
/// handed), `$report` (the prepared document) and `$repo` (the tree): hand back the
/// document and record what the runner named it.
const RECORDING_VITEST: &str = "cp \"$report\" \"$out\"\n\
     printf '%s' \"$TCAB_VALIDATOR_BASE_URL\" > \"$repo/base-url\"\n\
     printf '%s' \"$TCAB_DEBUG_API_HANDLE\" > \"$repo/debug-handle\"\n\
     printf '%s' \"$*\" > \"$repo/argv\"\n";

impl Produced {
    /// A tree whose vitest records the environment and arguments it was run with.
    fn new() -> Self {
        Self::with_bin(RECORDING_VITEST)
    }

    /// A tree whose vitest runs `body`.
    fn with_bin(body: &str) -> Self {
        let dir = scratch();
        let repo = dir.path().join("impl");
        let bin = repo.join("node_modules/.bin");
        std::fs::create_dir_all(&bin).expect("the tree's bin directory");
        let output = repo.join("dist");
        std::fs::create_dir_all(&output).expect("the build output");
        std::fs::write(output.join("index.html"), "<!doctype html>\n").expect("the build");
        let script = format!(
            "#!/bin/sh\nrepo='{repo}'\nreport='{repo}/{PREPARED_REPORT}'\nout=''\n\
             for arg in \"$@\"; do\n  case \"$arg\" in --outputFile=*) \
             out=\"${{arg#--outputFile=}}\" ;; esac\ndone\n{body}",
            repo = repo.display(),
        );
        let vitest = bin.join("vitest");
        std::fs::write(&vitest, script).expect("the fake vitest");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&vitest, std::fs::Permissions::from_mode(0o755))
                .expect("the fake vitest is executable");
        }
        Self {
            _dir: dir,
            repo,
            output,
        }
    }

    /// Prepare the reporter document this tree's vitest hands back, built over the
    /// tree's own paths because that is what vitest reports.
    fn reporting(self, document: impl Fn(&Path) -> String) -> Self {
        std::fs::write(self.repo.join(PREPARED_REPORT), document(&self.repo))
            .expect("the prepared report");
        self
    }

    /// The collection a validator is handed for this tree.
    fn artifacts(&self) -> ArtifactCollection {
        ArtifactCollection::new(self.repo.clone())
    }

    /// What the fake vitest recorded under `name`.
    #[cfg(unix)]
    fn recorded(&self, name: &str) -> String {
        std::fs::read_to_string(self.repo.join(name))
            .unwrap_or_else(|err| panic!("the runner recorded `{name}`: {err}"))
    }

    /// Run the suite's validators over this tree. The install command is never run:
    /// the tree already carries a `node_modules`.
    fn run(&self, test_case: &TestCaseVersion) -> Vec<RequirementOutcome> {
        run_suite_validators(test_case, &self.artifacts(), &self.output, "npm ci")
    }
}

/// The outcome of one requirement, by its suite-wide identity.
fn outcome<'a>(outcomes: &'a [RequirementOutcome], id: &str) -> &'a RequirementOutcome {
    outcomes
        .iter()
        .find(|outcome| outcome.id == id)
        .unwrap_or_else(|| panic!("`{id}` is recorded: {outcomes:#?}"))
}

// --- What is recorded -------------------------------------------------------

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn a_conforming_implementation_passes_every_requirement_its_validators_decide() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    let outcomes = tree.run(&test_case);

    for id in [
        "ball-physics/constant-speed",
        "ball-physics/cushion-reflection",
        "ball-spin/spin-decay",
    ] {
        let recorded = outcome(&outcomes, id);
        assert_eq!(
            recorded.status,
            RequirementStatus::Passed,
            "{id} passes: {recorded:#?}",
        );
        assert_eq!(recorded.kind, SuiteRequirementKind::Functional);
        assert!(
            recorded.assertions.iter().all(|assertion| assertion.passed),
            "every assertion behind {id} passed",
        );
    }
}

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn an_outcome_is_keyed_by_its_identity_and_names_the_validators_that_decided_it() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    let outcomes = tree.run(&test_case);

    let constant_speed = outcome(&outcomes, "ball-physics/constant-speed");
    assert_eq!(constant_speed.specification, "ball-physics");
    assert_eq!(constant_speed.requirement, "constant-speed");
    assert_eq!(
        constant_speed.validators,
        vec![
            "ball/constant-speed.ts".to_string(),
            "ball/constant-speed-after-cushion.ts".to_string(),
            "ball/constant-speed-after-pocket-rim.ts".to_string(),
        ],
        "the paths the claiming requirement lists, in the order it lists them",
    );
    assert_eq!(
        constant_speed.assertions.len(),
        3,
        "one per validator it claims: {constant_speed:#?}",
    );
}

#[test]
fn only_the_requirements_of_the_selected_specifications_are_recorded() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    let outcomes = tree.run(&test_case);

    let ids: Vec<&str> = outcomes.iter().map(|outcome| outcome.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "ball-physics/constant-speed",
            "ball-physics/cushion-reflection",
            "ball-physics/table-felt",
            "ball-spin/spin-decay",
        ],
        "the definition covers `ball-physics` and `ball-spin` and not `assets`",
    );
}

#[test]
fn a_non_functional_requirement_records_no_validator_outcome() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    let outcomes = tree.run(&test_case);

    let felt = outcome(&outcomes, "ball-physics/table-felt");
    assert_eq!(felt.kind, SuiteRequirementKind::NonFunctional);
    assert_eq!(
        felt.status,
        RequirementStatus::Undecided,
        "review decides it, so no validator did",
    );
    assert!(felt.validators.is_empty());
    assert!(felt.assertions.is_empty());
    assert_eq!(felt.detail.as_deref(), Some(REVIEWED_DETAIL));
}

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn a_failing_validator_fails_exactly_the_requirement_claiming_it() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(|repo| {
        document(
            repo,
            &[
                (
                    "validators/ball/constant-speed.test.ts",
                    None,
                    vec![passed("speed is unchanged after 60 ticks")],
                ),
                (
                    "validators/ball/constant-speed-after-cushion.test.ts",
                    None,
                    vec![failed(
                        "speed is unchanged across a cushion",
                        "Error: Expected: 4\nActual: 3.2",
                    )],
                ),
                (
                    "validators/ball/constant-speed-after-pocket-rim.test.ts",
                    None,
                    vec![passed("speed is unchanged across a pocket rim")],
                ),
                (
                    "validators/ball/cushion-reflection.test.ts",
                    None,
                    vec![passed("the angle out matches the angle in")],
                ),
                (
                    "validators/ball/spin-decay.test.ts",
                    None,
                    vec![passed("spin reaches zero")],
                ),
            ],
        )
    });
    let outcomes = tree.run(&test_case);

    assert_eq!(
        outcome(&outcomes, "ball-physics/constant-speed").status,
        RequirementStatus::Failed,
        "the requirement claiming the failing validator fails",
    );
    assert_eq!(
        outcome(&outcomes, "ball-physics/cushion-reflection").status,
        RequirementStatus::Passed,
        "and no other requirement is touched by it",
    );
    assert_eq!(
        outcome(&outcomes, "ball-spin/spin-decay").status,
        RequirementStatus::Passed,
    );
}

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn each_assertion_is_recorded_with_its_name_its_flag_and_its_detail() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(|repo| {
        document(
            repo,
            &[(
                "validators/ball/cushion-reflection.test.ts",
                None,
                vec![
                    passed("the ball leaves the cushion"),
                    failed(
                        "the angle out matches the angle in",
                        "the ball left at 41 degrees having arrived at 38",
                    ),
                ],
            )],
        )
    });
    let outcomes = tree.run(&test_case);

    let reflection = outcome(&outcomes, "ball-physics/cushion-reflection");
    assert_eq!(reflection.status, RequirementStatus::Failed);
    assert_eq!(
        reflection.assertions,
        vec![
            RequirementAssertion {
                name: "the ball leaves the cushion".to_string(),
                passed: true,
                detail: None,
            },
            RequirementAssertion {
                name: "the angle out matches the angle in".to_string(),
                passed: false,
                detail: Some("the ball left at 41 degrees having arrived at 38".to_string()),
            },
        ],
        "every condition that ran is kept, not just the verdict",
    );
}

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn a_validator_that_raised_fails_its_requirement_and_leaves_the_run_standing() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(|repo| {
        document(
            repo,
            &[
                (
                    "validators/ball/spin-decay.test.ts",
                    Some("TypeError: __carom.ball.spin is undefined"),
                    Vec::new(),
                ),
                (
                    "validators/ball/cushion-reflection.test.ts",
                    None,
                    vec![passed("the angle out matches the angle in")],
                ),
            ],
        )
    });
    let outcomes = tree.run(&test_case);

    let spin = outcome(&outcomes, "ball-spin/spin-decay");
    assert_eq!(spin.status, RequirementStatus::Failed);
    assert!(spin.assertions.is_empty(), "it returned no assertion");
    assert!(
        spin.detail
            .as_deref()
            .unwrap_or_default()
            .contains("__carom.ball.spin is undefined"),
        "what it raised is recorded: {:?}",
        spin.detail,
    );
    assert_eq!(
        outcome(&outcomes, "ball-physics/cushion-reflection").status,
        RequirementStatus::Passed,
        "the rest of the run stands",
    );
}

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn a_claimed_validator_the_project_reported_nothing_for_fails_its_requirement() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(|repo| {
        document(
            repo,
            &[(
                "validators/ball/cushion-reflection.test.ts",
                None,
                vec![passed("the angle out matches the angle in")],
            )],
        )
    });
    let outcomes = tree.run(&test_case);

    let constant_speed = outcome(&outcomes, "ball-physics/constant-speed");
    assert_eq!(constant_speed.status, RequirementStatus::Failed);
    assert!(
        constant_speed
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("ball/constant-speed.ts"),
        "the validator nothing was reported for is named: {:?}",
        constant_speed.detail,
    );
}

// --- Reaching the served build ----------------------------------------------

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn the_base_url_and_the_debug_api_handle_are_named_to_the_project() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    tree.run(&test_case);

    let base = tree.recorded("base-url");
    assert!(
        base.starts_with("http://127.0.0.1:"),
        "the served build's base URL is named: {base}",
    );
    assert!(base.ends_with('/'), "and it is a base, not a page: {base}");
    assert_eq!(
        tree.recorded("debug-handle"),
        "__carom",
        "the handle the suite's `debug-api.toml` declares, not a literal in the project",
    );
}

#[test]
fn the_project_is_run_with_the_json_reporter_against_its_own_config() {
    let command = vitest_command(
        Path::new("/tmp/tcab-suite-validators/report.json"),
        &["validators/ball/spin-decay.test.ts".to_string()],
    );
    assert!(
        command.contains("--config 'validators/vitest.config.ts'"),
        "the suite's project is named, not the implementation's own: {command}",
    );
    assert!(command.contains("--reporter=json"), "{command}");
    assert!(
        command.contains("--outputFile='/tmp/tcab-suite-validators/report.json'"),
        "{command}",
    );
    assert!(
        command.ends_with("'validators/ball/spin-decay.test.ts'"),
        "the filters follow the options: {command}",
    );
}

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn only_the_claimed_validators_are_named_to_vitest() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    tree.run(&test_case);

    let argv = tree.recorded("argv");
    for claimed in [
        "validators/ball/constant-speed.test.ts",
        "validators/ball/constant-speed-after-cushion.test.ts",
        "validators/ball/constant-speed-after-pocket-rim.test.ts",
        "validators/ball/cushion-reflection.test.ts",
        "validators/ball/spin-decay.test.ts",
    ] {
        assert!(argv.contains(claimed), "{claimed} is run: {argv}");
    }
}

#[test]
fn a_reported_test_file_maps_back_to_the_module_a_requirement_claims() {
    assert_eq!(
        module_of("validators/ball/constant-speed.test.ts").as_deref(),
        Some("ball/constant-speed.ts"),
    );
    assert_eq!(
        staged_test_file("ball/constant-speed.ts"),
        "validators/ball/constant-speed.test.ts",
    );
    assert_eq!(
        module_of("validators/vitest.config.ts"),
        None,
        "the project's own configuration drives no validator",
    );
    assert_eq!(
        module_of("dist/ball.test.ts"),
        None,
        "and neither does anything outside the staged project",
    );
}

// --- The project is staged and taken back out -------------------------------

// Needs the fake vitest to run, which is a `sh` script (see `Produced`).
#[cfg(unix)]
#[test]
fn the_project_is_staged_for_the_run_and_removed_again() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::with_bin(
        "cp \"$report\" \"$out\"\nls \"$repo/validators/ball\" > \"$repo/staged-listing\"\n",
    )
    .reporting(every_validator_passes);
    let outcomes = tree.run(&test_case);

    assert!(!outcomes.is_empty(), "the run reported something");
    let listing = tree.recorded("staged-listing");
    assert!(
        listing.contains("constant-speed.ts") && listing.contains("constant-speed.test.ts"),
        "the suite's validator project is staged while it runs: {listing}",
    );
    assert!(
        !tree.repo.join("validators").exists(),
        "and it is taken back out again, so the collected tree is published as the model left it",
    );
}

#[test]
fn a_directory_the_tree_already_carried_is_put_back() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let tree = Produced::new().reporting(every_validator_passes);
    let own = tree.repo.join("validators");
    std::fs::create_dir_all(&own).expect("the tree's own directory");
    std::fs::write(own.join("mine.ts"), "// the model's own\n").expect("the tree's own file");

    tree.run(&test_case);

    assert_eq!(
        std::fs::read_to_string(own.join("mine.ts")).expect("the tree's own file survives"),
        "// the model's own\n",
    );
}

// --- Nothing to run ---------------------------------------------------------

#[test]
fn an_authored_test_case_records_no_requirement_outcome() {
    let tree = Produced::new().reporting(every_validator_passes);
    let materials = scratch();
    let root = scratch();
    let mut test_case = end_to_end(materials.path());
    // An authored case's version folder holds a `manifest.toml` and never a
    // `suite.toml`, so nothing here is suite-defined and the case path decides it.
    test_case.root = root.path().to_path_buf();

    assert!(tree.run(&test_case).is_empty());
}

#[test]
fn a_run_stopped_at_its_cap_leaves_every_requirement_undecided() {
    // The one budget a test can expire in milliseconds is the install's, and it is
    // bounded by the same `run_bounded` the project run is, so what it proves about
    // the cap holds for both: a host too slow to finish inside the budget decides
    // nothing.
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let dir = scratch();
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("the tree");
    let output = repo.join("dist");
    std::fs::create_dir_all(&output).expect("the build output");
    let artifacts = ArtifactCollection::new(repo.clone());

    let outcomes = run_suite_validators_bounded(
        &test_case,
        &artifacts,
        &output,
        "sleep 30",
        Caps {
            suite: Duration::from_millis(300),
            install: Duration::from_millis(300),
        },
    );

    for id in [
        "ball-physics/constant-speed",
        "ball-physics/cushion-reflection",
        "ball-spin/spin-decay",
    ] {
        let recorded = outcome(&outcomes, id);
        assert_eq!(
            recorded.status,
            RequirementStatus::Undecided,
            "{id} is undecided, not failed: {recorded:#?}",
        );
        assert!(
            recorded
                .detail
                .as_deref()
                .unwrap_or_default()
                .contains("cap"),
            "the reason is recorded: {:?}",
            recorded.detail,
        );
    }
    assert!(
        !repo.join("validators").exists(),
        "a run the runner abandoned still leaves the tree as it found it",
    );
}

#[test]
fn a_tree_with_no_vitest_leaves_every_requirement_undecided() {
    let materials = scratch();
    let test_case = end_to_end(materials.path());
    let dir = scratch();
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(repo.join("node_modules")).expect("an installed tree with no vitest");
    let output = repo.join("dist");
    std::fs::create_dir_all(&output).expect("the build output");
    let artifacts = ArtifactCollection::new(repo.clone());

    let outcomes = run_suite_validators(&test_case, &artifacts, &output, "npm ci");

    let constant_speed = outcome(&outcomes, "ball-physics/constant-speed");
    assert_eq!(constant_speed.status, RequirementStatus::Undecided);
    assert!(constant_speed.assertions.is_empty());
    assert!(
        constant_speed
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("vitest"),
        "the reason is recorded: {:?}",
        constant_speed.detail,
    );
}
