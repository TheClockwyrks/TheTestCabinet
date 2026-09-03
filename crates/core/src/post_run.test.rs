//! Tests for the post-run stage driver: what it runs, in what order, and what a
//! failing stage does to the run around it.
//!
//! The seam's *placement* — after collection, before validation, outside the
//! harness runtime cap — is the property the whole design turns on, and it cannot
//! be proven here because it is a property of `RunEngine::run_resolved`, not of
//! this driver. It is proven end to end in
//! `crates/core/tests/post_run_stage.rs`.

use std::path::PathBuf;
use std::sync::Mutex;

use super::{PostRunContext, PostRunReport, PostRunStage, run_stages};
use crate::error::Error;
use crate::execution::ArtifactCollection;
use crate::test_case::{TestCaseVersion, TestType, Variant};

/// A stage that records that it ran (in a shared log, so ordering across stages
/// is observable), then answers with `outcome`.
struct RecordingStage {
    name: &'static str,
    ran: &'static Mutex<Vec<&'static str>>,
    /// What the stage answers with: an artifact it "wrote", or a failure.
    fails: bool,
}

#[async_trait::async_trait]
impl PostRunStage for RecordingStage {
    fn name(&self) -> &'static str {
        self.name
    }

    async fn run(&self, _context: &PostRunContext<'_>) -> crate::error::Result<PostRunReport> {
        self.ran.lock().expect("stage log").push(self.name);
        if self.fails {
            return Err(Error::ArtifactCollection(format!(
                "`{}` could not read the tree",
                self.name
            )));
        }
        Ok(PostRunReport::artifact(PathBuf::from(format!(
            "{}.json.gz",
            self.name
        ))))
    }
}

/// A resolved version with nothing set that a stage would read; the driver never
/// looks at it, and a stage under test here does not either.
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
        changelog_path: PathBuf::new(),
        root: PathBuf::from("/tmp/carom"),
        prompt_path: PathBuf::from("/tmp/carom/prompt.hbs"),
        max_runtime_seconds: 3600,
        test_type: TestType::EndToEnd,
        build: None,
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

/// Drive `stages` over a throwaway context, returning the folded report.
async fn drive(stages: &[&dyn PostRunStage]) -> PostRunReport {
    let version = version();
    let variant = variant();
    let request = crate::RunRequest {
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
    };
    let artifacts = ArtifactCollection::new(PathBuf::from("/tmp/does-not-need-to-exist"));
    let context = PostRunContext {
        run_id: "run-1",
        run_dir: std::path::Path::new("/tmp/run-1"),
        artifacts: &artifacts,
        seed_commit: "0123456789abcdef0123456789abcdef01234567",
        test_case: &version,
        variant: &variant,
        request: &request,
        canceled: false,
    };
    run_stages(stages.iter().copied(), &context).await
}

#[tokio::test]
async fn stages_run_in_the_order_they_are_given() {
    // Order is part of the contract, not an accident of iteration: a stage may
    // leave the tree in the state the next one reads.
    static RAN: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());
    let first = RecordingStage {
        name: "first",
        ran: &RAN,
        fails: false,
    };
    let second = RecordingStage {
        name: "second",
        ran: &RAN,
        fails: false,
    };

    let report = drive(&[&first, &second]).await;

    assert_eq!(*RAN.lock().expect("stage log"), vec!["first", "second"]);
    assert_eq!(
        report.artifacts,
        vec![
            PathBuf::from("first.json.gz"),
            PathBuf::from("second.json.gz"),
        ],
        "the report should accumulate what every stage produced",
    );
}

#[tokio::test]
async fn a_failing_stage_neither_stops_the_run_nor_the_stages_after_it() {
    // The run's result already exists by the time a stage runs. An analysis that
    // cannot do its job must leave the run — and every other analysis — intact;
    // the missing artifact is the only signal.
    static RAN: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());
    let broken = RecordingStage {
        name: "broken",
        ran: &RAN,
        fails: true,
    };
    let healthy = RecordingStage {
        name: "healthy",
        ran: &RAN,
        fails: false,
    };

    let report = drive(&[&broken, &healthy]).await;

    assert_eq!(*RAN.lock().expect("stage log"), vec!["broken", "healthy"]);
    assert_eq!(
        report.artifacts,
        vec![PathBuf::from("healthy.json.gz")],
        "the failed stage should contribute nothing, and nothing else",
    );
}

#[tokio::test]
async fn no_stages_is_the_default_and_produces_nothing() {
    // Every host that wires no stage — and every test — takes this path.
    let report = drive(&[]).await;
    assert_eq!(report, PostRunReport::empty());
}
