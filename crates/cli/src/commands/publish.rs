//! `tcab publish` — publish one or more finished runs.

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use test_cabinet_core::{
    ArtifactCollection, GitHubPublisher, PublishConfig, PublishRequest, Publisher, RunRecord,
    SystemCommandRunner, Writeup, parse_writeup,
};

use crate::cli::PublishArgs;

/// Publish finished runs: create each run's private repository with a
/// manual-trigger Pages deploy, append its record to the gallery dataset, and
/// commit that change locally.
///
/// Publishing is idempotent and batch-capable, so a sweep's runs can be
/// published in a single invocation. Nothing is made public by this command:
/// the repositories are private, their builds deploy only when triggered by
/// hand, and the dataset commit is not pushed.
pub async fn execute(args: PublishArgs) -> anyhow::Result<()> {
    // Load every run record, locate the implementation collected beside it, and
    // load the hand-written review. A run cannot be published without a writeup
    // and a rating: gate the whole batch up front so a sweep is never half
    // published before a missing review is discovered.
    let mut records = Vec::with_capacity(args.run_records.len());
    let mut artifacts = Vec::with_capacity(args.run_records.len());
    let mut writeups = Vec::with_capacity(args.run_records.len());
    let mut missing = Vec::new();
    for path in &args.run_records {
        let record =
            load_record(path).with_context(|| format!("loading run record {}", path.display()))?;
        match load_writeup(path) {
            Ok(writeup) => writeups.push(writeup),
            Err(reason) => missing.push((record.id.clone(), reason)),
        }
        artifacts.push(ArtifactCollection {
            repo_path: implementation_dir(path),
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
        for (record, writeup) in records.iter().zip(&writeups) {
            print_plan(&config, record, writeup);
        }
        println!("\nNothing was created, pushed, or committed.");
        return Ok(());
    }

    println!(
        "tcab publish: {} run(s){}",
        records.len(),
        if args.force { " (forced)" } else { "" },
    );

    let publisher = GitHubPublisher::new(config, SystemCommandRunner);
    let requests: Vec<PublishRequest> = records
        .iter()
        .zip(&artifacts)
        .zip(&writeups)
        .map(|((record, artifacts), writeup)| PublishRequest {
            record,
            artifacts,
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
        println!("    build:  {}", outcome.playable_build);
    }

    print_go_live(publisher.config(), &records);
    Ok(())
}

fn load_record(path: &Path) -> anyhow::Result<RunRecord> {
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

/// A run record lives at `<run>/run-record.json`; its implementation is the
/// sibling `implementation/` directory the run collected.
fn implementation_dir(record_path: &Path) -> PathBuf {
    record_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("implementation")
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

fn print_plan(config: &PublishConfig, record: &RunRecord, writeup: &Writeup) {
    println!("  {}", record.id);
    println!("    rating: {}", writeup.rating.as_str());
    println!("    repo:   {}", config.repo_url(record));
    println!("    build:  {}", config.build_url(record));
}

/// Print the manual steps that actually make staged runs public: triggering each
/// per-run deploy workflow, then pushing the gallery dataset.
fn print_go_live(config: &PublishConfig, records: &[RunRecord]) {
    println!("\nStaged privately — nothing is public yet. To go live:");
    for record in records {
        println!(
            "  gh workflow run deploy.yml -R {}",
            config.repo_qualified(record)
        );
    }
    println!(
        "  git -C {} push   # publish the gallery dataset update",
        config.site_repo_root.display()
    );
}
