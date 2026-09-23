//! **The ordering proof.** Drives a whole run through the real
//! [`RunEngine`](test_cabinet_core::RunEngine) with a real [`StaticCodeAnalyzer`] wired
//! into the post-run seam, and asserts that what the analysis measured is the code the
//! model wrote — not the tree validation left behind.
//!
//! The seam is placed after collection and *before* validation for exactly this reason:
//! the validator runs the case's install and build commands **in the produced tree
//! itself**, so after it the tree carries build output, a rewritten lockfile and toolchain
//! caches. Every one of those would be measured, and — worse — measured in *different
//! amounts per test case and per run*, silently breaking the cross-case comparison the
//! analysis exists for.
//!
//! So the fake validator here does what a real one does: it builds into `dist/` and
//! rewrites the lockfile its install step resolved. The run then has to satisfy three
//! statements at once:
//!
//! 1. `implementation/dist/bundle.js` **exists** in the archived run tree, and
//! 2. it contributed **zero** files to `size.files`, and no path under `dist/` appears in
//!    the document's file list; and
//! 3. re-analysing the tree validation left behind — the figures the record *would* carry
//!    if the seam sat one call lower — floors exactly one file more than the run's own
//!    analysis did.
//!
//! The third is the one that discriminates, and the reason is worth stating because it is
//! the trap this test was nearly built into. `dist/` is excluded **twice**: the case's own
//! `.gitignore` names it, and the walk's hardcoded floor names it again. An analysis that
//! ran after validation would therefore *also* report zero files from it — so 1 and 2
//! together prove the exclusions work and say nothing about ordering. The lockfile is
//! ignored by neither. It is ordinary tracked content the floor removes and **counts**, so
//! it is visible to a post-validation analysis and invisible to a pre-validation one.
//!
//! If the seam is ever moved below the validation call, assertion 3 fails.
//!
//! The fakes are local rather than shared with `crates/core/tests/post_run_stage.rs`: core
//! must never depend on this crate, not even for a test, because a dev-dependency would
//! put a parser back into `cargo tree -p test-cabinet-core`. The crate that owns the stage
//! owns the proof.
//!
//! **Not asserted here: the canceled run.** Cooperative cancellation is a gg-only path
//! (`drive_orchestrator` hardcodes `canceled: false` for a third-party session, because
//! only gg's in-container loop can wind itself down), so no run this file can drive
//! reaches the engine's cancellation branch. That the stage runs for a canceled run
//! anyway is a placement property — the seam sits *above* the `if outcome.canceled`
//! branch, unconditionally — and the stage's own indifference to `canceled` is asserted in
//! `src/stage.test.rs`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use test_cabinet_code_analysis::StaticCodeAnalyzer;
use test_cabinet_core::{
    AgentHarness, ArtifactCollection, ArtifactCollector, Availability, CODE_ANALYSIS_TREE_ARTIFACT,
    CodeAnalysisDocument, CodeAuthoredBasis, CodeTreeBasis, ContainerHandle, ContainerRuntime,
    ContainerSpec, ContainerStart, EngineCatalog, EngineSelection, EventFormat, EventSink,
    ExecOutput, FsRepoSeeder, HarnessInvocation, HarnessOutcome, HarnessRegistry, HarnessSlug,
    MediaKind, NoopEventSink, OpenRouterPrices, OrchestratorCatalog, OrchestratorSelection,
    OutputSink, OutputStream, PrerenderedReferenceRenderer, ProofFile, RenderedReference,
    Result as CoreResult, RunCancellation, RunEngine, RunRequest, TestCaseCatalog, TestCaseVersion,
    TokenCounts, Usage, ValidationSummary, Validator, Variant,
};

/// The repository's `test-cases/` directory — the real catalog, so the run is seeded from
/// a real case exactly as a run of it would be. That matters here beyond realism: the
/// seeded files are the scaffolding the authored-set ladder has to *exclude*, and a
/// hand-made two-file fixture would not exercise that at all.
fn catalog_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases")
}

