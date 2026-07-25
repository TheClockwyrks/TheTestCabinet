//! `tcab gg-run` — execute a **gg** run locally, in-process, against a real
//! container runtime.
//!
//! gg is The Test Cabinet's own harness and is invoked directly (it *is* the
//! executor — see the design docs under `gg/`), not enqueued on the backend like a
//! third-party-harness run. This command is the offline developer path for it: it
//! resolves the case from a local `test-cases/` checkout, seeds a fresh repo, and
//! assembles the same [`RunEngine`] the driver does around a host Docker/Podman
//! runtime, then drives a gg [`RunRequest`] to completion while printing the live
//! event feed. Binding gg's `primary` slot to the scripted mock provider (the
//! default) makes the whole path runnable with no credentials and no network, so the
//! integration can be exercised end to end before any backend or UI wiring exists.

use std::collections::BTreeMap;

use anyhow::{Context, bail};
use tempfile::TempDir;
use test_cabinet_core::gg::{GgCapabilitySet, PRIMARY_SLOT};
use test_cabinet_core::{
    BackendClient, BrowserRenderer, CliArtifactCollector, CliContainerRuntime,
    DefaultHarnessRegistry, DispatchValidator, FsRepoSeeder, HarnessSlug, HttpBackendClient,
    OpenRouterPrices, OrchestratorCatalog, OrchestratorSelection, ReferenceRenderer, RunEngine,
    RunRequest, TestCaseCatalog, runtime_hours_to_seconds,
};

use crate::cli::GgRunArgs;
use crate::commands::event_printer::render_event;

/// Assemble a local [`RunEngine`] and drive a gg run for the selected case to
/// completion, printing the live event feed and a short summary.
pub async fn execute(args: GgRunArgs) -> anyhow::Result<()> {
    let capability_set = load_capability_set(&args)?;
    let model_id = primary_model(&capability_set).to_string();

    println!(
        "tcab gg-run: {}@{} [{}] via gg (primary model {})",
        args.test_case, args.version, args.variant, model_id,
    );

    // The per-model context windows gg is measured against. The model catalog is the
    // single store of that fact, and on the backend-driven path the backend resolves
    // it at enqueue; this local path has no backend behind it, so it asks the
    // configured one directly for the same figures. With none configured (a fully
    // offline mock run) gg falls back to its conservative default.
    let model_windows = resolve_model_windows(&capability_set).await;

    // Resolve the case from the local checkout, exactly like `tcab seed`.
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve(&args.test_case, &args.version)
        .with_context(|| format!("resolving {}@{}", args.test_case, args.version))?;

    // A host container runtime (Podman/Docker), the same the driver's CLI path uses.
    let runtime = CliContainerRuntime::detect().context(
        "locating a container runtime (gg-run executes locally and needs Podman or Docker)",
    )?;

    // Per-run scratch: the seeded repo staging area and the collected-artifact staging
    // area both live in a temp dir that is cleaned up when this returns.
    let scratch = TempDir::new().context("creating a scratch directory")?;
    let seed_dir = scratch.path().join("seed");
    let artifact_dir = scratch.path().join("artifacts");
    std::fs::create_dir_all(&seed_dir).ok();
    std::fs::create_dir_all(&artifact_dir).ok();

    std::fs::create_dir_all(&args.out_dir)
        .with_context(|| format!("creating output directory {}", args.out_dir.display()))?;

    let collector = CliArtifactCollector::new(runtime.clone(), artifact_dir);
    let engine = RunEngine {
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir),
        runtime,
        collector,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        orchestrators: OrchestratorCatalog::new(),
        renderer: Box::new(BrowserRenderer::new()) as Box<dyn ReferenceRenderer>,
        validator: DispatchValidator::new(scratch.path().join("screenshots")),
        prices: OpenRouterPrices::new(),
        output_dir: args.out_dir.clone(),
        // The local path reads any subscription credentials from the host; gg is
        // API-key-only (and mock needs none), so this is unused for a gg run.
        creds: None,
        prior_game_jam_entries: Vec::new(),
    };

    let request = RunRequest {
        test_case_slug: args.test_case.clone(),
        test_case_version: Some(args.version.clone()),
        variant: args.variant.clone(),
        harness: HarnessSlug::Gg,
        model_id,
        // The orchestrator dimension does not apply to gg (it is its own executor);
        // the default one-shot selection is carried and ignored by the gg branch.
        orchestrator: OrchestratorSelection::default(),
        max_runtime_override: args.max_runtime.map(runtime_hours_to_seconds),
        container_image: None,
        gg_capability_set: Some(capability_set),
        gg_model_windows: model_windows,
    };

    // A live sink that prints each event, mirroring `tcab run`'s watch. gg produces no
    // live asset-preview frames, so no preview sink is supplied.
    let mut events = PrintingSink;
    let record = engine
        .run_resolved(&request, &test_case, &mut events, None)
        .await
        .context("driving the gg run")?;

    println!("\nrun {} finished: {:?}", record.id, record.status.state);
    if let Some(detail) = &record.status.detail {
        println!("  detail: {detail}");
    }
    if let Some(total) = record.metrics.tokens.total() {
        println!("  tokens: {total}");
    }
    let reached = record
        .validation
        .checks
        .iter()
        .filter(|c| c.reached)
        .count();
    println!(
        "  validation: loaded={}, {}/{} checks reached",
        record.validation.loaded,
        reached,
        record.validation.checks.len(),
    );
    println!("  record written under: {}", args.out_dir.display());
    Ok(())
}

