//! Tests for the post-run stage itself: what it writes, what it hands back, and what it
//! does with a run it has nothing to measure.
//!
//! The stage's *placement* in the run — after collection, before validation — is a
//! property of `RunEngine::run_resolved` rather than of this file, so it is proven end to
//! end in `tests/run_path_ordering.rs`.

use std::path::Path;

use test_cabinet_core::post_run::{PostRunContext, PostRunStage};
use test_cabinet_core::test_case::{TestCaseVersion, Variant};
use test_cabinet_core::{
    ArtifactCollection, CodeAnalysisDocument, CodeAuthoredBasis, CodeTreeBasis, EngineCatalog,
    EngineSelection, HarnessSlug, OrchestratorSelection, ResolvedEngine, RunRequest,
    TestCaseCatalog,
};

use super::*;

/// The repository's own `test-cases/` directory. A real resolved case is cheaper to
/// obtain than a hand-written `TestCaseVersion` literal, and the stage reads nothing from
/// it — which is itself worth pinning: the analysis is a function of the tree, not of the
/// case.
fn catalog_case() -> (TestCaseVersion, Variant) {
    let catalog = TestCaseCatalog::new(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test-cases"),
    );
    let case = catalog
        .resolve_latest("carom")
        .expect("resolve the bundled carom case");
    let variant = case.variant("base").expect("carom's base variant").clone();
    (case, variant)
}

/// A run request for a **third-party** harness, deliberately: the stage must not check the
/// harness, because analysing a directory involves no harness-specific work.
fn request(case: &TestCaseVersion, variant: &Variant) -> RunRequest {
    RunRequest {
        test_case_slug: case.slug.clone(),
        test_case_version: Some(case.version.clone()),
        variant: variant.slug.clone(),
        harness: HarnessSlug::Claude,
        model_id: "some-model".to_string(),
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
    }
}

/// Run the stage over `tree`, writing its artifact into `run_dir`.
async fn stage(
    tree: &Path,
    run_dir: &Path,
    seed_commit: &str,
) -> test_cabinet_core::post_run::PostRunReport {
    stage_for(tree, run_dir, seed_commit, false).await
}

/// As [`stage`], but says whether an operator canceled the run.
async fn stage_for(
    tree: &Path,
    run_dir: &Path,
    seed_commit: &str,
    canceled: bool,
) -> test_cabinet_core::post_run::PostRunReport {
    stage_built_on(tree, run_dir, seed_commit, canceled, None).await
}

/// Resolve a built-in engine the way the run path does, without a package store: the
/// version is tolerant of an absent one, and nothing here reads it.
fn resolved(slug: &str) -> ResolvedEngine {
    EngineCatalog::with_package_store("/nonexistent/package/store")
        .resolve(&EngineSelection::new(slug))
        .expect("a built-in engine slug")
}

/// As [`stage_for`], but stamps `engine` on the tree's description, exactly as the run
/// path does before it reaches the seam.
async fn stage_built_on(
    tree: &Path,
    run_dir: &Path,
    seed_commit: &str,
    canceled: bool,
    engine: Option<ResolvedEngine>,
) -> test_cabinet_core::post_run::PostRunReport {
    let (case, variant) = catalog_case();
    let request = request(&case, &variant);
    let artifacts = ArtifactCollection::new(tree.to_path_buf()).built_on(engine);
    StaticCodeAnalyzer
        .run(&PostRunContext {
            run_id: "run-1",
            run_dir,
            artifacts: &artifacts,
            seed_commit,
            test_case: &case,
            variant: &variant,
            request: &request,
            canceled,
        })
        .await
        .expect("the stage should not fail on a readable tree")
}

/// Read back a written artifact as the document it claims to be.
fn read_document(path: &Path) -> CodeAnalysisDocument {
    let bytes = std::fs::read(path).expect("the written artifact");
    assert_eq!(
        &bytes[..2],
        &[0x1f, 0x8b],
        "the run tree's artifacts are gzipped by convention, so a reader can sniff them",
    );
    let mut json = Vec::new();
    std::io::Read::read_to_end(
        &mut flate2::read::GzDecoder::new(std::io::Cursor::new(&bytes)),
        &mut json,
    )
    .expect("the artifact should decompress");
    serde_json::from_slice(&json).expect("the artifact should be a code-analysis document")
}