/// The two files the "model" writes into the seeded workspace. Together they are the
/// entire authored set the analysis should report.
const AUTHORED: [(&str, &str); 2] = [
    (
        "src/main.ts",
        "import { start } from './game';\n\
         export function boot(): void {\n\
        \x20 start();\n\
         }\n",
    ),
    (
        "src/game.ts",
        "export function start(): number {\n\
        \x20 let ticks = 0;\n\
        \x20 while (ticks < 10) {\n\
        \x20   ticks += 1;\n\
        \x20 }\n\
        \x20 return ticks;\n\
         }\n",
    ),
];

/// The build output the fake validator drops into the produced tree, standing in for what
/// a real `npm run build` leaves behind. This is the file the step's ordering proof names.
const BUILD_OUTPUT: &str = "dist/bundle.js";

/// The other thing validation writes: `npm install` rewrites the lockfile in place.
///
/// This one carries the *discriminating* half of the proof. `dist/` is excluded twice over
/// — the case's own `.gitignore` names it, and the walk's hardcoded floor names it again —
/// so a `dist/` present at analysis time would still contribute zero files, and counting
/// zero of them proves only that the exclusions work. A lockfile is ignored by neither: it
/// is ordinary tracked content that the floor removes and *counts*. So it is visible to an
/// analysis that ran after validation and invisible to one that ran before, which is
/// exactly the difference under test.
const INSTALL_OUTPUT: &str = "package-lock.json";

/// The lifecycle steps the fakes record, so "the analysis ran between collection and
/// validation" is observable rather than inferred.
type Steps = Arc<Mutex<Vec<&'static str>>>;

/// A container runtime that answers every command successfully without running anything.
struct FakeRuntime;

#[async_trait::async_trait]
impl ContainerRuntime for FakeRuntime {
    async fn start(&self, _spec: &ContainerSpec) -> CoreResult<ContainerStart> {
        Ok(ContainerStart::ready(ContainerHandle {
            id: "fake-container".to_string(),
        }))
    }

