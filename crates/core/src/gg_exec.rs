//! The **gg** execution branch: run The Test Cabinet's own harness *directly* in the
//! run container and ingest its first-party telemetry.
//!
//! gg is not a third-party CLI driven through the [`AgentHarness`](crate::harness)
//! trait and looped by an [orchestrator](crate::orchestrator) — it **is** the
//! executor (see the design docs under `gg/` in the documentation site). So a gg run
//! takes its own branch in [`RunEngine::execute`](crate::RunEngine::execute): it
//! reuses all the shared run infrastructure (image pull, container start, the
//! environment probe, and the test case's `init` step) but, in place of the harness
//! install / probe / `drive_orchestrator` span, it:
//!
//! 1. **installs the `gg` binary** into the container ([`GgInstall`]): a locally-built
//!    binary copied in for offline/CLI runs, or a versioned GitHub release downloaded
//!    at run time for the cluster — the same two-mode shape gg's
//!    [distribution](https://docs.testcabinet.ai/gg/overview/#installation--distribution)
//!    describes;
//! 2. **writes the [`GgInvocation`]** JSON the binary reads via `--config` (the
//!    session id, the seeded workspace, the rendered prompt, and the capability set);
//! 3. **launches `gg --config <path>`** and ingests its NDJSON
//!    [`GgTelemetryEvent`] stream line by line, bridging each event both
//!    **natively** ([`EventKind::Gg`]) and as a mapped, human-facing
//!    [event](crate::event::EventKind) so the existing console feed renders activity,
//!    while summing the per-turn `usage` deltas into the run's [`HarnessOutcome`].
//!
//! The one credential — `OPENROUTER_API_KEY` — is injected into the container by the
//! shared auth plumbing (gg's [registry entry](crate::harness_registry) declares it as
//! its `api_key_env`/`container_key_env`), never written into the invocation file.

use std::path::{Path, PathBuf};

use crate::RunRequest;
use crate::cancel::RunCancellation;
use crate::error::{Error, Result};
use crate::event::{EventKind, EventSink, HarnessEvent, SystemStage, SystemStatus};
use crate::exec_stream::HARNESS_IDLE_TIMEOUT;
use crate::execution::{
    ContainerHandle, ContainerRuntime, OutputSink, OutputStream, RawOutputLine,
};
use crate::gg::{GgInvocation, GgSessionSummary, GgTelemetryEvent, GgTelemetryKind};
use crate::harness::{HarnessOutcome, Usage};
use crate::metrics::TokenCounts;
use crate::orchestrator::write_container_file;

/// The slug gg's errors and timeouts are attributed to (its
/// [`HarnessSlug`](crate::run_record::HarnessSlug) rendered), so a gg failure reads
/// the same way a third-party harness failure does.
const GG_SLUG: &str = "gg";

/// The absolute in-container path the `gg` binary is installed to. Deliberately
/// **outside** [`WORKSPACE_DIR`](crate::execution::WORKSPACE_DIR) (`/work`) so it never
/// lands in the collected implementation artifact.
///
/// Defined in the shared [contract](crate::gg::BINARY_PATH) because the in-container gg
/// process has to know what it may not write underneath.
const GG_BINARY_PATH: &str = crate::gg::BINARY_PATH;

/// The absolute in-container path the [`GgInvocation`] JSON is written to, also
/// outside `/work` so it is not collected. `gg` reads it via `--config`.
const GG_INVOCATION_PATH: &str = "/tmp/gg-invocation.json";

/// The absolute in-container path of the **cancellation sentinel**: the file the host
/// creates to tell a running gg session that an operator killed the run. Named to gg in
/// the invocation ([`GgInvocation::cancel_file`]) so neither side hardcodes the other's
/// path, and kept outside `/work` for the same reason as the two above — a killed run's
/// collected tree must not carry the machinery that stopped it.
const GG_CANCEL_PATH: &str = "/tmp/gg-cancel";

