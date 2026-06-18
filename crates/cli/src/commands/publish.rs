//! `tcab publish` — publish one or more finished runs.

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use test_cabinet_core::{
    ArtifactCollection, BackendPublisher, HttpBackendClient, PublishConfig, PublishRequest,
    Publisher, RunRecord, SystemCommandRunner, Writeup, implementation_dir, parse_writeup,
};

use crate::cli::PublishArgs;

/// Candidate static build output directories a run's implementation may produce.
const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

/// Publish finished runs: release each run's source to its own public GitHub
/// repository, deploy its playable build to Cloudflare Pages, and submit the
/// record + review + links to the backend (the system of record).
///
/// Publishing is idempotent and batch-capable, so a sweep's runs can be published
/// in a single invocation. A run cannot be published without a review: the whole
/// batch is gated up front so a sweep is never left half-published when a missing
/// writeup is discovered.
pub async fn execute(args: PublishArgs) -> anyhow::Result<()> {
    // Load every run record, locate the implementation collected beside it and any
    // built static output to deploy, and load the hand-written review. The review
    // gate runs over the whole batch before anything is released.
    let mut records = Vec::with_capacity(args.run_records.len());
    let mut artifacts = Vec::with_capacity(args.run_records.len());
    let mut build_dirs: Vec<Option<PathBuf>> = Vec::with_capacity(args.run_records.len());
    let mut writeups = Vec::with_capacity(args.run_records.len());
    let mut missing = Vec::new();
    for path in &args.run_records {
        let record =
            load_record(path).with_context(|| format!("loading run record {}", path.display()))?;
        match load_writeup(path) {
            Ok(writeup) => writeups.push(writeup),
            Err(reason) => missing.push((record.id.clone(), reason)),
        }
        let impl_dir = implementation_dir(path);
        build_dirs.push(find_build_output(&impl_dir));
        artifacts.push(ArtifactCollection {
            repo_path: impl_dir,
        });
        records.push(record);
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

    let config = PublishConfig::default();

    if args.dry_run {
        println!("tcab publish --dry-run: {} run(s)", records.len());
        for ((record, writeup), build_dir) in records.iter().zip(&writeups).zip(&build_dirs) {
            print_plan(&config, record, writeup, build_dir.as_deref());
        }
        println!("\nNothing was created, pushed, deployed, or submitted.");
        return Ok(());
    }

    let backend = backend_url().context(
        "publishing submits the run to the backend, but TCAB_BACKEND_URL is not set; \
         set it to the backend's address (for example http://127.0.0.1:8787)",
    )?;

    println!(
        "tcab publish: {} run(s){} -> backend {backend}",
        records.len(),
        if args.force { " (forced)" } else { "" },
    );

    let publisher =
        BackendPublisher::new(config, SystemCommandRunner, HttpBackendClient::new(backend));
    let requests: Vec<PublishRequest> = records
        .iter()
        .zip(&artifacts)
        .zip(&build_dirs)
        .zip(&writeups)
        .map(|(((record, artifacts), build_dir), writeup)| PublishRequest {
            record,
            artifacts,
            build_dir: build_dir.as_deref(),
            writeup,
        })
        .collect();

    let outcomes = publisher
        .publish_batch(&requests)
        .await
        .context("publishing runs")?;

    for (record, outcome) in records.iter().zip(&outcomes) {
        let state = if outcome.newly_published {
            "published"
        } else {
            "already published"
        };
        println!("  {} — {state}", record.id);
        println!("    source: {}", outcome.source_repo);
        match &outcome.playable_build {
            Some(url) => println!("    build:  {url}"),
            None => println!("    build:  (no static build deployed)"),
        }
    }

    Ok(())
}

fn load_record(path: &Path) -> anyhow::Result<RunRecord> {
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

/// Find a deployable static build output beside a run's implementation, if one
/// was already produced (the validator builds into `dist`/`build`/`out`). Returns
/// the first that exists, or `None` so the run is published without a build.
fn find_build_output(impl_dir: &Path) -> Option<PathBuf> {
    BUILD_OUTPUTS
        .iter()
        .map(|name| impl_dir.join(name))
        .find(|candidate| candidate.is_dir())
}

/// Load and validate a run's review from the `writeup.md` beside its record.
///
/// Returns a short, user-facing reason when the writeup is absent or malformed,
/// so the publish gate can list exactly what each unpublishable run is missing.
fn load_writeup(record_path: &Path) -> Result<Writeup, String> {
    let path = record_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("writeup.md");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!(
                "no writeup.md beside the record ({})",
                path.display()
            ));
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
    println!("    rating: {}", writeup.rating.as_str());
    println!("    repo:   {}", config.repo_url(record));
    match build_dir {
        Some(dir) => println!(
            "    build:  deploy {} to Cloudflare Pages project `{}` (branch {})",
            dir.display(),
            config.pages_project,
            record.id
        ),
        None => println!("    build:  (no static build output found; will publish without a build)"),
    }
}

/// The backend base URL `publish` submits runs to, from `TCAB_BACKEND_URL`.
/// `None` (or blank) means the backend is not configured.
fn backend_url() -> Option<String> {
    std::env::var("TCAB_BACKEND_URL")
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}