    async fn exec(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
    ) -> CoreResult<ExecOutput> {
        // A plausible home directory: the orchestrator resolves the run user's home
        // with an `exec` before it writes its scripts.
        Ok(ExecOutput {
            exit_code: 0,
            stdout: "/home/runner".to_string(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn exec_streamed(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
        _idle_timeout: Option<Duration>,
        sink: &mut dyn OutputSink,
    ) -> CoreResult<ExecOutput> {
        // Bracket a single session exactly as the `tcab-session` wrapper does, so the
        // orchestrator segments one session out of the stream and reads its usage —
        // including the reported cost, which is what keeps this test off the network.
        for line in ["__TCAB_SESSION_BEGIN__", "{}", "__TCAB_SESSION_END__"] {
            sink.on_line(OutputStream::Stdout, line);
        }
        Ok(ExecOutput {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> CoreResult<()> {
        Ok(())
    }
}

/// An API-key harness that probes as available and reports a zero cost for its one
/// session. Deliberately not gg: the analyzer applies to every harness.
struct FakeHarness;

#[async_trait::async_trait]
impl AgentHarness for FakeHarness {
    fn slug(&self) -> HarnessSlug {
        HarnessSlug::Claude
    }

    fn api_key_env(&self) -> Option<&'static str> {
        Some("TCAB_FAKE_API_KEY")
    }

    fn session_argv(&self, _model_id: &str, prompt: &str) -> Vec<String> {
        vec!["true".to_string(), prompt.to_string()]
    }

    fn event_format(&self) -> EventFormat {
        EventFormat::Generic
    }

    fn parse_session_usage(&self, _output: &ExecOutput) -> (Usage, Option<f64>) {
        (
            Usage {
                tokens: TokenCounts::default(),
            },
            Some(0.0),
        )
    }

    async fn probe(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
    ) -> CoreResult<Availability> {
        Ok(Availability {
            available: true,
            version: Some("0.0.0-fake".to_string()),
            detail: None,
        })
    }

    async fn invoke(
        &self,
        _runtime: &dyn ContainerRuntime,
        _container: &ContainerHandle,
        _invocation: &HarnessInvocation,
        _events: &mut dyn EventSink,
    ) -> CoreResult<HarnessOutcome> {
        unreachable!("the orchestrated path drives the runner, never `invoke`")
    }
}

/// A registry that answers with the fake harness whatever slug is asked for.
struct FakeRegistry {
    harness: FakeHarness,
}

impl HarnessRegistry for FakeRegistry {
    fn get(&self, _slug: HarnessSlug) -> Option<&dyn AgentHarness> {
        Some(&self.harness)
    }
}

/// A collector that hands back the **seeded repository itself**, after writing the files
/// the "model" produced into it.
///
/// Pointing the analysis at the real seeded repo rather than at a throwaway directory is
/// what makes the authored-set ladder's top rung reachable: the run record's seed commit
/// is present in this tree, so the boundary between the scaffolding and the model's work
/// is the exact one the seeder created.
struct FakeCollector {
    steps: Steps,
    /// The directory the seeder creates run repositories under. The run's own repo is the
    /// single entry inside it, which is how the collector finds a path it could not have
    /// been told in advance.
    seed_base: PathBuf,
    /// Where the collected tree ended up, for the assertions to read afterwards.
    collected: Arc<Mutex<Option<PathBuf>>>,
}

#[async_trait::async_trait]
impl ArtifactCollector for FakeCollector {
    async fn collect(&self, _container: &ContainerHandle) -> CoreResult<ArtifactCollection> {
        self.steps.lock().expect("steps").push("collect");
        let repo_path = std::fs::read_dir(&self.seed_base)
            .expect("the seeder should have created a run repository")
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.is_dir())
            .expect("exactly one seeded run repository");
        for (path, contents) in AUTHORED {
            let full = repo_path.join(path);
            std::fs::create_dir_all(full.parent().expect("a parent")).expect("a directory");
            std::fs::write(full, contents).expect("the model's file");
        }
        *self.collected.lock().expect("collected") = Some(repo_path.clone());
        Ok(ArtifactCollection::new(repo_path))
    }
}

/// A validator that does what a real one does to the tree: builds into `dist/`.
///
/// This is the whole point of the test. Everything it writes here is written *after* the
/// analysis has already read the tree, and the assertions below prove it.
struct FakeValidator {
    steps: Steps,
    collected: Arc<Mutex<Option<PathBuf>>>,
}

impl Validator for FakeValidator {
    fn validate(
        &self,
        _test_case: &TestCaseVersion,
        _variant: &Variant,
        artifacts: &ArtifactCollection,
        _references: &[RenderedReference],
        _proofs: &[ProofFile],
    ) -> CoreResult<ValidationSummary> {
        self.steps.lock().expect("steps").push("validate");
        let output = artifacts.repo_path.join(BUILD_OUTPUT);
        std::fs::create_dir_all(output.parent().expect("a parent")).expect("the build directory");
        std::fs::write(&output, "console.log('bundled');\n").expect("the build output");
        std::fs::write(
            artifacts.repo_path.join(INSTALL_OUTPUT),
            "{\n  \"lockfileVersion\": 3\n}\n",
        )
        .expect("the rewritten lockfile");
        *self.collected.lock().expect("collected") = Some(artifacts.repo_path.clone());
        Ok(ValidationSummary::default())
    }
}

/// The rendered references a run of `test_case`/`variant` needs, taken from the case's own
/// static reference media so nothing has to be rendered.
fn references(test_case: &TestCaseVersion, variant: &Variant) -> Vec<RenderedReference> {
    test_case
        .references_for(variant)
        .into_iter()
        .map(|view| RenderedReference {
            view: view.view.clone(),
            kind: MediaKind::Image,
            media_path: view.source_path.clone(),
        })
        .collect()
}

/// Read a run tree's written analysis document back.
fn read_document(path: &Path) -> CodeAnalysisDocument {
    let bytes = std::fs::read(path).expect("the run tree's code-analysis artifact");
    let mut json = Vec::new();
    std::io::Read::read_to_end(
        &mut flate2::read::GzDecoder::new(std::io::Cursor::new(&bytes)),
        &mut json,
    )
    .expect("the artifact should decompress");
    serde_json::from_slice(&json).expect("a code-analysis document")
}

/// What one driven run left behind, kept together so the temporary directories outlive the
/// assertions that read them.
struct Ran {
    record: test_cabinet_core::RunRecord,
    /// The lifecycle steps the fakes recorded, in order.
    steps: Vec<&'static str>,
    /// The collected tree, as validation left it (or as the run left it, for a
    /// cancellation, which skips validation).
    collected: PathBuf,
    out_dir: tempfile::TempDir,
    _seed_dir: tempfile::TempDir,
}

impl Ran {
    /// The run's output tree: `<output_dir>/<run_id>`.
    fn run_dir(&self) -> PathBuf {
        self.out_dir.path().join(&self.record.id)
    }
}

/// Drive one whole run through the real engine with the real analyzer wired in.
///
/// `cancel` is the run's cancellation latch — raised before the call, it stands in for an
/// operator killing the run mid-session.
async fn drive(cancel: &RunCancellation) -> Ran {
    // SAFETY: the engine reads the harness's API key from the environment, and nothing
    // else in this test binary touches it. The tests run in one process, but both set the
    // same value.
    unsafe { std::env::set_var("TCAB_FAKE_API_KEY", "not-a-real-key") };

    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        // Pinned to a FROZEN version rather than `resolve_latest`, so this test's
        // fixture cannot drift as the case is revised. It also has to be a version
        // that supports the engineless run, which is what these fakes drive: a
        // version built against an engine refuses `EngineSelection::default()`
        // before any of the ordering below happens.
        .resolve("carom", "v2.1.0")
        .expect("resolve the bundled carom case");
    let variant = test_case.variant("base").expect("carom's base variant");

    let steps: Steps = Arc::new(Mutex::new(Vec::new()));
    let collected: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let seed_dir = tempfile::tempdir().expect("seed dir");
    let out_dir = tempfile::tempdir().expect("output dir");

    let engine = RunEngine {
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir.path()),
        runtime: FakeRuntime,
        collector: FakeCollector {
            steps: Arc::clone(&steps),
            seed_base: seed_dir.path().to_path_buf(),
            collected: Arc::clone(&collected),
        },
        harnesses: Box::new(FakeRegistry {
            harness: FakeHarness,
        }),
        orchestrators: OrchestratorCatalog::new(),
        engines: EngineCatalog::new(),
        renderer: Box::new(PrerenderedReferenceRenderer::new(references(
            &test_case, variant,
        ))),
        session_assembler: None,
        // The subject of this test: the real analyzer, wired exactly as a host wires it.
        analyzer: Some(Box::new(StaticCodeAnalyzer)),
        toolchain: None,
        validator: FakeValidator {
            steps: Arc::clone(&steps),
            collected: Arc::clone(&collected),
        },
        prices: OpenRouterPrices::new(),
        output_dir: out_dir.path().to_path_buf(),
        creds: None,
        prior_game_jam_entries: Vec::new(),
        clock: std::sync::Arc::new(test_cabinet_core::SystemClock),
    };

    let request = RunRequest {
        test_case_slug: test_case.slug.clone(),
        test_case_version: Some(test_case.version.clone()),
        variant: variant.slug.clone(),
        harness: HarnessSlug::Claude,
        model_id: "fake-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
        gg_model_prices: Default::default(),
        model_prices: None,
    };

    let record = engine
        .run_resolved(
            &test_cabinet_core::mint_run_id(),
            &request,
            &test_case,
            &mut NoopEventSink,
            None,
            cancel,
        )
        .await
        .expect("the run should finish");

    let steps = steps.lock().expect("steps").clone();
    let collected = collected
        .lock()
        .expect("collected")
        .clone()
        .expect("the run should have collected a tree");
    Ran {
        record,
        steps,
        collected,
        out_dir,
        _seed_dir: seed_dir,
    }
}

#[tokio::test]
async fn the_analysis_measures_the_tree_the_model_wrote_not_the_one_validation_left() {
    let ran = drive(&RunCancellation::default()).await;
    let record = &ran.record;

    assert_eq!(
        ran.steps,
        vec!["collect", "validate"],
        "the analysis runs between these two, and the validator's leavings are written last",
    );

    let summary = record
        .code_analysis
        .clone()
        .expect("the wired analyzer should have put a summary on the record");

    // The provenance the whole result hangs on. `preValidation` is a claim about *when*
    // the tree was read, and `seedCommit` a claim about *which* files were the model's;
    // the rest of this test is what makes both true rather than merely stamped.
    assert_eq!(summary.tree_basis, CodeTreeBasis::PreValidation);
    assert_eq!(summary.authored_basis, CodeAuthoredBasis::SeedCommit);
    assert_eq!(
        summary.analyzer_version,
        test_cabinet_code_analysis::ANALYZER_VERSION,
    );
    assert!(
        record.seed_commit.is_some(),
        "the exact rung of the ladder is the recorded seed commit",
    );

    // ---- The ordering proof -------------------------------------------------------
    let run_dir = ran.run_dir();
    assert!(
        run_dir.join("implementation").join(BUILD_OUTPUT).is_file(),
        "the archived tree must carry validation's build output — without it this test \
         proves nothing about ordering, only about the walk's floor",
    );

    assert_eq!(
        summary.size.files,
        AUTHORED.len() as u32,
        "only the model's own files are authored: not the seeded scaffolding, and not \
         the build output validation wrote after the analysis had already read the tree",
    );

    // The discriminating assertion. Re-analysing the very tree validation left behind is
    // the control: those are the figures the record would carry if this were wired one
    // call lower. It floors exactly one file more than the run's own analysis did — the
    // lockfile `npm install` rewrote — and an equal tally would mean the run had measured
    // a tree validation had already been through.
    let after_validation =
        test_cabinet_code_analysis::analyze(&test_cabinet_code_analysis::AnalysisRequest {
            root: &ran.collected,
            seed_commit: record.seed_commit.as_deref(),
            tree_basis: CodeTreeBasis::PostValidation,
            // The same answer the run's own stage reached for this tree: the fixture case
            // runs on the engineless engine, which seeds no documentation at the root.
            root_seeding: test_cabinet_code_analysis::walk::RootSeeding::default(),
        });
    assert_eq!(
        after_validation.summary.notes.files_skipped,
        summary.notes.files_skipped + 1,
        "re-analysing the post-validation tree must see one floored file the run's own \
         analysis did not: the lockfile validation's install step rewrote",
    );
    assert_eq!(
        after_validation.summary.size.files, summary.size.files,
        "…and the two agree on the authored set, so the difference above is validation's \
         leavings and nothing else",
    );

    let document = read_document(&run_dir.join(CODE_ANALYSIS_TREE_ARTIFACT));
    assert_eq!(document.summary, summary, "both tiers come from one pass");
    assert!(
        document
            .files
            .iter()
            .all(|file| !file.path.starts_with("dist/")),
        "no build-output file may appear in the document's file list: {:?}",
        document.files.iter().map(|f| &f.path).collect::<Vec<_>>(),
    );

    // The artifact belongs at the run tree's root, never inside `implementation/` — a
    // host-written file there would read as code the model wrote, and would then be
    // measured by the next analysis of the same tree.
    assert!(
        !run_dir
            .join("implementation")
            .join(CODE_ANALYSIS_TREE_ARTIFACT)
            .exists(),
    );
}