/// How long a canceled gg session is given to wind down and exit on its own after the
/// sentinel is raised.
///
/// gg stops at a turn boundary, so the wind-down is bounded by whatever is in flight when
/// the kill lands — in practice one model call per running agent. Ten minutes covers a
/// slow provider with room to spare while still bounding a session that has stopped
/// responding altogether; past it the host stops waiting and keeps what it already has,
/// which costs only the session's epilogue (its summary and replay sidecar), never the
/// telemetry itself.
const GG_CANCEL_GRACE: std::time::Duration = std::time::Duration::from_secs(600);

/// Env override: an explicit host path to a locally-built `gg` binary to copy in.
/// Highest priority; when set to a missing path the run fails clearly rather than
/// silently falling back.
const ENV_BINARY: &str = "TCAB_GG_BINARY";

/// Env override: force the install strategy — `"local"` (require a local binary) or
/// `"release"` (download a GitHub release). Unset auto-detects (local if a build is
/// found, else release). This is how the cluster path pins release installs, matching
/// how the driver already selects its container runtime by configuration.
const ENV_INSTALL_MODE: &str = "TCAB_GG_INSTALL";

/// Env override: the gg release version to download in [release](GgInstall::Release)
/// mode. Defaults to this crate's version (the workspace version gg is built at).
const ENV_RELEASE_VERSION: &str = "TCAB_GG_RELEASE_VERSION";

/// Env override: the `owner/repo` the gg release is published under.
const ENV_RELEASE_REPO: &str = "TCAB_GG_RELEASE_REPO";

/// Env override: the release asset's target triple (defaults to the run host's).
const ENV_RELEASE_TARGET: &str = "TCAB_GG_RELEASE_TARGET";

/// The default `owner/repo` gg releases are published under.
const DEFAULT_RELEASE_REPO: &str = "TheClockwyrks/test-cabinet";

/// How the `gg` binary is put into the run container.
///
/// Two modes, matching gg's distribution story: a locally-built binary (offline, no
/// external resources — the fast local iteration path) copied in as bytes, or a
/// versioned GitHub release downloaded at run time (the cluster path, the same shape
/// as a third-party harness's install step but pulling our own release).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GgInstall {
    /// Copy a host-built binary into the container. The bytes are materialized as a
    /// [`ContainerFile`](crate::execution::ContainerFile) at container-start time
    /// (which uses a host-temp-file `cp`, so an arbitrarily large binary is handled —
    /// unlike an argv-embedded copy), so this variant carries the host path the engine
    /// reads to build that file.
    Local {
        /// The host path of the built `gg` binary.
        host_path: PathBuf,
        /// The absolute in-container path it is installed to.
        container_path: String,
    },
    /// Download a published GitHub release into the container at run time.
    Release {
        /// The `owner/repo` the release lives under.
        repo: String,
        /// The release version to fetch.
        version: String,
        /// The asset's target triple.
        target: String,
        /// The absolute in-container path it is downloaded to.
        container_path: String,
    },
}

impl GgInstall {
    /// The absolute in-container path the binary lives at once installed, for either
    /// mode — the path `gg --config` is invoked by.
    pub fn container_path(&self) -> &str {
        match self {
            GgInstall::Local { container_path, .. } => container_path,
            GgInstall::Release { container_path, .. } => container_path,
        }
    }
}

/// Resolve how gg will be installed from the process environment and filesystem.
///
/// See `resolve_install_with` for the resolution rules; this is the production
/// wiring (real env vars, real filesystem probes).
pub fn resolve_install() -> Result<GgInstall> {
    resolve_install_with(
        |key| std::env::var(key).ok(),
        |path| path.exists(),
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
    )
}

