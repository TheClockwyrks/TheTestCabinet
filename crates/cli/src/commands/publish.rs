//! `tcab review` / `tcab publish` — the run release lifecycle, against the backend.
//!
//! Runs no longer execute locally: a `tcab run` enqueues a run on the backend and
//! a per-run driver pod executes it, storing the produced record (and its
//! artifacts) on the backend's run store during the run. So this lifecycle operates
//! by **backend run id**, not by a local run directory:
//!
//! - **review** submits a review (from a locally authored `writeup.md`) for a
//!   produced run, attributed to the logged-in account. A run may carry many
//!   reviews, one per account.
//! - **publish** is the solo convenience: self-review + publish gate in one step,
//!   for an operator reviewing their own run. A run cannot be published without at
//!   least one review.
//!
//! Both require a logged-in account (`tcab login`) and `TCAB_BACKEND_URL`.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use test_cabinet_core::backend_client::PublishLiveItem;
use test_cabinet_core::publish_job_api::{PublishResult, PublishState};
use test_cabinet_core::{BackendClient, HttpBackendClient, Writeup, parse_writeup};

use crate::cli::{PublishArgs, ReviewArgs};
use crate::config;

/// `tcab review` — submit a review (from a locally authored `writeup.md`) for a
/// stored run, attributed to the logged-in account.
pub async fn review(args: ReviewArgs) -> Result<()> {
    let writeup_path = args
        .writeup
        .clone()
        .unwrap_or_else(|| PathBuf::from("writeup.md"));
    let writeup = load_writeup_at(&writeup_path)
        .map_err(|reason| anyhow::anyhow!("{reason}"))
        .context("a review requires a writeup")?;

    let client = backend_client()?;
    client
        .submit_review(&args.run_id, &writeup)
        .await
        .with_context(|| format!("submitting review for run {}", args.run_id))?;
    println!(
        "Submitted review for {} ({}).",
        args.run_id,
        writeup
            .overall_rating()
            .map(|r| r.as_str())
            .unwrap_or("unrated")
    );
    Ok(())
}

/// `tcab publish` — the solo path: self-review + publish each run. The whole
/// batch's reviews are gated up front so a sweep is never left half-published when
/// a missing writeup is discovered.
pub async fn publish(args: PublishArgs) -> Result<()> {
    // Gate every run's writeup before submitting anything. The operator authors a
    // writeup per run locally as `<run-id>.md` in the working directory.
    let mut writeups = Vec::with_capacity(args.run_ids.len());
    let mut missing = Vec::new();
    for run_id in &args.run_ids {
        let path = writeup_path_for(run_id);
        match load_writeup_at(&path) {
            Ok(writeup) => writeups.push(writeup),
            Err(reason) => missing.push((run_id.clone(), reason)),
        }
    }
    if !missing.is_empty() {
        eprintln!(
            "Refusing to publish: {} run(s) lack a review.",
            missing.len()
        );
        for (id, reason) in &missing {
            eprintln!("  {id} — {reason}");
        }
        bail!(
            "every run must have a `<run-id>.md` writeup with a rating in the working directory; \
             author the missing reviews and retry"
        );
    }

    if args.dry_run {
        println!("tcab publish --dry-run: {} run(s)", args.run_ids.len());
        for (run_id, writeup) in args.run_ids.iter().zip(&writeups) {
            print_plan(run_id, writeup);
        }
        println!("\nNothing was reviewed or published.");
        return Ok(());
    }

    let client = backend_client()?;
    println!("tcab publish: {} run(s) -> backend", args.run_ids.len());
    let mut failures = 0usize;
    for (run_id, writeup) in args.run_ids.iter().zip(&writeups) {
        if let Err(err) = publish_one(&client, run_id, writeup).await {
            eprintln!("  {run_id} — failed: {err:#}");
            failures += 1;
        }
    }
    if failures > 0 {
        bail!(
            "{failures} of {} run(s) failed to publish",
            args.run_ids.len()
        );
    }
    Ok(())
}

