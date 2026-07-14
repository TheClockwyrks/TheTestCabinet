//! Tests for the performance validator's scoring paths.
//!
//! Running a real engine requires a wasm module, but compiling the reference
//! engine crates here would be slow and circular, so — mirroring
//! [`lattice-host`'s submission tests](../../lattice-host/src/submission.test.rs) —
//! each submission is assembled from inline WebAssembly text with `wat`. A tiny
//! engine that *echoes a baked `state` JSON* is the whole trick: the oracle
//! ([`lattice_core::Engine`]) computes the expected answer at test time, we bake it
//! (or a corrupted copy) into the module's data segment, and the validator's
//! checksum gate then judges it correct or incorrect exactly as it would a real
//! engine. This keeps the test self-contained, fast, and deterministic while still
//! exercising the real host, the real oracle, and the real scoring rule.

use std::path::PathBuf;

use lattice_core::{Engine, Scenario, Snapshot};

use super::PerformanceValidator;
use crate::execution::ArtifactCollection;
use crate::test_case::{
    AssetKind, BuildCommands, ContractSpec, PerformanceCase, SandboxSpec, TestCaseVersion,
    TestType, Variant,
};
use crate::validation::Validator;

/// A bare default variant: the performance validator ignores the variant, so an
/// empty one (no voxel override) is all these tests need.
fn base_variant() -> Variant {
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
        reference_impl: None,
    }
}

/// A small but non-trivial scenario: a `fast` source feeding a belt into a sink,
/// run long enough that items flow and the sink counts them. Enough to make the
/// oracle produce a meaningful checksum the engine must reproduce.
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

/// The byte offset the baked `state` JSON lives at in the assembled module, past
/// the region `alloc` hands the host to write the scenario into.
const STATE_OFFSET: u32 = 65_536;

/// Assemble a tiny engine module that ignores its input and returns `state_json`
/// verbatim — a correct engine when `state_json` is the oracle's answer, an
/// incorrect one when it is corrupted. `alloc` returns a low pointer for the host
/// to write the scenario into (the module never reads it); `simulate` returns the
/// packed pointer/length of the baked JSON. Mirrors `lattice-host`'s
/// `echo_state_submission` pattern.
fn echo_engine(state_json: &str) -> Vec<u8> {
    let bytes = state_json.as_bytes();
    let len = bytes.len() as u32;
    // The host packs the return as `(ptr << 32) | len`.
    let packed = ((STATE_OFFSET as i64) << 32) | (len as i64);
    // A wasm-text byte string of the JSON for the data segment.
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

/// The oracle's answer for [`SCENARIO_JSON`], as the JSON array the engine returns.
fn expected_state() -> (Scenario, Vec<Snapshot>, String) {
    let scenario = Scenario::parse(SCENARIO_JSON.as_bytes()).expect("scenario parses");
    let snapshots = Engine::solve(&scenario);
    let json = serde_json::to_string(&snapshots).expect("expected serializes");
    (scenario, snapshots, json)
}

/// A minimal performance version rooted at `root`, scoring `build.module` against a
/// single committed `[[case]]` (`input` + `expected`).
fn performance_version(root: PathBuf, module_rel: &str, case: PerformanceCase) -> TestCaseVersion {
    TestCaseVersion {
        slug: "performance-factorio".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Lattice".to_string(),
        difficulty: "hard".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root,
        prompt_path: PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 3600,
        test_type: TestType::Performance,
        build: Some(BuildCommands {
            install: "cargo fetch".to_string(),
            build: "cargo build".to_string(),
            module: Some(PathBuf::from(module_rel)),
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
            fuel_limit: Some(5_000_000_000),
            max_memory_bytes: 268_435_456,
        }),
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: AssetKind::Sprite,
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
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: vec![case],
    }
}

/// Stage the committed scored set (`cases/c.json` + `cases/c.out`) under the
/// version `root`, and the engine module under the run `repo`. Returns the resolved
/// [`PerformanceCase`] (host paths inside `root`).
fn stage(
    root: &std::path::Path,
    repo: &std::path::Path,
    module_rel: &str,
    module_wasm: &[u8],
    expected_json: &str,
) -> PerformanceCase {
    let cases_dir = root.join("cases");
    std::fs::create_dir_all(&cases_dir).expect("cases dir");
    let input = cases_dir.join("c.json");
    let expected = cases_dir.join("c.out");
    std::fs::write(&input, SCENARIO_JSON).expect("input");
    std::fs::write(&expected, expected_json).expect("expected");

    let module_path = repo.join(module_rel);
    if let Some(parent) = module_path.parent() {
        std::fs::create_dir_all(parent).expect("module dir");
    }
    std::fs::write(&module_path, module_wasm).expect("module");

    PerformanceCase { input, expected }
}

#[test]
fn a_correct_engine_scores_correct_with_a_fuel_number() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("case");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&root).expect("root");
    std::fs::create_dir_all(&repo).expect("repo");

    let (_scenario, _snapshots, expected_json) = expected_state();
    // The engine echoes the oracle's exact answer, so it must score correct.
    let module = echo_engine(&expected_json);
    let module_rel = "target/wasm32-unknown-unknown/release/engine.wasm";
    let case = stage(&root, &repo, module_rel, &module, &expected_json);

    let version = performance_version(root.clone(), module_rel, case);
    let summary = PerformanceValidator::new()
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection {
                repo_path: repo.clone(),
            },
            &[],
            &[],
        )
        .expect("validate");

    assert!(summary.loaded, "a runnable engine loaded");
    let result = summary.performance.expect("performance result");
    assert!(result.correct, "the engine reproduced the oracle's answer");
    assert_eq!(result.cases.len(), 1);
    assert!(result.cases[0].correct);
    // A correct run records the comparable fuel; it must be present and positive.
    let fuel = result.total_fuel.expect("a correct run records fuel");
    assert!(fuel > 0, "running the engine consumed fuel: {fuel}");
    assert_eq!(result.cases[0].fuel, Some(fuel));

    // The engine's produced state is written into the run tree for review.
    assert!(
        repo.join("performance/c.state.json").is_file(),
        "the produced state is written for diffing"
    );
}

