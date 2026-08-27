//! `tcab review` / `tcab publish` — the run release lifecycle, against the backend.
//!
//! Runs no longer execute locally: a `tcab run` enqueues a run on the backend and
//! a per-run driver pod executes it, storing the produced record (and its
//! artifacts) on the backend's run store during the run. So this lifecycle operates
//! by **backend run id**, not by a local run directory:
//!
//! - **review** submits a review (from a locally authored `writeup.md`) for a
//!   produced run, attributed to the logged-in account. A run may carry many
//!   reviews, one per account. The writeup's frontmatter carries the review's
//!   `rating.<domain>` lines (functional, legacy runs) and/or the single run-wide
//!   `aesthetic: <tier>` line (validator-rated runs; the core [`Writeup`] parser
//!   still reads a legacy file's per-domain `aesthetic.<domain>` lines, collapsed
//!   to their worst tier). `review.<id>` verdict lines ride along as the review's
//!   checklist — on a validator-rated run they are the reviewer's **overrides** of
//!   individual validator verdicts (the points not listed keep the validators'
//!   verdicts), forwarded as submitted.
//! - **publish** is the solo convenience: self-review + publish gate in one step,
//!   for an operator reviewing their own run. A **legacy** run cannot be published
//!   without at least one review, so a missing writeup refuses the batch. A
//!   **validator-rated** run (see
//!   [`TestCaseVersion::validator_rated`](test_cabinet_core::test_case::TestCaseVersion::validator_rated))
//!   stands on its validator-decided functional rating and score, so it publishes
//!   without a self-review when no writeup is present — and with one, the
//!   self-review (the run-wide aesthetic tier, plus any verdict overrides) is
//!   submitted first.
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
        describe_ratings(&writeup)
    );
    Ok(())
}

/// `tcab publish` — the solo path: self-review + publish each run. The whole
/// batch's plans are gated up front so a sweep is never left half-published when
/// a missing writeup is discovered.
pub async fn publish(args: PublishArgs) -> Result<()> {
    // Plan every run before submitting anything. The operator authors a writeup
    // per run locally as `<run-id>.md` in the working directory; a validator-rated
    // run needs none. Deciding that needs the backend (the run's case version), so
    // the client is built lazily — a batch whose runs all carry writeups plans
    // without a round-trip, and `--dry-run` only reaches the backend when it must.
    // When the backend cannot be consulted (no `TCAB_BACKEND_URL`, unreachable), a
    // writeup-less run is refused like a legacy one — the familiar local refusal
    // listing, with the reason it could not be told apart — rather than aborting
    // the plan with a bare transport error.
    let mut client: Option<HttpBackendClient> = None;
    let mut plans = Vec::with_capacity(args.run_ids.len());
    let mut refused = Vec::new();
    for run_id in &args.run_ids {
        let path = writeup_path_for(run_id);
        match load_writeup_at(&path) {
            Ok(writeup) => plans.push(PublishPlan::SelfReview(writeup)),
            Err(WriteupLoadError::Missing(reason)) => {
                let decided = match &client {
                    Some(client) => run_is_validator_rated(client, run_id).await,
                    None => match backend_client() {
                        Ok(built) => run_is_validator_rated(client.insert(built), run_id).await,
                        Err(err) => Err(err),
                    },
                };
                match decided {
                    Ok(true) => plans.push(PublishPlan::WithoutReview),
                    Ok(false) => refused.push((run_id.clone(), reason)),
                    Err(err) => refused.push((
                        run_id.clone(),
                        format!(
                            "{reason}, and whether it is validator-rated could not be decided: \
                             {err:#}"
                        ),
                    )),
                }
            }
            Err(WriteupLoadError::Invalid(reason)) => refused.push((run_id.clone(), reason)),
        }
    }
    if !refused.is_empty() {
        eprintln!(
            "Refusing to publish: {} run(s) lack a review.",
            refused.len()
        );
        for (id, reason) in &refused {
            eprintln!("  {id} — {reason}");
        }
        bail!(
            "every legacy run must have a `<run-id>.md` writeup with a rating in the working \
             directory (only a validator-rated run publishes without one, which the backend \
             decides from the run's case version); author the missing reviews and retry"
        );
    }

    if args.dry_run {
        println!("tcab publish --dry-run: {} run(s)", args.run_ids.len());
        for (run_id, plan) in args.run_ids.iter().zip(&plans) {
            print_plan(run_id, plan);
        }
        println!("\nNothing was reviewed or published.");
        return Ok(());
    }

    let client = match client {
        Some(client) => client,
        None => backend_client()?,
    };
    println!("tcab publish: {} run(s) -> backend", args.run_ids.len());
    let mut failures = 0usize;
    for (run_id, plan) in args.run_ids.iter().zip(&plans) {
        if let Err(err) = publish_one(&client, run_id, plan).await {
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

/// What `tcab publish` will do for one run, decided up front for the whole batch.
#[derive(Debug, Clone, PartialEq)]
pub enum PublishPlan {
    /// Submit the operator's own review from the run's `<run-id>.md` writeup, then
    /// publish. The only plan for a legacy run.
    SelfReview(Writeup),
    /// Publish straight away: a validator-rated run with no writeup stands on its
    /// validator-decided functional rating and score, and can receive an aesthetic
    /// review later (or never).
    WithoutReview,
}

/// Whether a stored run is [validator-rated](test_cabinet_core::test_case::TestCaseVersion::validator_rated):
/// the run's subject names its case version, which the backend resolves with its
/// `engineFormat` flag.
async fn run_is_validator_rated(client: &HttpBackendClient, run_id: &str) -> Result<bool> {
    let run = client
        .read_run(run_id)
        .await
        .with_context(|| format!("reading run {run_id}"))?;
    let subject = &run.record.subject;
    let version = client
        .resolve_version(&subject.test_case_slug, &subject.test_case_version)
        .await
        .with_context(|| {
            format!(
                "resolving case version {}@{}",
                subject.test_case_slug, subject.test_case_version
            )
        })?;
    Ok(version.validator_rated())
}

/// Self-review then publish one run, observing the asynchronous release over its
/// live stream. The backend now only *enqueues* the publish; the gh/wrangler
/// release runs in a `tcab-publisher` Job and reports progress + a terminal result
/// over `GET /publish-jobs/{id}/live`, which this subscribes to and prints until
/// the release finishes — never polling.
async fn publish_one(client: &HttpBackendClient, run_id: &str, plan: &PublishPlan) -> Result<()> {
    // self-review (when planned), then the publish gate (the backend refuses a
    // legacy run with zero reviews; a validator-rated run needs none). The record
    // and its artifacts were pushed by the driver.
    match plan {
        PublishPlan::SelfReview(writeup) => {
            client
                .submit_review(run_id, writeup)
                .await
                .with_context(|| format!("reviewing run {run_id}"))?;
        }
        PublishPlan::WithoutReview => {
            println!(
                "  {run_id} — validator-rated and no `{run_id}.md` writeup: publishing without a self-review"
            );
        }
    }
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

/// Why a writeup could not be loaded, with a short user-facing reason. The two
/// cases matter separately to `tcab publish`: an absent writeup is fine on a
/// validator-rated run, a malformed one never is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteupLoadError {
    /// No file at the path.
    Missing(String),
    /// The file exists but could not be read or parsed as a writeup.
    Invalid(String),
}

impl std::fmt::Display for WriteupLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing(reason) | Self::Invalid(reason) => f.write_str(reason),
        }
    }
}

