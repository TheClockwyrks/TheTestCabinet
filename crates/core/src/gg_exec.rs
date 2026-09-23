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
//! The first two are one function and the third is another, because the split is where
//! the run's session clock starts: installing gg is setup the run engine spends on the
//! model's behalf, exactly as a third-party harness's install is.
//!
//! The one credential — `OPENROUTER_API_KEY` — is injected into the container by the
//! shared auth plumbing (gg's [registry entry](crate::harness_registry) declares it as
//! its `api_key_env`/`container_key_env`), never written into the invocation file.

use std::collections::BTreeMap;
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
///
/// Case and surrounding whitespace are normalized away; set to anything else, the run **fails to
/// start**. An operator who wrote `TCAB_GG_INSTALL=relase` asked for a specific install and would
/// otherwise get whichever one the machine happened to auto-detect — a local build on a developer
/// box, a download in the cluster — which is the same silent substitution [`ENV_BINARY`] already
/// refuses.
const ENV_INSTALL_MODE: &str = "TCAB_GG_INSTALL";

/// The install strategies [`ENV_INSTALL_MODE`] may name, for the diagnostic that lists them.
const INSTALL_MODES: &[&str] = &["local", "release"];

/// Env override: the gg release version to download in [release](GgInstall::Release)
/// mode. Defaults to [`DEFAULT_RELEASE_VERSION`].
///
/// This is also how a *prerelease* is pulled: the release pipeline tags candidates
/// `v0.7.0-rc1`, which no crate version ever equals, so exercising one means naming
/// it here (`TCAB_GG_RELEASE_VERSION=0.7.0-rc1`).
const ENV_RELEASE_VERSION: &str = "TCAB_GG_RELEASE_VERSION";

/// Env override: the `owner/repo` the gg release is published under.
const ENV_RELEASE_REPO: &str = "TCAB_GG_RELEASE_REPO";

/// Env override: the release asset's target triple (defaults to the run host's).
const ENV_RELEASE_TARGET: &str = "TCAB_GG_RELEASE_TARGET";

/// The default `owner/repo` gg releases are published under.
const DEFAULT_RELEASE_REPO: &str = "TheClockwyrks/test-cabinet";

/// The `gg` release version a [`GgInstall::Release`] defaults to — this crate's own
/// package version.
///
/// The two sides of that equality are worth spelling out, because nothing at the type
/// level ties them together: *this* crate is what runs in the driver and decides which
/// release asset to fetch, while the asset itself is built from `crates/gg`, whose
/// version is what `gg --version` reports and what is recorded as a run's
/// [`harness_version`](crate::run_record::RunSubject::harness_version). If the two
/// package versions drift the failure is silent in the worst way — the driver requests
/// a tag that does not exist (a run that dies at the install step), or one that does
/// and holds a *different* build than the corpus is about to be labelled with. So they
/// are pinned to the same string, and `crates/gg`'s
/// `the_default_release_version_matches_this_binary` test asserts it.
pub const DEFAULT_RELEASE_VERSION: &str = env!("CARGO_PKG_VERSION");

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
        DEFAULT_RELEASE_VERSION,
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
/// 4. `TCAB_GG_INSTALL` set to anything else errors, on rule 2's reasoning: an explicit
///    override that cannot be honored is a misconfiguration, not a silent fallback.
/// 5. Unset (or empty), auto-detect: the first existing default build path wins; failing
///    that, a release download. That is the *absent* case, which takes the documented
///    default rather than substituting one for something the operator wrote.
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
        GgInstall::Release {
            repo: release_repo_with(env),
            version,
            target: release_target_with(env, default_target_arch),
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
                    "{ENV_INSTALL_MODE}=local but no gg binary exists at {}; set {ENV_BINARY} \
                     or build gg",
                    default_local_candidates()
                        .iter()
                        .map(|candidate| candidate.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            })?;
            Ok(local(host))
        }
        None => match locate_local()? {
            Some(host) => Ok(local(host)),
            None => Ok(release(&env)),
        },
        Some(other) => Err(Error::HarnessUnavailable {
            slug: GG_SLUG.to_string(),
            detail: format!(
                "{ENV_INSTALL_MODE} is set to `{other}`, which is not an install strategy \
                 (expected one of: {})",
                INSTALL_MODES.join(", ")
            ),
        }),
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

