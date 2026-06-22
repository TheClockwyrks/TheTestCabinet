//! `tcab push` / `tcab review` / `tcab publish` — the run release lifecycle.
//!
//! - **push** releases a finished run's source to its own public GitHub repo,
//!   deploys its playable build to Cloudflare Pages, and stores the record on the
//!   backend — **without** a review. The run is private (not in the public
//!   gallery) but playable, so anyone can review it.
//! - **review** submits a review (from the `writeup.md` beside the record) for an
//!   already-pushed run, attributed to the logged-in account. A run may carry
//!   many reviews.
//! - **publish** is the solo convenience: push + self-review + publish gate in
//!   one step, for an operator reviewing their own run. A run cannot be published
//!   without at least one review.
//!
//! All three require a logged-in account (`tcab login`) and `TCAB_BACKEND_URL`.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use test_cabinet_core::{
    ArtifactCollection, BackendClient, BackendPublisher, HarnessEvent, HttpBackendClient,
    PublishConfig, Publisher, PushRequest, RunRecord, SystemCommandRunner, Writeup,
    implementation_dir, parse_writeup, read_event_log,
};

use crate::cli::{PublishArgs, PushArgs, ReviewArgs};
use crate::config;

/// Candidate static build output directories a run's implementation may produce.
const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

/// A loaded run: its record, the collected implementation, any deployable build
/// output, and the recorded event log.
struct LoadedRun {
    record: RunRecord,
    artifacts: ArtifactCollection,
    build_dir: Option<PathBuf>,
    events: Vec<HarnessEvent>,
}

/// `tcab push` — release each run's source + build and store the record on the
/// backend, without a review.
pub async fn push(args: PushArgs) -> Result<()> {
    let runs = load_runs(&args.run_records)?;
    let publisher = publisher()?;

    println!("tcab push: {} run(s) -> backend", runs.len());
    for run in &runs {
        let request = PushRequest {
            record: &run.record,
            artifacts: &run.artifacts,
            build_dir: run.build_dir.as_deref(),
            events: &run.events,
        };
        let outcome = publisher
            .push(&request)
            .await
            .with_context(|| format!("pushing run {}", run.record.id))?;
        let state = if outcome.newly_pushed {
            "pushed"
        } else {
            "already stored"
        };
        println!("  {} — {state}", run.record.id);
        match &outcome.source_repo {
            Some(url) => println!("    source: {url}"),
            None => println!("    source: (no source repo — asset generation)"),
        }
        match &outcome.playable_build {
            Some(url) => println!("    build:  {url}"),
            None => println!("    build:  (no static build deployed)"),
        }
    }
    println!("\nReview a pushed run with `tcab review`, then `tcab publish` to make it public.");
    Ok(())
}

/// `tcab review` — submit a review (from the run's `writeup.md`) for a pushed
/// run, attributed to the logged-in account.
pub async fn review(args: ReviewArgs) -> Result<()> {
    let record = load_record(&args.run_record)
        .with_context(|| format!("loading run record {}", args.run_record.display()))?;
    let writeup_path = args.writeup.clone().unwrap_or_else(|| {
        args.run_record
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("writeup.md")
    });
    let writeup = load_writeup_at(&writeup_path)
        .map_err(|reason| anyhow::anyhow!("{reason}"))
        .context("a review requires a writeup")?;

    let client = backend_client()?;
    client
        .submit_review(&record.id, &writeup)
        .await
        .with_context(|| format!("submitting review for run {}", record.id))?;
    println!(
        "Submitted review for {} ({}).",
        record.id,
        writeup
            .overall_rating()
            .map(|r| r.as_str())
            .unwrap_or("unrated")
    );
    Ok(())
}