/// Load the run's [`GgCapabilitySet`] — from the `--gg-capabilities` file when given,
/// otherwise the Phase 0 minimal set with the `primary` slot bound to `--model`.
fn load_capability_set(args: &GgRunArgs) -> anyhow::Result<GgCapabilitySet> {
    match &args.gg_capabilities {
        Some(path) => {
            let raw = std::fs::read_to_string(path)
                .with_context(|| format!("reading gg capability set at {}", path.display()))?;
            let set: GgCapabilitySet = serde_json::from_str(&raw)
                .with_context(|| format!("parsing gg capability set at {}", path.display()))?;
            if set.model_for_slot(PRIMARY_SLOT).is_none() {
                bail!(
                    "the gg capability set at {} binds no `{PRIMARY_SLOT}` model slot; a gg run \
                     needs one",
                    path.display(),
                );
            }
            Ok(set)
        }
        None => Ok(GgCapabilitySet::minimal(&args.model)),
    }
}

/// The model bound to gg's `primary` slot — the id shown to the user and recorded as
/// the run's `model_id`.
fn primary_model(set: &GgCapabilitySet) -> &str {
    set.model_for_slot(PRIMARY_SLOT).unwrap_or("<unbound>")
}

/// Resolve the context window of every model `set` binds from the **model catalog**,
/// narrowed to the models this run can actually use.
///
/// The catalog is the single store of model facts, so this local path reads the same
/// figures the backend pushes onto a queued run rather than keeping a table of its own.
/// Best-effort throughout: with no backend configured, or one that cannot be reached,
/// the map is empty and gg falls back to its conservative default (an offline mock run
/// has no catalog entry anyway). A note is printed either way so the resolved window is
/// never a mystery.
async fn resolve_model_windows(set: &GgCapabilitySet) -> BTreeMap<String, u64> {
    let Some(backend) = crate::config::backend_url() else {
        println!(
            "  note: no backend configured (TCAB_BACKEND_URL), so no model context windows \
             were resolved; gg will use its default"
        );
        return BTreeMap::new();
    };
    let catalog = match HttpBackendClient::new(backend).model_windows().await {
        Ok(catalog) => catalog,
        Err(err) => {
            println!(
                "  note: could not read the model catalog ({err}); gg will use its default \
                 context window"
            );
            return BTreeMap::new();
        }
    };
    set.bound_model_ids()
        .into_iter()
        .filter_map(|id| catalog.get(id).map(|&window| (id.to_string(), window)))
        .collect()
}

/// An [`EventSink`](test_cabinet_core::EventSink) that prints each event through the
/// shared CLI formatter as it arrives.
struct PrintingSink;

impl test_cabinet_core::EventSink for PrintingSink {
    fn emit(&mut self, event: &test_cabinet_core::HarnessEvent) {
        render_event(event);
    }
}

/// Locate the test case catalog root (see `tcab seed`).
fn catalog_root() -> std::path::PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("test-cases"))
}