/// The `owner/repo` a `gg` release is fetched from: `TCAB_GG_RELEASE_REPO` when set,
/// otherwise `TheClockwyrks/test-cabinet`.
///
/// Public because the run path is not the only thing that resolves a release, and every caller has
/// to look in the same place a run would. Two independent copies of "which repo" is precisely the
/// drift that makes one of them fetch from a repository nothing is published to.
pub fn release_repo() -> String {
    release_repo_with(&|key| std::env::var(key).ok())
}

/// The release asset's target triple: `TCAB_GG_RELEASE_TARGET` when set, otherwise the
/// static-musl triple for the host architecture. Public for the same reason as [`release_repo`].
pub fn release_target() -> String {
    release_target_with(&|key| std::env::var(key).ok(), std::env::consts::ARCH)
}

/// [`release_repo`] with the environment injected, so the pure install resolution can share it.
fn release_repo_with(env: &dyn Fn(&str) -> Option<String>) -> String {
    env(ENV_RELEASE_REPO)
        .filter(|r| !r.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_RELEASE_REPO.to_string())
}

/// [`release_target`] with the environment and host architecture injected.
///
/// Defaults to the fully static musl target: gg is published and installed as a static binary
/// (see `.cargo/config.toml`'s `build-portable-gg` and `scripts/build-gg-static.sh`) precisely so
/// one asset runs across every run-container image (glibc bookworm and the Ubuntu blender image
/// alike). An operator can override the triple via `TCAB_GG_RELEASE_TARGET`.
fn release_target_with(env: &dyn Fn(&str) -> Option<String>, default_arch: &str) -> String {
    env(ENV_RELEASE_TARGET)
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| format!("{default_arch}-unknown-linux-musl"))
}

/// The URL a published `gg` release asset lives at.
///
/// Two conventions are encoded here, and both are owned by
/// `.github/workflows/release.yml` — change one without the other and every cluster
/// run that installs gg from a release dies at the download step:
///
/// - **the tag is `v{version}`**, the single tag a release is cut under (the `tcab`
///   CLI, the services, the desktop installers and gg all hang off it). An earlier
///   `gg-v{version}` scheme named a tag the workflow has never created, so no URL this
///   function produced had ever resolved.
/// - **the asset is a bare executable named `gg-{target}`**, not an archive like the
///   other binaries. The container-side install is one `curl` with no unpack step, in
///   an image that is not guaranteed to have `tar` — and the target triple in the name
///   is what lets one release serve both the `x86_64` and `aarch64` musl builds.
///
/// Public so `crates/gg` can assert that the URL resolved for a default install names
/// the version that binary actually reports.
pub fn release_asset_url(repo: &str, version: &str, target: &str) -> String {
    format!("https://github.com/{repo}/releases/download/v{version}/gg-{target}")
}

/// Build the shell script that downloads a release binary into the container and marks
/// it executable. Pure and unit-tested so the URL and command shape are verified
/// without a published release.
fn release_download_command(repo: &str, version: &str, target: &str, dest: &str) -> String {
    let url = release_asset_url(repo, version, target);
    format!(
        "set -e\ncurl --fail --silent --show-error --location {url} --output {dest}\nchmod 0755 {dest}\n"
    )
}

/// Everything a gg session launches against, in place inside the run container: the
/// binary, the invocation file it reads, and the version it reports.
///
/// Produced by [`prepare_gg`] and consumed by [`run_gg_session`]. The split is what
/// keeps gg's install out of the session's measured duration: the two halves are the
/// run engine's setup stage and its session stage, and the session's clock starts
/// between them.
pub(crate) struct PreparedGg {
    /// The command that launches the installed binary against the invocation file.
    command: Vec<String>,
    /// The version the installed binary reported, absent when the probe failed.
    harness_version: Option<String>,
}