/// Load and validate a review from a `writeup.md` path.
fn load_writeup_at(path: &Path) -> Result<Writeup, WriteupLoadError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(WriteupLoadError::Missing(format!(
                "no writeup ({})",
                path.display()
            )));
        }
        Err(err) => {
            return Err(WriteupLoadError::Invalid(format!(
                "could not read {}: {err}",
                path.display()
            )));
        }
    };
    parse_writeup(&text).map_err(|err| WriteupLoadError::Invalid(err.to_string()))
}

/// Summarize a writeup's ratings for the terminal: the overall functional rating
/// (worst across `rating.<domain>`, with its per-domain breakdown — the
/// functional channel is still rated per domain on a legacy run) and/or the
/// run-wide aesthetic tier (one tier for the whole build, no breakdown);
/// `unrated` when the writeup carries neither (a checklist-only review).
pub fn describe_ratings(writeup: &Writeup) -> String {
    let mut parts = Vec::new();
    if let Some(overall) = writeup.overall_rating() {
        let per_domain = writeup
            .ratings
            .iter()
            .map(|domain| format!("{}={}", domain.domain, domain.rating.as_str()))
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!(
            "functional {} (worst of {per_domain})",
            overall.as_str()
        ));
    }
    if let Some(aesthetic) = writeup.aesthetic {
        parts.push(format!("aesthetic {}", aesthetic.as_str()));
    }
    if parts.is_empty() {
        "unrated".to_string()
    } else {
        parts.join("; ")
    }
}

/// The `--dry-run` lines for one run: what the plan does and, for a self-review,
/// the ratings it submits.
pub fn plan_lines(run_id: &str, plan: &PublishPlan) -> Vec<String> {
    match plan {
        PublishPlan::SelfReview(writeup) => vec![
            format!("  {run_id}"),
            format!("    review: {}", describe_ratings(writeup)),
            "    action: submit self-review, then publish".to_string(),
        ],
        PublishPlan::WithoutReview => vec![
            format!("  {run_id}"),
            format!("    review: none (validator-rated, no `{run_id}.md` writeup)"),
            "    action: publish without a self-review".to_string(),
        ],
    }
}

/// Print the planned review + publish for one run (the `--dry-run` lines).
fn print_plan(run_id: &str, plan: &PublishPlan) {
    for line in plan_lines(run_id, plan) {
        println!("{line}");
    }
}

#[cfg(test)]
#[path = "publish.test.rs"]
mod tests;
