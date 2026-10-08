//! `tcab ingest` — push a checkout into a backend's definition store.
//!
//! A backend serves definitions out of its own store rather than out of a
//! checkout, so an edit to a test case or a
//! [test suite](https://docs.testcabinet.ai/test-suites/overview/) is invisible
//! until the backend has scanned for it. This is the hand-driven way to ask,
//! against a bare-process backend or a port-forwarded cluster alike.
//!
//! `make -C deployments/local local-ingest` runs it with `--force` to fill a freshly
//! created local cluster, and `--changed` is the development loop's way to bring a
//! backend in line with the checkout from the command line.
//!
//! `--env <staging|prod>` targets a deployed environment instead, through the
//! invoke path [`test_cabinet_core::remote_backend`] defines: the backend pod's
//! ingest sidecar refreshes its checkout to the tip of the environment's ingest
//! branch, submodules included, and scans it.

use std::sync::Arc;

use anyhow::Context;
use test_cabinet_core::remote_backend::{
    AZ_LOGIN, AzLogin, RemoteBackend, SystemAzRunner, az_login, remote_target,
};
use test_cabinet_core::{HttpBackendClient, IngestMode, IngestProgress, IngestSummary};

use crate::cli::IngestArgs;
use crate::config;

/// Trigger an ingest scan and print the streamed progress feed as it arrives.
///
/// A whole-catalog scan renders every case's references server-side and takes
/// minutes, so the streamed feed is asked for rather than the single blocking JSON
/// answer: a line per version as it lands is the difference between progress and
/// what looks like a hang.
pub async fn execute(args: IngestArgs) -> anyhow::Result<()> {
    let scope = if args.targets.is_empty() {
        "the whole checkout".to_string()
    } else {
        args.targets.join(", ")
    };
    let summary = match &args.env {
        Some(env) => ingest_remote(&args, env, &scope).await?,
        None => ingest_local(&args, &scope).await?,
    };
    println!(
        "\ningested {} version(s), skipped {} ({} total)",
        summary.ingested, summary.skipped, summary.total,
    );
    Ok(())
}

/// Ingest into the backend at `TCAB_BACKEND_URL`.
async fn ingest_local(args: &IngestArgs, scope: &str) -> anyhow::Result<IngestSummary> {
    let backend = config::backend_url().context(
        "TCAB_BACKEND_URL is not set; set it to the backend's address (for example \
         http://127.0.0.1:8787), or name a deployed environment with --env",
    )?;
    println!("tcab ingest: {scope} via {backend}/ingest");
    let mode = print_options(args);

    // The ingest endpoint is open — definitions are gated at the network layer
    // rather than by an account — so the client carries no token.
    let client = HttpBackendClient::new(backend);
    let mut on_progress = |progress: &IngestProgress| print_progress(progress);
    // The core error already names the ingest and the backend it was against, so no
    // context is added over it.
    Ok(client
        .ingest(&args.targets, args.force, mode, &mut on_progress)
        .await?)
}

/// Refresh and ingest a deployed environment's backend through `az aks command
/// invoke`.
async fn ingest_remote(args: &IngestArgs, env: &str, scope: &str) -> anyhow::Result<IngestSummary> {
    let target = remote_target(env)
        .with_context(|| format!("there is no deployed environment `{env}`"))?
        .clone();
    let runner = Arc::new(SystemAzRunner::new());
    match az_login(runner.as_ref()).await {
        AzLogin::Authenticated { .. } => {}
        AzLogin::Unauthenticated { message } => {
            anyhow::bail!("`az` is not signed in ({message}); run `{AZ_LOGIN}` and try again")
        }
        AzLogin::Missing { message } => {
            anyhow::bail!("{message}; install the Azure CLI and run `{AZ_LOGIN}`")
        }
    }
    println!(
        "tcab ingest: {scope} on {}/{} (refreshing to origin/{})",
        target.cluster, target.namespace, target.ingest_branch
    );
    let mode = print_options(args);
    println!("  running through `az aks command invoke`; the feed is printed once it returns");
    println!();

    let backend = RemoteBackend::new(target, runner);
    let mut on_log = |line: &str| println!("  {line}");
    let mut on_progress = |progress: &IngestProgress| print_progress(progress);
    Ok(backend
        .ingest(
            &args.targets,
            args.force,
            mode,
            &mut on_log,
            &mut on_progress,
        )
        .await?)
}

/// Print the options the scan runs with, answering with its mode.
fn print_options(args: &IngestArgs) -> IngestMode {
    if args.force {
        println!("  force: overwriting versions the store already holds");
    }
    let mode = if args.changed {
        println!("  changed: ingesting only versions whose content differs from the store");
        IngestMode::Changed
    } else {
        IngestMode::Absent
    };
    println!();
    mode
}

/// Print one line of the progress feed.
///
/// The closing `done` line is not printed here: the command's own summary below the
/// feed says the same thing, and saying it twice in two wordings reads as two
/// different answers.
fn print_progress(progress: &IngestProgress) {
    match progress {
        IngestProgress::Start { total } => println!("scanning {total} test case version(s)…"),
        IngestProgress::Version {
            index,
            total,
            slug,
            version,
            ingested,
            rendered_references,
            reason,
            problem,
        } => {
            let state = version_state(
                *ingested,
                *rendered_references,
                reason.as_deref(),
                problem.as_deref(),
            );
            println!("  [{index}/{total}] {slug} {version} — {state}");
        }
        IngestProgress::Done { .. } => {}
        // Reported as it arrives so the feed reads in order; the scan's failure is
        // carried out of the call as the command's error.
        IngestProgress::Error { message } => eprintln!("  ingest error: {message}"),
    }
}

/// What happened to one version, as its progress line names it: how many reference
/// images an ingested version rendered, or why a skipped one was skipped. A skip the
/// backend gives no reason for is one a scan without `--changed` makes, which skips
/// every version the store already holds whatever its content. A version the backend
/// refused names the problem it was refused for.
fn version_state(
    ingested: bool,
    rendered_references: usize,
    reason: Option<&str>,
    problem: Option<&str>,
) -> String {
    if ingested {
        return format!("ingested ({rendered_references} reference image(s))");
    }
    if let Some(problem) = problem {
        return format!("refused: {problem}");
    }
    match reason {
        Some(reason) => format!("skipped: {reason}"),
        None => "skipped: already stored".to_string(),
    }
}

#[cfg(test)]
#[path = "ingest.test.rs"]
mod tests;