/// Pure resolution of the install strategy, with the environment and filesystem
/// injected so it is unit-testable without touching either.
///
/// Order:
/// 1. [`TCAB_GG_INSTALL`](ENV_INSTALL_MODE)`=release` forces a release download.
/// 2. An explicit [`TCAB_GG_BINARY`](ENV_BINARY) selects that local binary (and errors
///    if it does not exist — an explicit override that cannot be honored is a
///    misconfiguration, not a silent fallback).
/// 3. `TCAB_GG_INSTALL=local` requires *some* local binary (the override or a probed
///    default), erroring if none is found.
/// 4. Otherwise auto-detect: the first existing default build path wins; failing that,
///    a release download.
fn resolve_install_with(
    env: impl Fn(&str) -> Option<String>,
    exists: impl Fn(&Path) -> bool,
    default_version: &str,
    default_target_arch: &str,
) -> Result<GgInstall> {
    let mode = env(ENV_INSTALL_MODE)
        .map(|m| m.trim().to_ascii_lowercase())
        .filter(|m| !m.is_empty());
    let explicit_binary = env(ENV_BINARY).filter(|p| !p.trim().is_empty());

    let release = |env: &dyn Fn(&str) -> Option<String>| -> GgInstall {
        let version = env(ENV_RELEASE_VERSION)
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| default_version.to_string());
        let repo = env(ENV_RELEASE_REPO)
            .filter(|r| !r.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_RELEASE_REPO.to_string());
        // Default to the fully static musl target: gg is published and installed as a
        // static binary (see `.cargo/config.toml`'s `build-portable-gg` and
        // `scripts/build-gg-static.sh`) precisely so one asset runs across every
        // run-container image (glibc bookworm and the Ubuntu blender image alike). An
        // operator can override the triple via `TCAB_GG_RELEASE_TARGET`.
        let target = env(ENV_RELEASE_TARGET)
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| format!("{default_target_arch}-unknown-linux-musl"));
        GgInstall::Release {
            repo,
            version,
            target,
            container_path: GG_BINARY_PATH.to_string(),
        }
    };

    // Locate a local binary: the explicit override (which must exist) or the first
    // existing default build path.
    let locate_local = || -> Result<Option<PathBuf>> {
        if let Some(path) = &explicit_binary {
            let host = PathBuf::from(path);
            if exists(&host) {
                return Ok(Some(host));
            }
            return Err(Error::HarnessUnavailable {
                slug: GG_SLUG.to_string(),
                detail: format!(
                    "{ENV_BINARY} points at `{}`, which does not exist",
                    host.display()
                ),
            });
        }
        Ok(default_local_candidates()
            .into_iter()
            .find(|candidate| exists(candidate)))
    };

    match mode.as_deref() {
        Some("release") => Ok(release(&env)),
        Some("local") => {
            let host = locate_local()?.ok_or_else(|| Error::HarnessUnavailable {
                slug: GG_SLUG.to_string(),
                detail: format!(
                    "{ENV_INSTALL_MODE}=local was set but no gg binary was found \
                     (set {ENV_BINARY} or build gg)"
                ),
            })?;
            Ok(local(host))
        }
        _ => match locate_local()? {
            Some(host) => Ok(local(host)),
            None => Ok(release(&env)),
        },
    }
}

/// A [`GgInstall::Local`] at the installed binary path.
fn local(host_path: PathBuf) -> GgInstall {
    GgInstall::Local {
        host_path,
        container_path: GG_BINARY_PATH.to_string(),
    }
}