/// Self-review then publish one run, observing the asynchronous release over its
/// live stream. The backend now only *enqueues* the publish; the gh/wrangler
/// release runs in a `tcab-publisher` Job and reports progress + a terminal result
/// over `GET /publish-jobs/{id}/live`, which this subscribes to and prints until
/// the release finishes — never polling.
async fn publish_one(client: &HttpBackendClient, run_id: &str, writeup: &Writeup) -> Result<()> {
    // self-review, then the publish gate (the backend refuses a run with zero
    // reviews). The record and its artifacts were pushed by the driver.
    client
        .submit_review(run_id, writeup)
        .await
        .with_context(|| format!("reviewing run {run_id}"))?;
    let ack = client
        .publish_run(run_id)
        .await
        .with_context(|| format!("enqueuing the publish for run {run_id}"))?;
    println!("  {run_id} — publishing (job {})", ack.publish_job_id);

    // Subscribe to the live stream: print each progress line and capture the
    // terminal result. The stream closes once the publisher reports the outcome.
    let mut terminal: Option<PublishResult> = None;
    let mut on_item = |item: PublishLiveItem| match item {
        PublishLiveItem::Progress(progress) => println!("    {}", progress.message),
        PublishLiveItem::Result(result) => terminal = Some(result),
    };
    client
        .watch_publish_job(&ack.publish_job_id, &mut on_item)
        .await
        .with_context(|| format!("watching the publish of run {run_id}"))?;

    // The stream closes only after the terminal result; its absence means the watch
    // ended early (a dropped connection), which is a failure to observe the publish.
    let result = terminal.with_context(|| {
        format!(
            "the publish stream for run {run_id} ended before reporting a result — \
             re-run to observe it to completion"
        )
    })?;
    report_result(run_id, &result)
}

/// Render a terminal [`PublishResult`] for one run: on success, print the produced
/// source-repo and playable-build links; on failure, return an error carrying the
/// publisher's reason so the batch surfaces it and exits non-zero.
fn report_result(run_id: &str, result: &PublishResult) -> Result<()> {
    match result.state {
        PublishState::Succeeded => {
            println!("  {run_id} — published");
            match &result.source_repo {
                Some(url) => println!("    source: {url}"),
                None => println!("    source: (no source repo — asset generation)"),
            }
            match &result.playable_build {
                Some(url) => println!("    build:  {url}"),
                None => println!("    build:  (no static build deployed)"),
            }
            Ok(())
        }
        PublishState::Failed => {
            let detail = result
                .detail
                .as_deref()
                .unwrap_or("the publish did not complete");
            bail!("{detail}")
        }
    }
}

/// Build an [`HttpBackendClient`] for the configured backend, carrying the stored
/// login token. Errors clearly when the backend URL or login is missing.
fn backend_client() -> Result<HttpBackendClient> {
    let backend = config::backend_url().context(
        "TCAB_BACKEND_URL is not set; set it to the backend's address (for example \
         http://127.0.0.1:8787)",
    )?;
    let token = config::require_token()?;
    Ok(HttpBackendClient::new(backend).with_token(Some(token)))
}

/// The `<run-id>.md` writeup path in the working directory for a publish.
fn writeup_path_for(run_id: &str) -> PathBuf {
    PathBuf::from(format!("{run_id}.md"))
}

/// Load and validate a review from a `writeup.md` path, returning a short
/// user-facing reason when it is absent or malformed.
fn load_writeup_at(path: &Path) -> Result<Writeup, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("no writeup ({})", path.display()));
        }
        Err(err) => return Err(format!("could not read {}: {err}", path.display())),
    };
    parse_writeup(&text).map_err(|err| err.to_string())
}

/// Print the planned review + publish for one run (the `--dry-run` line).
fn print_plan(run_id: &str, writeup: &Writeup) {
    println!("  {run_id}");
    let overall = writeup
        .overall_rating()
        .map(|rating| rating.as_str())
        .unwrap_or("—");
    let per_domain = writeup
        .ratings
        .iter()
        .map(|domain| format!("{}={}", domain.domain, domain.rating.as_str()))
        .collect::<Vec<_>>()
        .join(", ");
    println!("    rating: {overall} (worst of {per_domain})");
    println!("    action: submit self-review, then publish");
}