/// Run gg's **setup stage** against the started run container: install the binary,
/// write the [`GgInvocation`] it reads, and capture the version it reports.
///
/// This is gg's counterpart to the third-party harness install and probe stages, and it
/// is setup rather than session: it downloads a release over the network and it is
/// shared by every run of a configuration, so the caller runs it before the session's
/// clock starts (see [`RunMetrics::setup_seconds`](crate::metrics::RunMetrics)).
///
/// Reuses the already-started `handle`, `runtime`, and `events` sink from the
/// surrounding [`RunEngine::execute`](crate::RunEngine::execute), plus the resolved
/// `install`, the run's `request` (for its capability set), the rendered `base_prompt`,
/// the seeded `workspace_dir`, the run's `max_runtime` (which bounds each container
/// call made here), the `run_id` (used as the gg session id), and the `provided_files`
/// the test case seeded (workspace-relative spec and reference paths, for the
/// [autoload-specifications](crate::gg::CAPABILITY_AUTOLOAD_SPECS) capability).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn prepare_gg(
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
) -> Result<PreparedGg> {
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
                        "downloading the {version} release exited {}: {}",
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
    // 3. Query the installed binary's version for the run record. Best-effort: a run is
    //    still valid if the probe fails.
    //
    // Both are container calls, so both are bounded by the run's maximum runtime exactly
    // as the download above is and as every other in-container setup step. Neither takes
    // measurable time against a healthy runtime; the bound is what keeps a wedged one
    // from spending a session's worth of wall clock before the session starts.
    let configure = async {
        let invocation =
            build_invocation(request, base_prompt, workspace_dir, provided_files, run_id)?;
        let json = serde_json::to_vec(&invocation)?;
        write_container_file(runtime, handle, GG_INVOCATION_PATH, &json, 0o600).await?;
        Ok::<Option<String>, Error>(gg_version(runtime, handle, install.container_path()).await)
    };
    let harness_version =
        match tokio::time::timeout(std::time::Duration::from_secs(max_runtime), configure).await {
            Ok(result) => result?,
            Err(_elapsed) => {
                return Err(Error::HarnessInstallTimedOut {
                    slug: GG_SLUG.to_string(),
                    seconds: max_runtime,
                });
            }
        };

    Ok(PreparedGg {
        command: vec![
            install.container_path().to_string(),
            "--config".to_string(),
            GG_INVOCATION_PATH.to_string(),
        ],
        harness_version,
    })
}