/// The default host paths a locally-built `gg` binary is looked for at, in priority
/// order. The workspace target directory is relocated to `/cargo-target/the-test-cabinet`
/// in this repo's dev container; a plain `./target` is the fallback for a stock layout.
fn default_local_candidates() -> Vec<PathBuf> {
    [
        // The canonical install path a deployment bakes the static-musl `gg` binary
        // into. The driver image places it here (see
        // `deployments/images/driver.Dockerfile`), so a Kubernetes run installs gg
        // LOCALLY — core, running in the driver pod, reads it from here and copies it
        // into the sandbox run pod — with no GitHub release or network egress. The
        // driver image also points `TCAB_GG_BINARY` at this path, so this candidate is
        // the belt-and-suspenders fallback that keeps the convention discoverable in code.
        "/usr/local/lib/tcab/gg",
        // The dev container's relocated workspace target dir, then a stock `./target`.
        "/cargo-target/the-test-cabinet/release/gg",
        "/cargo-target/the-test-cabinet/debug/gg",
        "target/release/gg",
        "target/debug/gg",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect()
}

/// Build the shell script that downloads a release binary into the container and marks
/// it executable. Pure and unit-tested so the URL and command shape are verified
/// without a published release.
fn release_download_command(repo: &str, version: &str, target: &str, dest: &str) -> String {
    let url = format!("https://github.com/{repo}/releases/download/gg-v{version}/gg-{target}");
    format!(
        "set -e\ncurl --fail --silent --show-error --location {url} --output {dest}\nchmod 0755 {dest}\n"
    )
}

/// Run the gg **execution branch** to completion against the started run container and
/// produce its [`HarnessOutcome`].
///
/// Reuses the already-started `handle`, `runtime`, and `events` sink from the
/// surrounding [`RunEngine::execute`](crate::RunEngine::execute), plus the resolved
/// `install`, the run's `request` (for its capability set), the rendered `base_prompt`,
/// the seeded `workspace_dir`, the run's `max_runtime` (which bounds the release
/// download), the `run_id` (used as the gg session id), the `provided_files` the test
/// case seeded (workspace-relative spec and reference paths, for the
/// [autoload-specifications](test_cabinet_core::gg::CAPABILITY_AUTOLOAD_SPECS)
/// capability), and the run's `events` sink.
///
/// The caller bounds this whole future by the run's maximum runtime exactly as a
/// third-party harness session is bounded.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_gg(
    runtime: &dyn ContainerRuntime,
    handle: &ContainerHandle,
    install: &GgInstall,
    request: &RunRequest,
    base_prompt: &str,
    workspace_dir: &str,
    provided_files: &[PathBuf],
    max_runtime: u64,
    run_id: &str,
    events: &mut dyn EventSink,
    cancel: &RunCancellation,
) -> Result<HarnessOutcome> {
    // 1. Ensure the binary is present. A `Local` install was already materialized into
    //    the container at start time (as a `ContainerFile`), so only a `Release` needs a
    //    run-time download. Bracket both with the install system events so the feed shows
    //    gg being set up, matching a third-party harness's install stage.
    events.emit(&HarnessEvent::system(
        SystemStage::InstallHarness,
        SystemStatus::Started,
    ));
    if let GgInstall::Release {
        repo,
        version,
        target,
        container_path,
    } = install
    {
        let script = release_download_command(repo, version, target, container_path);
        let command = vec!["sh".to_string(), "-c".to_string(), script];
        let download = runtime.exec(handle, &command);
        match tokio::time::timeout(std::time::Duration::from_secs(max_runtime), download).await {
            Ok(Ok(output)) if output.exit_code == 0 => {}
            Ok(Ok(output)) => {
                events.emit(&HarnessEvent::system(
                    SystemStage::InstallHarness,
                    SystemStatus::Failed,
                ));
                return Err(Error::HarnessInstall {
                    slug: GG_SLUG.to_string(),
                    detail: format!(
                        "downloading the gg {version} release failed (exit {}): {}",
                        output.exit_code,
                        output.stderr.trim()
                    ),
                });
            }
            Ok(Err(err)) => {
                events.emit(&HarnessEvent::system(
                    SystemStage::InstallHarness,
                    SystemStatus::Failed,
                ));
                return Err(err);
            }
            Err(_elapsed) => {
                events.emit(&HarnessEvent::system(
                    SystemStage::InstallHarness,
                    SystemStatus::Failed,
                ));
                return Err(Error::HarnessInstallTimedOut {
                    slug: GG_SLUG.to_string(),
                    seconds: max_runtime,
                });
            }
        }
    }
    events.emit(&HarnessEvent::system(
        SystemStage::InstallHarness,
        SystemStatus::Completed,
    ));

    // 2. Write the invocation file gg reads via `--config`. Its capability set is the
    //    run's (validated present for a gg run); the credential is *not* in it — gg reads
    //    OPENROUTER_API_KEY from the container env the shared auth plumbing injected.
    let invocation = build_invocation(request, base_prompt, workspace_dir, provided_files, run_id)?;
    let json = serde_json::to_vec(&invocation)?;
    write_container_file(runtime, handle, GG_INVOCATION_PATH, &json, 0o600).await?;

    // 3. Query the installed binary's version for the run record. Best-effort: a run is
    //    still valid if the probe fails.
    let harness_version = gg_version(runtime, handle, install.container_path()).await;

    // 4. Launch gg and ingest its NDJSON telemetry line by line, bridging each event to
    //    the sink and summing usage/cost. The idle watchdog kills a gg that stops
    //    producing output for too long — a stalled provider request — exactly as it does
    //    a third-party harness session.
    let command = vec![
        install.container_path().to_string(),
        "--config".to_string(),
        GG_INVOCATION_PATH.to_string(),
    ];
    let mut sink = GgIngestSink::new(events);
    // Drive the session, racing it against an operator's kill. The race is scoped so the
    // stream future is dropped before `sink` is read below: whatever the outcome, every
    // line gg produced has already been folded into the sink and bridged onto the run's
    // event stream, so the accumulated usage, cost and summary are readable here even
    // when the session itself never returned.
    let drained = {
        let stream = runtime.exec_streamed(handle, &command, Some(HARNESS_IDLE_TIMEOUT), &mut sink);
        tokio::pin!(stream);
        tokio::select! {
            output = &mut stream => Drained::Exited(output?),
            () = cancel.canceled() => {
                stop_gg(runtime, handle).await;
                // Keep draining while gg winds down, so the epilogue it emits on the way
                // out — the per-slot rollups, the session summary, the replay sidecar —
                // lands on the stream like any other telemetry. Past the grace the host
                // stops waiting and keeps what it has; the sink is complete either way.
                let _ = tokio::time::timeout(GG_CANCEL_GRACE, &mut stream).await;
                Drained::Canceled
            }
        }
    };
    let GgIngestSink {
        tokens,
        reported_cost,
        raw_output,
        translated_events,
        terminal_status,
        gg_summary,
        ..
    } = sink;

    // A canceled session is not classified: nothing it did or did not do is a fault to
    // report, and its exit code says only how far the wind-down got. Hand back everything
    // accumulated, marked canceled, so the engine finishes the run through its ordinary
    // post-session path and the killed run keeps the tree, the metrics and the telemetry
    // it earned rather than vanishing.
    let output = match drained {
        Drained::Exited(output) => output,
        Drained::Canceled => {
            return Ok(HarnessOutcome {
                usage: Usage { tokens },
                harness_version,
                reported_cost,
                raw_output,
                translated_events,
                // Present when gg wound down inside the grace and emitted its summary on
                // the way out; absent when it did not, in which case the same figures
                // remain derivable from the persisted event stream.
                gg_summary,
                tool_calls: std::collections::BTreeMap::new(),
                canceled: true,
            });
        }
    };

    // 5. Classify the result.
    //    - The idle watchdog firing means gg stopped responding: it is hung, not failed.
    //    - A non-zero exit means no session ran against a working model: a launch fatal
    //      (a missing credential on a live binding, a malformed config —
    //      SessionEnded{status:"error"}), or a credential the provider *rejected*
    //      mid-flight (SessionEnded{status:"auth_error"}). Both are our fault, not the
    //      model's, so both are a harness error rather than a scoreable run.
    //    - Exit 0 means a session ran, *including* a mid-session `model_error` (carried
    //      in the stream, exit 0). Such a run is **not** a clean success — the failure is
    //      surfaced as an Error event and the produced (likely empty) tree fails
    //      validation downstream — but it does complete, so it flows on to be collected
    //      and scored exactly as a third-party model error does. We do not fabricate
    //      success, and we do not discard a run the model merely failed mid-way.
    if output.idle_timed_out {
        return Err(Error::HarnessHung {
            slug: GG_SLUG.to_string(),
            seconds: HARNESS_IDLE_TIMEOUT.as_secs(),
        });
    }
    if output.exit_code != 0 {
        let status = terminal_status
            .map(|s| format!(" (session ended `{s}`)"))
            .unwrap_or_default();
        return Err(Error::HarnessInvocation {
            slug: GG_SLUG.to_string(),
            detail: format!("gg exited with code {}{status}", output.exit_code),
        });
    }

    Ok(HarnessOutcome {
        usage: Usage { tokens },
        harness_version,
        reported_cost,
        raw_output,
        translated_events,
        // The aggregatable session summary the gg binary computed and emitted just
        // before it ended, lifted onto the run record so aggregate queries need not
        // re-parse the event stream. `None` if the run ended before emitting one.
        gg_summary,
        // gg accounts its own per-tool activity through its telemetry (see
        // `ggToolBreakdown`), not the third-party event parser, so the parser-side
        // tally is empty for a gg run.
        tool_calls: std::collections::BTreeMap::new(),
        // This session ended on its own terms; the cancellation path returns above.
        canceled: false,
    })
}

