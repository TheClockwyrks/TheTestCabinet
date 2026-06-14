//! `tcab run` — launch a single benchmark run.

use test_cabinet_core::{HarnessSlug, RunRequest};

use crate::cli::RunArgs;

/// Launch a run for the selected test case version, harness, and model.
///
/// The real work — resolving the test case version, seeding a repository,
/// executing in a container, invoking the harness, collecting metrics and
/// artifacts, validating, and writing the run record — lives in the core's
/// `Orchestrator`. This handler resolves the CLI arguments into the core's
/// [`RunRequest`] and then hands off.
pub async fn execute(args: RunArgs) -> anyhow::Result<()> {
    let harness: HarnessSlug = args.harness.into();

    // Faithfully assemble the run request the core orchestrator will drive.
    // The model ID is passed through to the harness unchanged; it is opaque to
    // The Test Cabinet.
    let request = RunRequest {
        test_case_slug: args.test_case,
        test_case_version: Some(args.version),
        harness,
        model_id: args.model,
    };

    println!(
        "tcab run: {}@{} via {} (model {})",
        request.test_case_slug,
        request.test_case_version.as_deref().unwrap_or("latest"),
        request.harness.as_str(),
        request.model_id,
    );
    if let Some(dir) = &args.out_dir {
        println!("  output directory: {}", dir.display());
    }

    // TODO: build an `Orchestrator` from the configured seams (catalog, seeder,
    // container runtime, collector, harness registry, validator, publisher) and
    // drive `orchestrator.run(&request).await`, then write the resulting record.
    let _ = request;
    todo!("drive the run through the core Orchestrator");
}