#[test]
fn a_wrong_answer_engine_fails_the_correctness_gate() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("case");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&root).expect("root");
    std::fs::create_dir_all(&repo).expect("repo");

    let (_scenario, snapshots, expected_json) = expected_state();
    // The engine echoes a *corrupted* answer: same shape and snapshot count, but a
    // wrong checksum on the first snapshot, so the checksum gate must reject it.
    let mut wrong = snapshots.clone();
    wrong[0].checksum = "fnv1a64:0000000000000000".to_string();
    let wrong_json = serde_json::to_string(&wrong).expect("wrong serializes");
    let module = echo_engine(&wrong_json);
    let module_rel = "target/wasm32-unknown-unknown/release/engine.wasm";
    // The committed expected answer is the oracle's, against which the wrong engine
    // is judged.
    let case = stage(&root, &repo, module_rel, &module, &expected_json);

    let version = performance_version(root.clone(), module_rel, case);
    let summary = PerformanceValidator::new()
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
        )
        .expect("validate");

    // The engine ran (it loaded and produced output), so the load signal is
    // positive, but the correctness gate fails and no fuel is scored.
    assert!(summary.loaded, "the engine ran without a host error");
    let result = summary.performance.expect("performance result");
    assert!(!result.correct, "a wrong checksum fails the gate");
    assert!(result.total_fuel.is_none(), "incorrect runs score no fuel");
    assert_eq!(result.cases[0].first_mismatch_tick, Some(100));
    assert!(
        result.cases[0].detail.is_some(),
        "the mismatch is explained"
    );
    // The fuel is still recorded per case for diagnostics even when incorrect.
    assert!(result.cases[0].fuel.is_some());
}

#[test]
fn a_missing_engine_module_scores_incorrect() {
    let dir = tempfile::tempdir().expect("temp dir");
    let root = dir.path().join("case");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&root).expect("root");
    std::fs::create_dir_all(&repo).expect("repo");

    let (_scenario, _snapshots, expected_json) = expected_state();
    // Stage the scored set but write *no* module at the declared path: the build
    // emitted no engine.
    let cases_dir = root.join("cases");
    std::fs::create_dir_all(&cases_dir).expect("cases dir");
    std::fs::write(cases_dir.join("c.json"), SCENARIO_JSON).expect("input");
    std::fs::write(cases_dir.join("c.out"), &expected_json).expect("expected");
    let case = PerformanceCase {
        input: cases_dir.join("c.json"),
        expected: cases_dir.join("c.out"),
    };

    let version = performance_version(
        root,
        "target/wasm32-unknown-unknown/release/engine.wasm",
        case,
    );
    let summary = PerformanceValidator::new()
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
        )
        .expect("validate");

    // No engine means nothing runnable: the load signal is negative and the run is
    // recorded incorrect with a reason.
    assert!(!summary.loaded, "no module means nothing runnable");
    let result = summary.performance.expect("performance result");
    assert!(!result.correct);
    assert!(result.total_fuel.is_none());
    assert!(
        result
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("no engine module"),
        "the reason names the missing module: {:?}",
        result.detail
    );
}