/// How a gg session's output stream ended.
enum Drained {
    /// gg exited on its own; the [`ExecOutput`](crate::execution::ExecOutput) describes how.
    Exited(crate::execution::ExecOutput),
    /// An operator killed the run — whether or not gg then wound down and exited inside
    /// [`GG_CANCEL_GRACE`]. Nothing is carried because nothing about *how* the wind-down
    /// went changes the outcome: the exit status of a session that was told to stop is not
    /// a fault to classify, and the ingest sink already holds everything gg produced
    /// either way.
    Canceled,
}

/// Ask a running gg session to stop, by raising the
/// [cancellation sentinel](GG_CANCEL_PATH) it watches for at each agent's turn boundary.
///
/// Best-effort and deliberately quiet: the run is already ending, and a sentinel that
/// cannot be written costs only the session's epilogue — the host still keeps every event
/// gg streamed, and the sandbox teardown stops the process regardless. Failing the run
/// over it would throw away the very data the cancellation exists to preserve.
async fn stop_gg(runtime: &dyn ContainerRuntime, handle: &ContainerHandle) {
    if let Err(err) = write_container_file(runtime, handle, GG_CANCEL_PATH, b"", 0o600).await {
        tracing::warn!(
            error = %err,
            "could not raise the gg cancellation sentinel; the session will stop with the sandbox",
        );
    }
}