/// Run a [prepared](PreparedGg) gg **session** to completion against the started run
/// container and produce its [`HarnessOutcome`].
///
/// Launches `gg --config <path>` and ingests its NDJSON telemetry line by line, bridging
/// each event to the `events` sink and summing usage and cost into the outcome. The idle
/// watchdog kills a gg that stops producing output for too long — a stalled provider
/// request — exactly as it does a third-party harness session, and `cancel` carries an
/// operator's kill.
///
/// The caller bounds this future by the run's maximum runtime and measures it as the
/// run's session, exactly as a third-party harness session is bounded and measured.
pub(crate) async fn run_gg_session(
    runtime: &dyn ContainerRuntime,
    handle: &ContainerHandle,
    prepared: PreparedGg,
    events: &mut dyn EventSink,
    cancel: &RunCancellation,
) -> Result<HarnessOutcome> {
    let PreparedGg {
        command,
        harness_version,
    } = prepared;
    // A kill that landed before this point finds no session to wind down: launching gg
    // only to stop it at its first boundary would produce a record of nothing, which is
    // exactly what a killed run's record must never be. Refuse the launch instead, and
    // let the engine stop the container it started.
    if cancel.is_canceled() {
        return Err(Error::CanceledBeforeSession);
    }
    let mut sink = GgIngestSink::new(events);
    // Launch gg against the invocation file and ingest its NDJSON telemetry line by
    // line, bridging each event to the sink and summing usage and cost.
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
        error_logs,
        stderr_lines,
        limit_breach,
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
                tool_calls: BTreeMap::new(),
                canceled: true,
            });
        }
    };

    // Classify the result.
    //    - The idle watchdog firing means gg stopped responding: it is hung, not failed.
    //    - A non-zero exit means the session produced nothing there is any point scoring,
    //      for one of four reasons, none of them the model's — which is why each is a harness
    //      error rather than a scoreable run:
    //        * a launch fatal, so no session ran at all: a malformed config, a bound model
    //          with no context window, a root client that would not resolve (a missing
    //          credential on a live binding), or gg refusing to build a run it had just
    //          validated — SessionEnded{status:"error"};
    //        * a credential the provider *rejected* mid-flight, so nothing about the model
    //          was exercised either — SessionEnded{status:"auth_error"};
    //        * the provider failing the root's model call, with the run's whole retry
    //          schedule spent or a fatal status on the first attempt —
    //          SessionEnded{status:"model_error"}. An outage says nothing about the model
    //          either, and it is the failure a retry stands a chance of walking past;
    //        * a defect in gg itself — SessionEnded{status:"internal_error"}: a state gg's
    //          own launch validation proves unreachable, gg's sandbox machinery failing
    //          under a turn the model answered, or an agent task that panicked. Unlike the
    //          first two above, this session *did*
    //          run against a working model: the key was accepted and turns were taken. What
    //          disqualifies it is that gg stopped it on its own mistake, so whatever tree it
    //          left describes a run the model never got to finish, and scoring it would
    //          blame the model for our bug.
    //      The first three are read off the *root's* ending; the fourth is read off the whole
    //      tree. A gg defect met by any agent — an issue agent, a reviewer, a spawned child —
    //      winds the entire run down under `internal_error`, because the tree a broken run
    //      leaves behind is not the tree that configuration produces and nothing here could
    //      tell the difference (see gg's `STATUS_INTERNAL_ERROR`).
    //      The exit code and the status say *which* of these it was; they do not say why.
    //      gg does: before ending `error` it logs each launch defect at error level (every
    //      one of them, not the first — a refusal names the whole configuration's faults in
    //      one pass), and a fatal it meets before the telemetry stream is up goes to stderr.
    //      Those are already bridged into the run's event feed, but the feed is not what an
    //      operator reads off a failed run's row — the status detail is — so the sink keeps
    //      them and the classification quotes them, bounded, after the code and status.
    //    - Exit 3 means the session ran and gg stopped it on one of the five
    //      execution ceilings its own capability set armed: a turn count, the
    //      wall-clock budget, the run's spend, or either error ceiling. That is not
    //      a malfunction and not ours — it is the model's outcome against a
    //      safeguard the configuration chose — so it is classified apart from the
    //      four above as `RunState::LimitExceeded`, which is publishable as a
    //      per-model statistic and is the one harness stop that is never retried:
    //      a second attempt on the same configuration reaches the same ceiling.
    //      Which ceiling, and by how much, is the sentence gg logged as it raised
    //      the breach; the sink pairs that sentence with the `limit_exceeded` event
    //      that follows it, and the detail carries it for the same reason as above.
    //    - Exit 0 means a session ran to a natural end. That includes a `model_error` the
    //      model caused (a reply loop detection discarded on every attempt) and one a
    //      subagent met, both collected and scored; the provider failing the root is the
    //      exit-1 case above.
    if output.idle_timed_out {
        return Err(Error::HarnessHung {
            slug: GG_SLUG.to_string(),
            seconds: HARNESS_IDLE_TIMEOUT.as_secs(),
        });
    }
    if output.exit_code != 0 {
        return Err(classify_exit(
            output.exit_code,
            terminal_status.as_deref(),
            &ExitReasons {
                error_logs: &error_logs,
                stderr_lines: &stderr_lines,
                limit_breach: limit_breach.as_deref(),
            },
        ));
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
        tool_calls: BTreeMap::new(),
        // This session ended on its own terms; the cancellation path returns above.
        canceled: false,
    })
}