#[tokio::test]
async fn the_stage_writes_the_document_and_hands_back_the_summary() {
    let tree = tempfile::tempdir().expect("a produced tree");
    std::fs::create_dir_all(tree.path().join("src")).expect("a source directory");
    std::fs::write(
        tree.path().join("src/main.ts"),
        "export function boot(): number {\n  return 1;\n}\n",
    )
    .expect("a written source file");
    let run_dir = tempfile::tempdir().expect("a run directory");

    let report = stage(tree.path(), run_dir.path(), "not-a-real-commit").await;

    // Two tiers, one pass: the unbounded document lands in the run tree, the bounded
    // summary rides back to the record, and they agree.
    let artifact = run_dir.path().join(CODE_ANALYSIS_TREE_ARTIFACT);
    assert_eq!(report.artifacts, vec![artifact.clone()]);
    let document = read_document(&artifact);
    let summary = report
        .code_analysis
        .expect("the stage should hand a summary back for the record");
    assert_eq!(document.summary, summary);
    assert_eq!(summary.size.files, 1);

    // The run path is the *only* producer of a pre-validation basis, and the stage is
    // what stamps it.
    assert_eq!(summary.tree_basis, CodeTreeBasis::PreValidation);
    assert_eq!(summary.analyzer_version, crate::ANALYZER_VERSION);

    // Nothing is left behind: a half-written document would be indistinguishable from a
    // valid short one, so it is renamed into place from a sibling that must be gone.
    assert!(
        !run_dir
            .path()
            .join(format!("{CODE_ANALYSIS_TREE_ARTIFACT}.partial"))
            .exists(),
        "the scratch file should have been renamed away, not left beside the artifact",
    );
}

#[tokio::test]
async fn a_run_whose_tree_never_reached_the_host_is_reported_as_absent_not_as_zero() {
    // The distinction the record's `Option` exists for: a run with no analysis must not
    // be recorded as a run that measured an empty tree, which would read as a model that
    // wrote nothing.
    let run_dir = tempfile::tempdir().expect("a run directory");
    let report = stage(
        Path::new("/nonexistent/collected/tree"),
        run_dir.path(),
        "not-a-real-commit",
    )
    .await;
    assert!(report.artifacts.is_empty());
    assert!(report.code_analysis.is_none());
    assert!(!run_dir.path().join(CODE_ANALYSIS_TREE_ARTIFACT).exists());
}

#[tokio::test]
async fn a_seeded_tree_resolves_its_authored_set_from_the_seam_s_seed_commit() {
    // The seam threads the run record's own seed commit through, which is the only
    // *exact* rung of the authored-set ladder. Without it the ladder degrades and every
    // figure silently includes the scaffolding the case seeded.
    let tree = tempfile::tempdir().expect("a produced tree");
    let root = tree.path();
    let git = |args: &[&str]| {
        let status = std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .env("GIT_AUTHOR_NAME", "seed")
            .env("GIT_AUTHOR_EMAIL", "seed@example.com")
            .env("GIT_COMMITTER_NAME", "seed")
            .env("GIT_COMMITTER_EMAIL", "seed@example.com")
            .output()
            .expect("git should run");
        assert!(status.status.success(), "git {args:?} should succeed");
        String::from_utf8_lossy(&status.stdout).trim().to_string()
    };
    git(&["init", "-q", "-b", "main"]);
    std::fs::write(root.join("spec.md"), "# the seeded specification\n").expect("the spec");
    git(&["add", "-A"]);
    git(&["commit", "-qm", "seed"]);
    let seed_commit = git(&["rev-parse", "HEAD"]);

    // …and then the "model" writes a file the seed does not contain.
    std::fs::create_dir_all(root.join("src")).expect("a source directory");
    std::fs::write(root.join("src/main.ts"), "export const answer = 42;\n").expect("the source");

    let run_dir = tempfile::tempdir().expect("a run directory");
    let summary = stage(root, run_dir.path(), &seed_commit)
        .await
        .code_analysis
        .expect("a summary");

    assert_eq!(summary.authored_basis, CodeAuthoredBasis::SeedCommit);
    assert_eq!(
        summary.size.files, 1,
        "only the model's own file is authored; the seeded spec is scaffolding",
    );
}