/// Construct the [`GgInvocation`] for this run: the run id as the session id, the
/// seeded workspace, the rendered prompt, the run's validated capability set, the
/// [per-model context windows](GgInvocation::model_windows) the launch resolved from the
/// model catalog (gg holds no model table of its own, so what it is told here is all it
/// knows about the models it runs), and the [test-case-provided
/// files](GgInvocation::provided_files) the autoload-specifications capability injects.
fn build_invocation(
    request: &RunRequest,
    base_prompt: &str,
    workspace_dir: &str,
    provided_files: &[PathBuf],
    run_id: &str,
) -> Result<GgInvocation> {
    Ok(GgInvocation {
        // Tell gg where to look for the host's kill. Always set: every run the engine
        // drives is cancelable, and a run nobody cancels simply never sees the file.
        cancel_file: Some(std::path::PathBuf::from(GG_CANCEL_PATH)),
        session_id: run_id.to_string(),
        workspace_dir: PathBuf::from(workspace_dir),
        prompt: base_prompt.to_string(),
        capability_set: request.gg_capability_set()?.clone(),
        model_windows: request.gg_model_windows.clone(),
        model_modalities: request.gg_model_modalities.clone(),
        provided_files: provided_files.to_vec(),
    })
}

/// Best-effort query of the installed gg binary's `--version`, returning the reported
/// version string (the last whitespace-delimited token of e.g. `gg 0.7.0`) or `None`.
async fn gg_version(
    runtime: &dyn ContainerRuntime,
    handle: &ContainerHandle,
    binary: &str,
) -> Option<String> {
    let command = vec![binary.to_string(), "--version".to_string()];
    let output = runtime.exec(handle, &command).await.ok()?;
    if output.exit_code != 0 {
        return None;
    }
    output
        .stdout
        .split_whitespace()
        .next_back()
        .map(str::to_string)
        .filter(|v| !v.is_empty())
}