/// Classify a **non-zero** gg exit into the [`Error`] the run is recorded under, given the
/// terminal status the session reported on its stream (absent when it never got that far).
///
/// gg leaves one of two non-zero codes, and they say opposite things about the configuration.
/// [`EXIT_LIMIT_EXCEEDED`](crate::gg::EXIT_LIMIT_EXCEEDED) says the session ran and some agent of
/// it breached one of the five execution ceilings the capability set armed, which is the model's
/// outcome against a safeguard somebody chose. Everything else says there was no run to score at
/// all: a launch fatal, a credential the provider refused, a provider that failed the root's model
/// call past its retry schedule, or a defect in gg.
///
/// The split is what keeps the first out of the retry loop. Both would otherwise be an
/// [`HarnessInvocation`](Error::HarnessInvocation) and therefore a
/// [`RunState::HarnessError`](crate::run_record::RunState::HarnessError), which the backend
/// retries — and a retry of a run that spent its own ceiling runs the same capability set into the
/// same bound.
///
/// Both branches carry the same figures — the code gg left and the status the session ended under
/// — and differ only in what they quote on top of them. A breach quotes the ceiling sentence
/// *instead of* those figures: [`HarnessLimitExceeded`](Error::HarnessLimitExceeded) already says a
/// ceiling stopped the run, which is all the code `3` and the `limit_exceeded` status say, and the
/// sentence is the only thing here that names which ceiling and by how much. Pairing that sentence
/// to the agent that raised it is best-effort, though, so a breach nobody logged a sentence for
/// falls back to the figures rather than leaving a failure with no figure at all. Every other exit
/// keeps the figures and adds what gg said on its way out (see [`ExitReasons`]): every error-level
/// log in order, otherwise whatever reached stderr. With nothing to quote, the figures stand alone.
/// The quoted part
/// is bounded by [`MAX_EXIT_REASON_BYTES`] so a stream that logged an error per turn for a thousand
/// turns leaves a status detail a row can still show, not a run record padded with it — and what
/// the bound elides is the middle, never the last message, which is the one that says why (see
/// [`join_bounded`]).
///
/// A pure function so the classification is pinned without a container behind it; the caller owns
/// everything else about the exit, including collecting the reasons off the stream.
fn classify_exit(
    exit_code: i32,
    terminal_status: Option<&str>,
    reasons: &ExitReasons<'_>,
) -> Error {
    let limit_exceeded = exit_code == i32::from(crate::gg::EXIT_LIMIT_EXCEEDED);
    let why = reasons.quoted(limit_exceeded);
    // The figures this layer holds whichever branch takes them, composed once so the two
    // read identically: the code gg left, and the status the session ended under when it
    // got far enough to report one. Both variants name the harness themselves, so neither
    // repeats it here.
    let status = terminal_status
        .map(|status| format!(", session ended `{status}`"))
        .unwrap_or_default();
    let figures = format!("code {exit_code}{status}");
    if limit_exceeded {
        // The code and the status both say "a ceiling stopped this", which is what
        // `HarnessLimitExceeded` itself says, so the breach sentence displaces them when
        // there is one. When no agent logged one they are what this failure has.
        return Error::HarnessLimitExceeded {
            slug: GG_SLUG.to_string(),
            detail: why.unwrap_or(figures),
        };
    }
    Error::HarnessInvocation {
        slug: GG_SLUG.to_string(),
        // The harness is named by the variant, so the detail carries only the figures:
        // the code, the status, and what gg said on its way out.
        detail: match why {
            Some(why) => format!("{figures}; {why}"),
            None => figures,
        },
    }
}

/// The most the quoted reasons may add to a non-zero exit's status detail, in bytes.
///
/// A launch refusal names a handful of defects at a sentence each, which fits comfortably; the
/// bound exists for the stream that does not stop — a session that logged an error on every one of
/// hundreds of retried turns before gg gave up on it. The detail is a column on the run record and
/// a line on the console's failed-run row, and neither wants a page of it.
const MAX_EXIT_REASON_BYTES: usize = 2000;

