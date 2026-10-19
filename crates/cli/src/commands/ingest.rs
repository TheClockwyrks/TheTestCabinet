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
//! `--env <staging|prod>` targets a deployed environment instead, through its edge:
//! the request goes to the environment's origin under `/api` with the Access
//! service token, and asks the backend to refresh its checkout first, so the
//! backend's ingest sidecar brings `test-suites` and `cold-storage` to the tip of
//! the branch the environment ingests before the scan. `TCAB_BACKEND_URL`, when
//! set, names the backend in place of the origin, which is how a port-forwarded
//! backend is reached; that path presents the backend's own service token. An edge
//! that refuses the request (a redirect to its sign-in page, a `401` or a `403`)
//! fails the command; the redirect is not followed.

use anyhow::{Context, bail};
use test_cabinet_backend_client::{IngestMode, IngestProgress, ingest_body};

use crate::cli::{DeployEnv, IngestArgs};
use crate::config::{
    self, ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET, BACKEND_SERVICE_TOKEN, BACKEND_URL, Credentials,
};

/// Trigger an ingest scan and print the streamed progress feed as it arrives.
///
/// A whole-catalog scan renders every case's references server-side and takes
/// minutes, so the streamed feed is asked for rather than the single blocking JSON
/// answer: a line per version as it lands is the difference between progress and
/// what looks like a hang.
pub async fn execute(args: IngestArgs) -> anyhow::Result<()> {
    let credentials = Credentials::from_env()?;
    let target = target(args.env, config::backend_url(), &credentials)?;
    let scope = if args.targets.is_empty() {
        "the whole checkout".to_string()
    } else {
        args.targets.join(", ")
    };
    match args.env {
        Some(env) => println!(
            "tcab ingest: {scope} on {} via {}/ingest",
            env.as_str(),
            target.url
        ),
        None => println!("tcab ingest: {scope} via {}/ingest", target.url),
    }
    if target.refresh {
        println!("  refresh: the backend's checkout moves to the environment's branch tip first");
    }
    let mode = print_options(&args);

    let mut body = ingest_body(&args.targets, args.force, mode);
    body.refresh = target.refresh;
    let client = credentials.client(&target.url);
    let mut on_progress = |progress: &IngestProgress| print_progress(progress);
    // The client's error already names the ingest and the URL it was against, and
    // an edge refusal as the edge's, so no context is added over it.
    let summary = client.ingest(&body, &mut on_progress).await?;
    println!(
        "\ningested {} version(s), skipped {} ({} total)",
        summary.ingested, summary.skipped, summary.total,
    );
    Ok(())
}

/// Where an ingest goes and whether it asks for a refresh first.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Target {
    /// The backend's base URL.
    url: String,
    /// Whether the backend refreshes its checkout before the scan: a deployed
    /// environment's does, a local backend scans the checkout it was given.
    refresh: bool,
}

/// Resolve the ingest's target from `--env`, `TCAB_BACKEND_URL` and the
/// credentials, refusing a combination that could not succeed before any request
/// is made.
fn target(
    env: Option<DeployEnv>,
    backend_url: Option<String>,
    credentials: &Credentials,
) -> anyhow::Result<Target> {
    let Some(env) = env else {
        let url = backend_url.with_context(|| {
            format!(
                "{BACKEND_URL} is not set; set it to the backend's address (for example \
                 http://127.0.0.1:8787), or name a deployed environment with --env"
            )
        })?;
        return Ok(Target {
            url,
            refresh: false,
        });
    };
    let url = backend_url.unwrap_or_else(|| env.backend_url());
    let edge = edge_of(&url);
    if let Some(other) = edge.filter(|edge| *edge != env) {
        bail!(
            "{BACKEND_URL} is {url}, the {} environment's edge, but --env names {}; \
             unset it or name the environment it points at",
            other.as_str(),
            env.as_str()
        );
    }
    if edge.is_some() && !credentials.has_access_service_token() {
        bail!(
            "an ingest into {} crosses its edge with the Access service token: set \
             {ACCESS_CLIENT_ID} and {ACCESS_CLIENT_SECRET} (the environment's Key Vault \
             secrets cloudflare-access-client-id and cloudflare-access-client-secret)",
            env.as_str()
        );
    }
    if edge.is_none() && !credentials.has_backend_service_token() {
        bail!(
            "{BACKEND_URL} is {url}, which is not {}'s edge, so the ingest reaches the \
             backend directly and presents its service token: set {BACKEND_SERVICE_TOKEN}",
            env.as_str()
        );
    }
    Ok(Target { url, refresh: true })
}

/// The environment whose edge `url` addresses, if any.
fn edge_of(url: &str) -> Option<DeployEnv> {
    let host = host_of(url)?;
    [DeployEnv::Prod, DeployEnv::Staging]
        .into_iter()
        .find(|env| host_of(env.origin()).as_deref() == Some(host.as_str()))
}

/// The lower-cased host of an absolute `http(s)` URL, without its port.
fn host_of(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
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
/// The closing `done` line's counts are not printed here: the command's own summary
/// below the feed says the same thing, and saying it twice in two wordings reads as
/// two different answers. A prune the scan refused is printed, because nothing else
/// says it: it means a tree the backend read was empty, which is usually a
/// misconfigured root rather than a catalog anyone emptied.
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
        IngestProgress::Done { refused_prunes, .. } => {
            for refusal in refused_prunes {
                eprintln!("  prune refused: {refusal}");
            }
        }
        // Reported as it arrives so the feed reads in order; the scan's failure is
        // carried out of the call as the command's error.
        IngestProgress::Error { message } => eprintln!("  ingest error: {message}"),
        // A notice the scan continues after, such as the refresh's failed suites
        // update; it is printed as the backend words it.
        IngestProgress::Notice { message } => eprintln!("{message}"),
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