/// The [`OutputSink`] that ingests gg's NDJSON telemetry as it streams: it records the
/// raw stream, bridges each telemetry event to the run's [`EventSink`] (natively and as
/// a mapped human-facing event), and accumulates usage/cost and the terminal status.
struct GgIngestSink<'a> {
    /// The run's live event sink, driven with the bridged events.
    events: &'a mut dyn EventSink,
    /// The running total of per-turn usage deltas.
    tokens: TokenCounts,
    /// The running total of per-turn cost deltas, when any turn reported one.
    reported_cost: Option<f64>,
    /// Every raw stream line in arrival order, for the run record's raw stream.
    raw_output: Vec<RawOutputLine>,
    /// The normalized events emitted, for the run record's translated stream.
    translated_events: Vec<HarnessEvent>,
    /// The status the last `session_ended` event reported, when one was seen.
    terminal_status: Option<String>,
    /// The aggregatable session summary the last `session_summary` event carried, when one
    /// was seen — lifted onto the run record so result aggregation need not re-parse the
    /// event stream. gg emits it once, just before `session_ended`.
    gg_summary: Option<GgSessionSummary>,
}

impl<'a> GgIngestSink<'a> {
    fn new(events: &'a mut dyn EventSink) -> Self {
        Self {
            events,
            tokens: TokenCounts::default(),
            reported_cost: None,
            raw_output: Vec::new(),
            translated_events: Vec::new(),
            terminal_status: None,
            gg_summary: None,
        }
    }

    /// Emit one bridged event to the sink and record it for the run's translated stream.
    fn emit(&mut self, event: HarnessEvent) {
        self.events.emit(&event);
        self.translated_events.push(event);
    }

    /// Ingest one parsed gg telemetry event: fold usage/cost and the terminal status,
    /// then bridge it to normalized events.
    fn ingest_gg(&mut self, gg: GgTelemetryEvent) {
        match &gg.kind {
            // Per-turn usage events are incremental deltas consumers sum (there is no
            // total usage event; gg reports the final total only as a log line).
            GgTelemetryKind::Usage { tokens, cost, .. } => {
                self.tokens = self.tokens.plus(*tokens);
                if let Some(cost) = cost.and_then(|c| c.actual.or(c.comparable)) {
                    self.reported_cost = Some(self.reported_cost.unwrap_or(0.0) + cost);
                }
            }
            GgTelemetryKind::SessionSummary { summary } => {
                self.gg_summary = Some((**summary).clone());
            }
            GgTelemetryKind::SessionEnded { status } => {
                self.terminal_status = Some(status.clone());
            }
            _ => {}
        }
        for event in bridge(&gg) {
            self.emit(event);
        }
    }
}

impl OutputSink for GgIngestSink<'_> {
    fn on_line(&mut self, stream: OutputStream, line: &str) {
        self.raw_output.push(RawOutputLine {
            stream,
            line: line.to_string(),
        });
        match stream {
            OutputStream::Stdout => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return;
                }
                match serde_json::from_str::<GgTelemetryEvent>(trimmed) {
                    Ok(gg) => self.ingest_gg(gg),
                    // gg's stdout is strictly NDJSON telemetry; a line that does not
                    // parse is unexpected, so surface it as a warning rather than lose it.
                    Err(err) => {
                        let event = stamped(
                            None,
                            EventKind::Warning {
                                message: format!("unparseable gg telemetry line: {err}"),
                                code: None,
                            },
                        );
                        self.emit(event);
                    }
                }
            }
            // gg writes only pre-telemetry fatal diagnostics to stderr.
            OutputStream::Stderr => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return;
                }
                let event = stamped(
                    None,
                    EventKind::Warning {
                        message: trimmed.to_string(),
                        code: None,
                    },
                );
                self.emit(event);
            }
        }
    }
}

/// Bridge one gg telemetry event into normalized [`HarnessEvent`]s.
///
/// Every event yields a native [`EventKind::Gg`] carry (lossless — the full typed event
/// for a gg-aware console and the run record), and a *salient* event additionally yields
/// a mapped, human-facing event (an agent message, a command/write, a warning/error) so
/// a console that does not yet understand gg's stream still shows live activity. The
/// mapped event is emitted **before** the native carry so it reads first in the feed.
pub(crate) fn bridge(gg: &GgTelemetryEvent) -> Vec<HarnessEvent> {
    let mut events = Vec::new();
    if let Some(mapped) = human_facing(gg) {
        events.push(mapped);
    }
    events.push(stamped(
        gg.session_id.clone(),
        EventKind::Gg {
            event: Box::new(gg.clone()),
        },
    ));
    events
}