#[tokio::test]
async fn a_canceled_run_is_still_analysed() {
    // Validation is the one post-session stage a cancellation skips, because it is fresh
    // work that judges output an operator chose to stop. Analysis is neither: it reads
    // bytes that already exist and renders no verdict, so a killed run keeps its code
    // figures exactly as it keeps its metrics. The stage must therefore not consult
    // `canceled` at all — and a canceled run is in fact the *only* run whose tree is
    // never rewritten afterwards, since validation never touches it.
    let tree = tempfile::tempdir().expect("a produced tree");
    std::fs::create_dir_all(tree.path().join("src")).expect("a source directory");
    std::fs::write(tree.path().join("src/main.ts"), "export const half = 1;\n")
        .expect("what the model got through before it was stopped");
    let run_dir = tempfile::tempdir().expect("a run directory");

    let report = stage_for(tree.path(), run_dir.path(), "not-a-real-commit", true).await;

    let summary = report
        .code_analysis
        .expect("a canceled run keeps its code analysis");
    assert_eq!(summary.size.files, 1);
    assert_eq!(summary.tree_basis, CodeTreeBasis::PreValidation);
    assert!(
        run_dir.path().join(CODE_ANALYSIS_TREE_ARTIFACT).is_file(),
        "…and its document artifact, so the Code tab works for a killed run too",
    );
}

/// The floor's root-anchored `engine/` entry follows the ENGINE the tree was built on, not
/// the directory's name.
///
/// An engine that seeds documentation writes markdown to `engine/` at the run root, and none
/// of it is the model's. An engine that seeds none writes nothing there at all, so the same
/// path on such a run holds only what the model put there — a build's own frame loop, or the
/// whole submission of a case whose workspace seeds a skeleton at `engine/src/lib.rs` and
/// tells the build to fill it in. Reading the name alone cannot tell the two apart, and
/// getting it wrong in the second direction deletes a finished build from every figure on the
/// page.
#[tokio::test]
async fn a_root_engine_directory_follows_the_engine_the_tree_was_built_on() {
    let tree = tempfile::tempdir().expect("a produced tree");
    std::fs::create_dir_all(tree.path().join("engine")).expect("an engine directory");
    std::fs::write(tree.path().join("src.ts"), "export const a = 1;\n").expect("a root source");
    std::fs::write(
        tree.path().join("engine/loop.ts"),
        "export const tick = (): void => {};\n",
    )
    .expect("what sits at `engine/`");

    let seeded_run = tempfile::tempdir().expect("a run directory");
    let seeded = stage_built_on(
        tree.path(),
        seeded_run.path(),
        "not-a-real-commit",
        false,
        Some(resolved("simple-2d")),
    )
    .await
    .code_analysis
    .expect("a summary");
    assert_eq!(
        seeded.size.files, 1,
        "the engine seeded its own documentation there, so `engine/` is not authored code",
    );
    assert_eq!(seeded.notes.files_skipped, 1, "…and the floor counts it");

    let engineless_run = tempfile::tempdir().expect("a run directory");
    let engineless = stage_built_on(
        tree.path(),
        engineless_run.path(),
        "not-a-real-commit",
        false,
        Some(resolved(test_cabinet_core::engine::NONE_SLUG)),
    )
    .await
    .code_analysis
    .expect("a summary");
    assert_eq!(
        engineless.size.files, 2,
        "this engine seeded nothing at the root, so `engine/loop.ts` is the model's work",
    );
    assert_eq!(engineless.notes.files_skipped, 0);
}
