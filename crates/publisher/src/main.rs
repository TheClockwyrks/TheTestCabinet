//! The `tcab-publisher` binary entrypoint.
//!
//! Resolves its configuration from the environment the dispatcher set, downloads the
//! reviewed run's source tree from the artifact service, performs the GitHub-repo +
//! Cloudflare Pages release (the same two steps a local `tcab publish` drives, via
//! [`test_cabinet_core::BackendPublisher`]) while streaming progress lines to the
//! backend, then reports the terminal [`PublishResult`] — carrying the produced links
//! on success or the reason on failure — and exits. There is no server and no flags;
//! everything arrives through `TCAB_*` env (see [`tcab_publisher::config`]).

use std::process::ExitCode;

use test_cabinet_core::{PublishResult, PublishState};

use tcab_publisher::client::PublishJobClient;
use tcab_publisher::config::Config;
use tcab_publisher::download::download_run_tree;
use tcab_publisher::publish::{ReleasedLinks, release};

#[tokio::main]
async fn main() -> ExitCode {
    // Initialize telemetry and hold the guard for the lifetime of `main`: on drop it
    // flushes any buffered spans/metrics/logs. With no OTLP endpoint configured this
    // installs only the fmt layer (stdout logging) and returns an inert guard — a
    // missing collector is never fatal. Mirrors the driver's `main`.
    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-publisher",
        env!("CARGO_PKG_VERSION"),
        "info,tcab_publisher=info",
    )) {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("telemetry initialization error: {err}");
            return ExitCode::FAILURE;
        }
    };

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("configuration error: {err}");
            return ExitCode::FAILURE;
        }
    };

    tracing::info!(
        backend = %config.backend_url,
        publish_job_id = %config.publish_job_id,
        run_id = %config.run_id,
        artifacts = %config.artifacts_url,
        "publisher releasing one run, streaming to the backend"
    );

    let client = PublishJobClient::new(
        config.backend_url.clone(),
        config.publish_job_id.clone(),
        config.publish_job_token.clone(),
    );

    match run(&config, &client).await {
        Ok(links) => {
            tracing::info!(
                run_id = %config.run_id,
                source_repo = ?links.source_repo,
                playable_build = ?links.playable_build,
                "release succeeded; reporting the terminal result"
            );
            let result = PublishResult {
                state: PublishState::Succeeded,
                source_repo: links.source_repo,
                playable_build: links.playable_build,
                detail: None,
            };
            // The terminal result is the must-land call: it is what flips the run
            // published and closes the live stream. If even this cannot be reported
            // the publish is effectively lost, so exit non-zero.
            if let Err(err) = client.post_result(&result).await {
                eprintln!("could not report the publish result to the backend: {err}");
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(detail) => {
            tracing::warn!(run_id = %config.run_id, %detail, "release failed; reporting failure");
            let result = PublishResult {
                state: PublishState::Failed,
                source_repo: None,
                playable_build: None,
                detail: Some(detail),
            };
            if let Err(err) = client.post_result(&result).await {
                eprintln!("could not report the publish failure to the backend: {err}");
            }
            // The publish failed: exit non-zero so the outcome is visible in the
            // Job's status as well as on the live stream.
            ExitCode::FAILURE
        }
    }
}

/// Download the run's source tree and release it, streaming a progress line before
/// and after each phase. Returns the produced links on success, or a human-readable
/// failure reason on any error — the caller turns either into the terminal
/// [`PublishResult`].
///
/// Progress lines are best-effort observation (relayed, never persisted), so a
/// failure to post one is logged and the release continues; only the download and
/// the release itself are load-bearing.
async fn run(config: &Config, client: &PublishJobClient) -> Result<ReleasedLinks, String> {
    progress(client, "downloading the run's source tree").await;
    let run_dir = download_run_tree(
        &config.artifacts_url,
        &config.run_id,
        &config.publish_job_id,
        &config.publish_job_token,
        &config.work_dir,
    )
    .await
    .map_err(|err| format!("downloading the run source tree: {err}"))?;

    progress(client, "releasing source and deploying the playable build").await;
    let links = release(&run_dir).await.map_err(|err| err.to_string())?;

    progress(client, "release complete").await;
    Ok(links)
}

/// Post one progress line, logging (but never failing on) a reporting error — the
/// release outcome does not depend on the line landing.
async fn progress(client: &PublishJobClient, message: &str) {
    if let Err(err) = client.post_progress(message).await {
        tracing::warn!(%message, error = %err, "could not stream a publish progress line");
    }
}