/// `tcab publish` — the solo path: push + self-review + publish each run. The
/// whole batch's reviews are gated up front so a sweep is never left
/// half-published when a missing writeup is discovered.
pub async fn publish(args: PublishArgs) -> Result<()> {
    let runs = load_runs(&args.run_records)?;

    // Gate every run's review before releasing anything.
    let mut writeups = Vec::with_capacity(runs.len());
    let mut missing = Vec::new();
    for run in &runs {
        let path = writeup_path_for(&run.record_path_hint());
        match load_writeup_at(&path) {
            Ok(writeup) => writeups.push(writeup),
            Err(reason) => missing.push((run.record.id.clone(), reason)),
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
            "every run must have a `writeup.md` with a rating beside its record; \
             author the missing reviews and retry"
        );
    }

    if args.dry_run {
        let config = PublishConfig::from_env();
        println!("tcab publish --dry-run: {} run(s)", runs.len());
        for (run, writeup) in runs.iter().zip(&writeups) {
            print_plan(&config, &run.record, writeup, run.build_dir.as_deref());
        }
        println!("\nNothing was created, pushed, deployed, reviewed, or published.");
        return Ok(());
    }

    let publisher = publisher()?;
    println!("tcab publish: {} run(s) -> backend", runs.len());
    for (run, writeup) in runs.iter().zip(&writeups) {
        let request = PushRequest {
            record: &run.record,
            artifacts: &run.artifacts,
            build_dir: run.build_dir.as_deref(),
            events: &run.events,
        };
        // push (release + store), then self-review, then publish gate.
        let outcome = publisher
            .push(&request)
            .await
            .with_context(|| format!("pushing run {}", run.record.id))?;
        publisher
            .backend()
            .submit_review(&run.record.id, writeup)
            .await
            .with_context(|| format!("reviewing run {}", run.record.id))?;
        let ack = publisher
            .backend()
            .publish_run(&run.record.id)
            .await
            .with_context(|| format!("publishing run {}", run.record.id))?;

        let state = if ack.newly_published {
            "published"
        } else {
            "already published"
        };
        println!("  {} — {state}", run.record.id);
        match &outcome.source_repo {
            Some(url) => println!("    source: {url}"),
            None => println!("    source: (no source repo — asset generation)"),
        }
        match &outcome.playable_build {
            Some(url) => println!("    build:  {url}"),
            None => println!("    build:  (no static build deployed)"),
        }
    }
    Ok(())
}

impl LoadedRun {
    /// The directory the run's record (and its `writeup.md`) live in.
    fn record_path_hint(&self) -> PathBuf {
        self.artifacts
            .repo_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    }
}

/// Load every run record, its implementation, build output, and event log.
fn load_runs(paths: &[PathBuf]) -> Result<Vec<LoadedRun>> {
    let mut runs = Vec::with_capacity(paths.len());
    for path in paths {
        let record =
            load_record(path).with_context(|| format!("loading run record {}", path.display()))?;
        let impl_dir = implementation_dir(path);
        let build_dir = find_build_output(&impl_dir);
        let run_dir = path.parent().unwrap_or_else(|| Path::new("."));
        let events = read_event_log(run_dir);
        runs.push(LoadedRun {
            record,
            artifacts: ArtifactCollection {
                repo_path: impl_dir,
            },
            build_dir,
            events,
        });
    }
    Ok(runs)
}

/// Build a [`BackendPublisher`] (operator release + backend client) authenticated
/// with the stored login token.
fn publisher() -> Result<BackendPublisher<SystemCommandRunner, HttpBackendClient>> {
    Ok(BackendPublisher::new(
        PublishConfig::from_env(),
        SystemCommandRunner,
        backend_client()?,
    ))
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

fn load_record(path: &Path) -> Result<RunRecord> {
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

/// Find a deployable static build output beside a run's implementation, if one
/// was already produced (the validator builds into `dist`/`build`/`out`).
fn find_build_output(impl_dir: &Path) -> Option<PathBuf> {
    BUILD_OUTPUTS
        .iter()
        .map(|name| impl_dir.join(name))
        .find(|candidate| candidate.is_dir())
}

/// The `writeup.md` path beside a record directory.
fn writeup_path_for(record_dir: &Path) -> PathBuf {
    record_dir.join("writeup.md")
}

/// Load and validate a review from a `writeup.md` path, returning a short
/// user-facing reason when it is absent or malformed.
fn load_writeup_at(path: &Path) -> Result<Writeup, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("no writeup.md ({})", path.display()));
        }
        Err(err) => return Err(format!("could not read {}: {err}", path.display())),
    };
    parse_writeup(&text).map_err(|err| err.to_string())
}

fn print_plan(
    config: &PublishConfig,
    record: &RunRecord,
    writeup: &Writeup,
    build_dir: Option<&Path>,
) {
    println!("  {}", record.id);
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
    println!("    repo:   {}", config.repo_url(record));
    match build_dir {
        Some(dir) => println!(
            "    build:  deploy {} to Cloudflare Pages project `{}` (branch {})",
            dir.display(),
            config.pages_project,
            record.id
        ),
        None => {
            println!("    build:  (no static build output found; will publish without a build)")
        }
    }
}
