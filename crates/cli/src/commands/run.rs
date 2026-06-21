//! `tcab run` — launch a single benchmark run.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{
    BrowserRenderer, CliArtifactCollector, CliContainerRuntime, DefaultHarnessRegistry,
    DispatchValidator, FsRepoSeeder, HarnessSlug, HttpBackendClient, NoopPublisher,
    OpenRouterPrices, OrchestratorCatalog, OrchestratorSelection, PrerenderedReferenceRenderer,
    ReferenceRenderer, RunEngine, RunRequest, TestCaseCatalog, materialize_version,
};

use crate::cli::RunArgs;
use crate::commands::event_printer::PrintingEventSink;

/// Launch a run for the selected test case version, harness, and model.
///
/// The test-case version and its reference screenshots are resolved from the
/// backend (`TCAB_BACKEND_URL`) when one is configured: the served definition is
/// materialized to disk and the backend's rendered references are reused as the
/// seeded visual targets and validation baselines. With no backend configured the
/// command falls back to the local `test-cases/` checkout, preserving the
/// offline development path. Either way it assembles the core [`RunEngine`]
/// from concrete seams and drives the run to completion, then reports the record.
pub async fn execute(args: RunArgs) -> anyhow::Result<()> {
    let harness: HarnessSlug = args.harness.into();
    let request = RunRequest {
        test_case_slug: args.test_case,
        test_case_version: Some(args.version),
        variant: args.variant,
        harness,
        model_id: args.model,
        // An external `--orchestrator-dir` takes precedence over the built-in
        // `--orchestrator` slug (its own manifest slug is authoritative); with no
        // directory, the named built-in (defaulting to `one-shot`) is resolved.
        orchestrator: OrchestratorSelection {
            slug: args.orchestrator,
            dir: args.orchestrator_dir,
        },
        max_runtime_override: args.max_runtime,
        // No explicit per-run image override: the orchestrator resolves the
        // shared base image from the environment (a registry reference).
        container_image: None,
    };

    let output_dir = args.out_dir.unwrap_or_else(|| PathBuf::from("runs"));
    // Stage mountable inputs where the container runtime can reach them; on macOS
    // and Windows the OS temp directory is not shared with the runtime's VM. See
    // `crate::work_dir`.
    let work_dir = crate::work_dir::staging_dir(args.work_dir);
    let seed_dir = work_dir.join("seeds");
    let artifact_dir = work_dir.join("artifacts");
    let screenshot_dir = work_dir.join("screenshots");
    let store_dir = work_dir.join("definitions");
    for dir in [&output_dir, &seed_dir, &artifact_dir, &screenshot_dir] {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("creating directory {}", dir.display()))?;
    }

    let runtime = CliContainerRuntime::detect().context("locating a container runtime")?;
    println!(
        "tcab run: {}@{} [{}] via {} (model {})",
        request.test_case_slug,
        request.test_case_version.as_deref().unwrap_or("latest"),
        request.variant,
        request.harness.as_str(),
        request.model_id,
    );
    println!("  runtime: {}", runtime.binary());
    match request.max_runtime_override {
        Some(seconds) => println!("  cap:     {seconds}s max runtime (override)"),
        None => println!("  cap:     test case default max runtime"),
    }
    match &request.orchestrator.dir {
        Some(dir) => println!("  orch:    external dir {}", dir.display()),
        None => println!("  orch:    {}", request.orchestrator.slug),
    }
    println!("  output:  {}", output_dir.display());
    println!("  staging: {}", work_dir.display());

    // Resolve the version and the renderer either from the backend (preferred)
    // or the local checkout. The renderer differs: a backend-resolved run reuses
    // the backend's pre-rendered references; a local run renders the mockups with
    // the bundled browser.
    let version_str = request.test_case_version.clone().unwrap_or_default();
    let (test_case, renderer): (_, Box<dyn ReferenceRenderer>) = match backend_url() {
        Some(url) => {
            println!("  source:  backend {url}");
            let client = HttpBackendClient::new(url);
            let store = store_dir.join(&request.test_case_slug).join(&version_str);
            let (version, references) = materialize_version(
                &client,
                &request.test_case_slug,
                &version_str,
                &request.variant,
                &store,
            )
            .await
            .with_context(|| {
                format!(
                    "resolving {}@{} [{}] from the backend",
                    request.test_case_slug, version_str, request.variant
                )
            })?;
            // The base image resolves from the environment in the orchestrator
            // (a registry reference, no backend involved); `container_image` stays
            // `None` unless a caller sets an explicit per-run override.
            (
                version,
                Box::new(PrerenderedReferenceRenderer::new(references)),
            )
        }
        None => {
            let catalog_root = catalog_root();
            println!("  source:  local {}", catalog_root.display());
            let catalog = TestCaseCatalog::new(&catalog_root);
            let version = catalog
                .resolve(&request.test_case_slug, &version_str)
                .with_context(|| format!("resolving {}@{}", request.test_case_slug, version_str))?;
            (version, Box::new(BrowserRenderer::new()))
        }
    };

    let orchestrator = RunEngine {
        // The catalog is unused by `run_resolved` (the version is resolved above)
        // but the struct still carries one; point it at the local checkout.
        catalog: TestCaseCatalog::new(catalog_root()),
        seeder: FsRepoSeeder::new(seed_dir),
        collector: CliArtifactCollector::new(runtime.clone(), artifact_dir),
        runtime,
        harnesses: Box::new(DefaultHarnessRegistry::new()),
        orchestrators: OrchestratorCatalog::new(),
        renderer,
        validator: DispatchValidator::new(screenshot_dir),
        publisher: NoopPublisher,
        prices: OpenRouterPrices::new(),
        output_dir,
    };

    // Print the run's activity live as it proceeds, rather than waiting in
    // silence for the run to finish. The feed covers both the orchestrator's own
    // setup/teardown stages and the harness's activity, so it is the "event
    // feed" rather than only harness activity.
    println!("\nevent feed:");
    let mut events = PrintingEventSink;
    // The CLI prints to a terminal and cannot render the live drawing frames an
    // asset-generation run can stream, so no preview sink is supplied.
    let record = orchestrator
        .run_resolved(&request, &test_case, &mut events, None)
        .await
        .context("run failed")?;

    println!(
        "\nrun {} complete ({})",
        record.id,
        status_label(&record.status.state)
    );
    let tokens = &record.metrics.tokens;
    // A class the harness does not report shows as `n/a` rather than a misleading
    // zero; a total that folds in such a class is itself `n/a`.
    let count = |value: Option<u64>| match value {
        Some(count) => count.to_string(),
        None => "n/a".to_string(),
    };
    println!(
        "  tokens:  {} input ({} cached) / {} output ({} reasoning)",
        count(tokens.total_input()),
        count(tokens.cached_input),
        count(tokens.output),
        count(tokens.reasoning),
    );
    println!(
        "  cost:    ${:.4} comparable",
        record.metrics.cost.comparable
    );
    println!("  time:    {:.1}s", record.metrics.run_time_seconds);
    println!("  loaded:  {}", record.validation.loaded);
    print_step("install", record.validation.install.as_ref());
    print_step("build", record.validation.build.as_ref());
    print_checks(&record.validation);

    Ok(())
}

