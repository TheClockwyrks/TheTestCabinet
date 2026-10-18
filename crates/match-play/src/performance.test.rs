//! Tests for the per-case performance runner.
//!
//! Each submission is assembled from inline WebAssembly text with `wat`, as
//! `lattice-host`'s submission tests do: a tiny engine that echoes a baked `state`
//! JSON is correct when the JSON is the oracle's answer and wrong when it is not,
//! so the real host, oracle and scoring rule are exercised without compiling a
//! reference engine.

use std::path::{Path, PathBuf};

use lattice_core::{Engine, Scenario};
use test_cabinet_contracts::engine::NONE_SLUG;
use test_cabinet_contracts::test_case::{
    AssetDimension, AssetKind, BuildCommands, ContractSpec, EngineSupport, PerformanceCase,
    SandboxSpec, TestCaseVersion, TestType,
};
use test_cabinet_contracts::validation::PerformanceCaseKind;

use super::*;

/// A source feeding a fast belt into a sink, long enough that items flow.
const SCENARIO_JSON: &str = r#"{
  "version": 1,
  "grid": { "width": 8, "height": 4 },
  "ticks": 200,
  "snapshots": [100, 200],
  "entities": [
    { "type": "source", "x": 1, "y": 1, "dir": "E", "item": "iron-ore", "lane": "both", "period": 4 },
    { "type": "belt",   "x": 2, "y": 1, "dir": "E", "tier": "fast" },
    { "type": "belt",   "x": 3, "y": 1, "dir": "E", "tier": "fast" },
    { "type": "sink",   "x": 4, "y": 1, "dir": "W" }
  ]
}"#;

/// The byte offset the baked `state` JSON lives at, past the region `alloc` hands
/// the host to write the scenario into.
const STATE_OFFSET: u32 = 65_536;

/// The pass line every case below is judged against.
const PASS_LIMIT: u64 = 5_000_000_000;

/// An engine that ignores its input and returns `state_json` verbatim.
fn echo_engine(state_json: &str) -> Vec<u8> {
    let bytes = state_json.as_bytes();
    let packed = ((STATE_OFFSET as i64) << 32) | (bytes.len() as i64);
    let escaped: String = bytes.iter().map(|b| format!("\\{b:02x}")).collect();
    let wat = format!(
        r#"(module
  (memory (export "memory") 4)
  (data (i32.const {STATE_OFFSET}) "{escaped}")
  (func (export "alloc") (param $len i32) (result i32) (i32.const 1024))
  (func (export "simulate") (param $ptr i32) (param $len i32) (result i64)
    (i64.const {packed})))"#,
    );
    wat::parse_str(wat).expect("the echo engine assembles")
}

/// The oracle's answer for [`SCENARIO_JSON`], as the JSON array an engine returns.
fn expected_json() -> String {
    let scenario = Scenario::parse(SCENARIO_JSON.as_bytes()).expect("scenario parses");
    serde_json::to_string(&Engine::solve(&scenario)).expect("expected serializes")
}