/// What gg said about a non-zero exit before it left, as the [`GgIngestSink`] collected it off the
/// stream — handed to [`classify_exit`] rather than read from the sink inside it, so the
/// classification stays a pure function of what it is given.
struct ExitReasons<'a> {
    /// Every error-level `log` message, in stream order.
    error_logs: &'a [String],
    /// Every non-empty stderr line, in arrival order.
    stderr_lines: &'a [String],
    /// The sentence gg logged for the ceiling it stopped the session on, when it stopped on one.
    limit_breach: Option<&'a str>,
}

impl ExitReasons<'_> {
    /// The reasons to quote after the code and status, or `None` when gg said nothing usable.
    ///
    /// A ceiling breach is quoted by its own sentence, because that is the one thing an operator
    /// wants to know about a limit exit and the error logs a session left on its way to (say) the
    /// consecutive-errors ceiling are already summarised by it. Every other exit prefers the error
    /// logs — gg names each launch defect and each fatal there — and falls back to stderr, which
    /// only carries a fatal gg met before its telemetry stream was up.
    fn quoted(&self, limit_exceeded: bool) -> Option<String> {
        if limit_exceeded && let Some(breach) = self.limit_breach {
            return Some(breach.to_string());
        }
        let reasons = if self.error_logs.is_empty() {
            self.stderr_lines
        } else {
            self.error_logs
        };
        if reasons.is_empty() {
            return None;
        }
        Some(join_bounded(reasons, MAX_EXIT_REASON_BYTES))
    }
}

/// Join `reasons` with `; ` in at most `limit` bytes.
///
/// When they all fit they are joined in order and nothing is elided. When they do not, the
/// **last** reason is kept whole, the first ones are kept whole in order for as long as they fit,
/// and the rest are replaced by a count of them between the two — so the reader learns how much
/// was left unsaid rather than being handed a sentence cut mid-word. The last is the one that
/// must survive because it is where gg puts the message that explains the exit: an
/// `internal_error` logs the defect it broke on *after* the per-turn errors (a retried model
/// call, a rejected length-capped turn) it logged on the way there, and a detail that quoted
/// thirty retries and counted the defect among "N more" would say everything but why.
///
/// The one reason that may be cut is the last, when it alone is longer than the budget: saying
/// most of the only explanation there is beats saying none of it, so it is cut on a character
/// boundary and marked. The bound holds for any `limit` with room for the count and that mark;
/// the one caller passes [`MAX_EXIT_REASON_BYTES`].
fn join_bounded(reasons: &[String], limit: usize) -> String {
    const SEPARATOR: &str = "; ";
    let Some((last, head)) = reasons.split_last() else {
        return String::new();
    };
    let joined_len = reasons.iter().map(String::len).sum::<usize>() + SEPARATOR.len() * head.len();
    if joined_len <= limit {
        return reasons.join(SEPARATOR);
    }
    if head.is_empty() {
        return cut_to(last, limit);
    }
    // Something is elided, so the count is reserved first — at its widest, since how many are
    // elided is only known once the head is filled — and the last reason is fitted to what the
    // count leaves, whole where it can be. The head then gets whatever remains.
    let elision = |elided: usize| format!("…and {elided} more");
    let reserved = elision(head.len()).len() + SEPARATOR.len();
    let tail = cut_to(last, limit.saturating_sub(reserved));
    let budget = limit.saturating_sub(reserved + tail.len() + SEPARATOR.len());
    let mut kept = String::new();
    let mut kept_count = 0;
    for reason in head {
        let needed = if kept.is_empty() {
            reason.len()
        } else {
            SEPARATOR.len() + reason.len()
        };
        if kept.len() + needed > budget {
            break;
        }
        if !kept.is_empty() {
            kept.push_str(SEPARATOR);
        }
        kept.push_str(reason);
        kept_count += 1;
    }
    if !kept.is_empty() {
        kept.push_str(SEPARATOR);
    }
    kept.push_str(&elision(head.len() - kept_count));
    kept.push_str(SEPARATOR);
    kept.push_str(&tail);
    kept
}