/// Print the outcome of a required build step (install or build), or that it was
/// never reached. The label is padded so the value lines up with the rows above.
fn print_step(label: &str, step: Option<&test_cabinet_core::StepResult>) {
    let value = match step {
        Some(step) if step.succeeded => "ok".to_string(),
        Some(step) => format!("failed ({})", step.detail.as_deref().unwrap_or("failed")),
        None => "not reached".to_string(),
    };
    println!("  {:<8} {value}", format!("{label}:"));
}

/// Print the per-check validation results, if the test case declared any.
fn print_checks(validation: &test_cabinet_core::ValidationSummary) {
    if validation.checks.is_empty() {
        return;
    }
    println!("  checks:");
    for check in &validation.checks {
        if check.reached {
            println!("    {} similarity: {:.2}", check.view, check.similarity);
        } else {
            let detail = check.detail.as_deref().unwrap_or("not reached");
            println!("    {} not reached ({detail})", check.view);
        }
    }
}

/// A short label for a run's terminal state.
fn status_label(state: &test_cabinet_core::RunState) -> &'static str {
    use test_cabinet_core::RunState::{Completed, Failed, Unevaluable};
    match state {
        Completed => "completed",
        Failed => "failed",
        Unevaluable => "unevaluable",
    }
}

/// The backend base URL the runner resolves definitions from, from
/// `TCAB_BACKEND_URL`. `None` (or blank) selects the local `test-cases/` checkout.
fn backend_url() -> Option<String> {
    std::env::var("TCAB_BACKEND_URL")
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}

/// Locate the test case catalog root.
///
/// Honors `TCAB_TEST_CASES_DIR`, otherwise defaults to `test-cases` relative to
/// the current working directory.
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