/// A minimal performance version rooted at `root`.
fn version(root: PathBuf) -> TestCaseVersion {
    TestCaseVersion {
        toolchain: None,
        instrumentation: None,
        slug: "performance-factorio".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        engine_format: false,
        name: "Lattice".to_string(),
        difficulty: "hard".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: PathBuf::new(),
        root,
        prompt_path: PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 3600,
        test_type: TestType::Performance,
        build: Some(BuildCommands {
            install: "cargo fetch".to_string(),
            build: "cargo build".to_string(),
            module: Some(PathBuf::from("engine.wasm")),
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: Some(ContractSpec {
            entry: "simulate".to_string(),
            world: None,
            action: None,
            input: Some(PathBuf::from("schemas/scenario.json")),
            output: Some(PathBuf::from("schemas/state.json")),
        }),
        sandbox: Some(SandboxSpec {
            fuel_per_tick: None,
            fuel_limit: Some(PASS_LIMIT),
            max_memory_bytes: 268_435_456,
        }),
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
        engines: vec![EngineSupport::unbounded(NONE_SLUG)],
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

/// Stage `cases/c.{json,out}` under `root` and return the case pointing at them.
fn stage(root: &Path, expected: &str, kind: PerformanceCaseKind) -> PerformanceCase {
    let dir = root.join("cases");
    std::fs::create_dir_all(&dir).expect("cases dir");
    std::fs::write(dir.join("c.json"), SCENARIO_JSON).expect("input");
    std::fs::write(dir.join("c.out"), expected).expect("expected");
    PerformanceCase {
        input: dir.join("c.json"),
        expected: dir.join("c.out"),
        fuel_ceiling: PASS_LIMIT,
        kind,
    }
}

fn limits() -> SandboxLimits {
    SandboxLimits {
        fuel_limit: PASS_LIMIT,
        max_memory_bytes: 268_435_456,
    }
}

#[test]
fn a_correct_engine_passes_and_hands_back_its_state_and_scenario() {
    let root = tempfile::tempdir().expect("tempdir");
    let expected = expected_json();
    let case = stage(root.path(), &expected, PerformanceCaseKind::Stress);
    let version = version(root.path().to_path_buf());

    let run = run_case(
        &version,
        &echo_engine(&expected),
        limits(),
        "simulate",
        &case,
    );

    assert!(run.result.correct, "{:?}", run.result.detail);
    assert_eq!(run.result.input, "cases/c.json");
    assert!(run.result.fuel.is_some());
    assert_eq!(run.result.snapshots.len(), 2);
    assert_eq!(
        run.result.scenario_json, None,
        "the caller names the scenario"
    );
    assert_eq!(run.produced.map(|s| s.len()), Some(2));
    assert_eq!(run.scenario.as_deref(), Some(SCENARIO_JSON.as_bytes()));
}

#[test]
fn a_wrong_answer_records_its_state_but_no_scenario() {
    let root = tempfile::tempdir().expect("tempdir");
    let expected = expected_json();
    let case = stage(root.path(), &expected, PerformanceCaseKind::Stress);
    let version = version(root.path().to_path_buf());
    let scenario = Scenario::parse(SCENARIO_JSON.as_bytes()).expect("scenario parses");
    let mut snapshots = Engine::solve(&scenario);
    snapshots[0].checksum = "fnv1a64:0000000000000000".to_string();
    let wrong = serde_json::to_string(&snapshots).expect("wrong serializes");

    let run = run_case(&version, &echo_engine(&wrong), limits(), "simulate", &case);

    assert!(!run.result.correct);
    assert!(run.result.fuel.is_some(), "a wrong but runnable engine ran");
    assert!(run.produced.is_some());
    assert!(run.scenario.is_none());
}

#[test]
fn a_correct_stress_answer_over_the_pass_line_is_over_the_ceiling() {
    let root = tempfile::tempdir().expect("tempdir");
    let expected = expected_json();
    let case = stage(root.path(), &expected, PerformanceCaseKind::Stress);
    let version = version(root.path().to_path_buf());
    // A pass line below anything an engine burns, with the run ceiling left wide.
    let tight = SandboxLimits {
        fuel_limit: 0,
        ..limits()
    };

    let run = run_case(&version, &echo_engine(&expected), tight, "simulate", &case);

    assert!(run.result.over_ceiling);
    assert!(!run.result.correct);
    assert!(run.scenario.is_some(), "a correct answer earns playback");

    // A smoke case does not score fuel, so the same answer passes.
    let smoke = PerformanceCase {
        kind: PerformanceCaseKind::Smoke,
        ..case
    };
    let run = run_case(&version, &echo_engine(&expected), tight, "simulate", &smoke);
    assert!(run.result.correct);
    assert!(!run.result.over_ceiling);
}

#[test]
fn an_unloadable_engine_records_no_fuel() {
    let root = tempfile::tempdir().expect("tempdir");
    let case = stage(root.path(), &expected_json(), PerformanceCaseKind::Stress);
    let version = version(root.path().to_path_buf());

    let run = run_case(&version, b"\0not-wasm", limits(), "simulate", &case);

    assert_eq!(run.result.fuel, None);
    let detail = run.result.detail.expect("a reason");
    assert!(detail.starts_with("the engine failed to load"), "{detail}");
    assert!(run.produced.is_none() && run.scenario.is_none());
}

#[test]
fn a_missing_case_file_is_a_case_authoring_failure() {
    let root = tempfile::tempdir().expect("tempdir");
    let mut case = stage(root.path(), &expected_json(), PerformanceCaseKind::Smoke);
    case.expected = root.path().join("cases/missing.out");
    let version = version(root.path().to_path_buf());

    let run = run_case(&version, &echo_engine("[]"), limits(), "simulate", &case);

    assert_eq!(run.result.fuel, None);
    let detail = run.result.detail.expect("a reason");
    assert!(
        detail.starts_with("could not read expected answer"),
        "{detail}"
    );
    assert_eq!(run.result.kind, PerformanceCaseKind::Smoke);
}

#[test]
fn a_skipped_case_is_a_stress_failure_that_never_ran() {
    let result = skipped_case("cases/c.json".to_string());
    assert!(result.skipped && !result.correct);
    assert_eq!(result.kind, PerformanceCaseKind::Stress);
    assert_eq!(result.fuel, None);
}

#[test]
fn an_exhausted_runway_names_the_runway() {
    let err = RunError::Invoke(InvokeError::OutOfFuel { limit: 10 });
    let detail = run_failure_detail(&err, 5, 10);
    assert!(
        detail.contains("exhausted its runway (10 fuel, 2x the 5 ceiling)"),
        "{detail}"
    );
    assert_eq!(
        run_failure_detail(&err, 10, 10),
        "the engine exhausted the 10 fuel ceiling before finishing"
    );
}