/// `reason` whole when it fits in `budget` bytes, otherwise cut on a character boundary to fit
/// with the mark that says so — the em dash gg's own messages are full of must not be split.
fn cut_to(reason: &str, budget: usize) -> String {
    const MARK: char = '…';
    if reason.len() <= budget {
        return reason.to_string();
    }
    let mut cut = budget.saturating_sub(MARK.len_utf8());
    while !reason.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}{MARK}", &reason[..cut])
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
/// seeded workspace, the rendered prompt, the capability set the request carries — copied
/// verbatim, and proved honourable by gg's own launch refusal inside the container, before
/// its first turn and before any model spend — the
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
        model_providers: request.gg_model_providers.clone(),
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
    /// Every error-level `log` message, in stream order, so a non-zero exit can be recorded
    /// with the reason gg gave rather than the code alone. All of them, because a launch
    /// refusal logs one per defect before it ends the session, and an operator fixing the
    /// configuration wants the whole list in one pass. They are bridged into the event feed
    /// as they arrive too; this copy is for the status detail (see [`ExitReasons`]).
    error_logs: Vec<String>,
    /// Every non-empty stderr line, trimmed, in arrival order. gg writes to stderr only for
    /// a fatal it meets before its telemetry stream is up, so when the session ends with no
    /// error log this is the only account of why.
    stderr_lines: Vec<String>,
    /// The most recent warn-level `log` message of each agent, by the agent id on the
    /// event's envelope, held only so that a `limit_exceeded` event can claim its own: gg
    /// logs the ceiling sentence at warn level and emits the breach event immediately after
    /// on the same agent's emitter, and pairing the two here is what lets the detail quote
    /// the sentence without also quoting every unrelated warning the session raised. Per
    /// agent rather than one for the stream, because subagents run concurrently on one sink
    /// and nothing makes an agent's two emits adjacent: another agent's warning can land
    /// between them, and a stream-wide "last warning" would quote that as the ceiling. A
    /// claimed warning is removed, so a breach with no sentence of its own claims nothing.
    last_warning_by_agent: BTreeMap<Option<String>, String>,
    /// The ceiling sentence claimed by the last `limit_exceeded` event, when one was seen.
    limit_breach: Option<String>,
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
            error_logs: Vec::new(),
            stderr_lines: Vec::new(),
            last_warning_by_agent: BTreeMap::new(),
            limit_breach: None,
        }
    }

    /// Emit one bridged event to the sink and record it for the run's translated stream.
    fn emit(&mut self, event: HarnessEvent) {
        self.events.emit(&event);
        self.translated_events.push(event);
    }

    /// Ingest one parsed gg telemetry event: fold usage/cost, the terminal status and the
    /// reasons a non-zero exit will be recorded with, then bridge it to normalized events.
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
            GgTelemetryKind::Log { level, message } => match level.to_ascii_lowercase().as_str() {
                "error" => self.error_logs.push(message.clone()),
                "warn" | "warning" => {
                    self.last_warning_by_agent
                        .insert(gg.agent_id.clone(), message.clone());
                }
                _ => {}
            },
            // The breach names the agent that observed it, which is the agent whose emitter
            // logged the sentence just before — so that is the warning it claims, not the
            // stream's most recent one.
            GgTelemetryKind::LimitExceeded { breach } => {
                self.limit_breach = self
                    .last_warning_by_agent
                    .remove(&Some(breach.agent_id.clone()));
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
            // gg writes only pre-telemetry fatal diagnostics to stderr, so each line is both
            // a warning on the feed and, kept here, the reason the exit is recorded with.
            OutputStream::Stderr => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return;
                }
                self.stderr_lines.push(trimmed.to_string());
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
            ..
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