/// The mapped, human-facing event for a *salient* gg telemetry kind, or `None` for a
/// kind that carries no feed-worthy activity of its own (session/turn lifecycle, usage
/// accounting) — those still flow through the native [`EventKind::Gg`] carry.
fn human_facing(gg: &GgTelemetryEvent) -> Option<HarnessEvent> {
    let kind = match &gg.kind {
        GgTelemetryKind::AssistantMessage { text } if !text.trim().is_empty() => EventKind::Agent {
            message: text.clone(),
        },
        GgTelemetryKind::ToolCall { name, args } => tool_call_kind(name, args),
        GgTelemetryKind::ToolResult {
            name,
            ok: false,
            summary,
        } => EventKind::Warning {
            message: match summary {
                Some(summary) => format!("gg tool `{name}` failed: {summary}"),
                None => format!("gg tool `{name}` failed"),
            },
            code: None,
        },
        GgTelemetryKind::Log { level, message } => match level.to_ascii_lowercase().as_str() {
            "error" => EventKind::Error {
                message: message.clone(),
                code: None,
            },
            "warn" | "warning" => EventKind::Warning {
                message: message.clone(),
                code: None,
            },
            // An info/debug log has no natural mapped kind; the native carry keeps it.
            _ => return None,
        },
        // A code-shaped run's conclusion lives here and nowhere else: under responses-as-code
        // every assistant message is a program, so without this the feed shows a reviewer N pages
        // of TypeScript and no answer. Only the finishing turn carries a summary, so this maps at
        // most once per run.
        GgTelemetryKind::CodeExecution {
            finished: Some(summary),
            ..
        } if !summary.trim().is_empty() => EventKind::Agent {
            message: summary.clone(),
        },
        _ => return None,
    };
    Some(stamped(gg.session_id.clone(), kind))
}

/// Map a gg tool call to the normalized [`EventKind`] the existing feed renders. gg's
/// Phase 0 tools are `shell`, `read_file`, `write_file`, and `list_dir`; any other tool
/// maps to a generic command so it still shows as activity.
fn tool_call_kind(name: &str, args: &serde_json::Value) -> EventKind {
    let string_arg = |key: &str| args.get(key).and_then(|v| v.as_str()).map(str::to_string);
    match name {
        "shell" => EventKind::Command {
            command: string_arg("command").unwrap_or_else(|| name.to_string()),
            working_directory: None,
            exit_code: None,
            is_success: None,
        },
        "write_file" => EventKind::Write {
            path: string_arg("path").unwrap_or_default(),
            start_line: None,
            end_line: None,
            is_success: None,
        },
        "read_file" => EventKind::Read {
            path: string_arg("path").unwrap_or_default(),
            start_line: None,
            end_line: None,
            is_success: None,
        },
        "list_dir" => EventKind::List {
            path: string_arg("path"),
            is_success: None,
        },
        other => EventKind::Command {
            command: match string_arg("command") {
                Some(command) => format!("{other}: {command}"),
                None => other.to_string(),
            },
            working_directory: None,
            exit_code: None,
            is_success: None,
        },
    }
}

/// Stamp a normalized kind with the current time and the given session id.
///
/// gg events carry an ISO-8601 timestamp of their own, but a [`HarnessEvent`]'s
/// timestamp is *when the testing harness observed it*, which for an ingested stream is
/// now — the same convention the [`EventParser`](crate::event::EventParser) uses. The
/// gg event's own timestamp is preserved inside the native [`EventKind::Gg`] carry.
fn stamped(session_id: Option<String>, kind: EventKind) -> HarnessEvent {
    HarnessEvent {
        timestamp: crate::event::now_timestamp(),
        session_id,
        kind,
    }
}

#[cfg(test)]
#[path = "gg_exec.test.rs"]
mod tests;
