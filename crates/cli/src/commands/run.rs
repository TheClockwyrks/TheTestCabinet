//! `tcab run` — enqueue a run on the backend and watch it to completion.
//!
//! `tcab` is a thin backend client, exactly like the web console: it does not
//! execute runs locally. A run is enqueued on the backend's `/jobs` queue (a
//! dispatcher claims it and a per-run driver pod executes it), the CLI streams the
//! job's live event feed, and once the stream closes it reads back the produced
//! record to print the run's summary. Executing the run requires a reachable
//! backend (`TCAB_BACKEND_URL`) and a logged-in account (the enqueue is gated on
//! the launching account's bearer token).

use std::path::PathBuf;

use anyhow::{Context, bail};
use test_cabinet_core::backend_client::LiveItem;
use test_cabinet_core::{
    BackendClient, HarnessSlug, HttpBackendClient, JobState, JobStatusOut, LaunchBody,
    PublishedRun, RunRecord,
};

use crate::cli::RunArgs;
use crate::commands::event_printer::render_event;
use crate::config;

/// Enqueue a run for the selected test case version, harness, and model on the
/// backend, stream its live event feed, then report the produced record.
///
/// Requires a backend URL (`TCAB_BACKEND_URL`) and a logged-in account: the CLI
/// no longer runs containers itself, it drives the backend's run queue (the k3d
/// stack) the same way the web console does.
pub async fn execute(args: RunArgs) -> anyhow::Result<()> {
    let harness: HarnessSlug = args.harness.into();

    let backend = config::backend_url().context(
        "TCAB_BACKEND_URL is not set; `tcab run` now enqueues runs on the backend (the k3d \
         stack) — set it to the backend's address (for example http://127.0.0.1:8787)",
    )?;
    // The enqueue is gated on the launching account, so a launch requires a stored
    // login token even though plain reads do not.
    let token = config::require_token().context("launching a run requires a logged-in account")?;

    // An external `--orchestrator-dir` is a local-execution affordance that no
    // longer applies to a backend-driven run; the orchestrator is selected by its
    // built-in slug. `one-shot` is the default the backend also assumes when the
    // field is omitted.
    let orchestrator = (args.orchestrator != "one-shot").then(|| args.orchestrator.clone());
    let body = LaunchBody {
        test_case: args.test_case.clone(),
        version: args.version.clone(),
        variant: args.variant.clone(),
        harness,
        model: args.model.clone(),
        orchestrator,
        max_runtime_seconds: args.max_runtime,
        auth_mode: args.auth_mode.clone(),
    };

    println!(
        "tcab run: {}@{} [{}] via {} (model {})",
        body.test_case,
        body.version,
        body.variant,
        body.harness.as_str(),
        body.model,
    );
    println!("  backend: {backend}");
    match body.max_runtime_seconds {
        Some(seconds) => println!("  cap:     {seconds}s max runtime (override)"),
        None => println!("  cap:     test case default max runtime"),
    }
    match &body.orchestrator {
        Some(slug) => println!("  orch:    {slug}"),
        None => println!("  orch:    one-shot"),
    }
    if let Some(mode) = &body.auth_mode {
        println!("  auth:    {mode}");
    }

    // The watch is read-only (the launch carries the account token itself), so the
    // client need not hold the token for the stream/status/read calls.
    let client = HttpBackendClient::new(backend);

    let job_id = client
        .launch_run(&body, &token)
        .await
        .context("enqueuing the run on the backend")?;
    println!("\nqueued job {job_id}");

    // Print the run's activity live as it proceeds, rather than waiting in silence.
    // The feed covers both the driver's setup/teardown stages and the harness's
    // activity. Preview frames (asset-generation drawing) are noted minimally since
    // the CLI is text-only and cannot render an image.
    println!("\nevent feed:");
    let mut on_item = |item: LiveItem| match item {
        LiveItem::Event(event) => render_event(&event),
        LiveItem::Preview(preview) => {
            println!(
                "  preview frame {} ({} ops)",
                preview.frame, preview.operation_count
            );
        }
    };
    client
        .watch_job(&job_id, &mut on_item)
        .await
        .with_context(|| format!("watching job {job_id}"))?;

    // The stream closes when the run reaches a terminal state; read the job back to
    // learn how it ended and (on success) the produced record's id to open.
    let status = client
        .job_status(&job_id)
        .await
        .with_context(|| format!("reading the status of job {job_id}"))?;
    finish(&client, &args, &job_id, status).await
}

/// Resolve a finished job's terminal status into the run summary (on success) or a
/// non-zero exit with the failure detail. On success the produced record is read
/// back from the backend so the same summary the local runner printed is shown.
async fn finish(
    client: &HttpBackendClient,
    args: &RunArgs,
    job_id: &str,
    status: JobStatusOut,
) -> anyhow::Result<()> {
    match status.state {
        JobState::Succeeded => {
            let record_id = status.record_id.with_context(|| {
                format!("job {job_id} succeeded but reported no produced record id")
            })?;
            let run = client
                .read_run(&record_id)
                .await
                .with_context(|| format!("reading the produced run record {record_id}"))?;
            print_summary(&run.record);
            if let Some(dir) = &args.out_dir {
                write_record(dir, &run)?;
            }
            Ok(())
        }
        // A `failed`/`canceled` job either produced a failure record (a model
        // failure with a timeline) or none (an infrastructure failure). Surface the
        // detail and exit non-zero either way.
        JobState::Failed | JobState::Canceled => {
            let detail = status
                .detail
                .as_deref()
                .unwrap_or("the run did not complete");
            bail!("run {job_id} {}: {detail}", state_label(status.state));
        }
        // The stream only closes on a terminal state, so a non-terminal status here
        // means the watch ended early (a dropped connection); treat it as a failure
        // to observe the run rather than a silent success.
        other => bail!(
            "watch for job {job_id} ended while the run was still {} — re-run to observe it to \
             completion",
            state_label(other)
        ),
    }
}

/// Print the produced run's summary: id, terminal state, token/cost/time metrics,
/// and the validation outcome, mirroring what the in-process runner printed.
fn print_summary(record: &RunRecord) {
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
}

/// Write the fetched run record's JSON to `dir/<record-id>.json` when `--out-dir`
/// was given (the backend holds the artifacts; the CLI only mirrors the record).
fn write_record(dir: &PathBuf, run: &PublishedRun) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)
        .with_context(|| format!("creating output directory {}", dir.display()))?;
    let path = dir.join(format!("{}.json", run.record.id));
    let json =
        serde_json::to_string_pretty(&run.record).context("serializing the fetched run record")?;
    std::fs::write(&path, json).with_context(|| format!("writing {}", path.display()))?;
    println!("  record:  {}", path.display());
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
    use test_cabinet_core::RunState::{Catastrophic, Completed, Infrastructure, TimedOut};
    match state {
        Completed => "completed",
        Catastrophic => "catastrophic failure",
        TimedOut => "timed out",
        Infrastructure => "infrastructure failure",
    }
}

/// A short label for a job's lifecycle state.
fn state_label(state: JobState) -> &'static str {
    match state {
        JobState::Queued => "queued",
        JobState::Dispatched => "dispatched",
        JobState::Running => "running",
        JobState::Succeeded => "succeeded",
        JobState::Failed => "failed",
        JobState::Canceled => "canceled",
    }
}
