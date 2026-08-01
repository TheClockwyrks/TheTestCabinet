//! `tcab gg-replay` — reconstruct a **gg** run from a captured replay record.
//!
//! Replay is gg's [debugging tool](https://docs.testcabinet.ai/gg/replay/): every run pins its
//! non-deterministic inputs — each agent's model I/O, every tool result, gg's own subprocesses, the
//! turn-boundary probes — into a replay record (the
//! [`replay`](test_cabinet_core::gg::CAPABILITY_REPLAY) capability only escalates the
//! [fidelity](test_cabinet_core::gg_replay::GgReplayFidelity)). This command feeds that record to
//! gg's [`replay_driver`](test_cabinet_gg::replay_driver), which re-runs the session's turn loop
//! from the record with **no live model and no real tools**: it re-emits the reconstructed telemetry
//! (the same NDJSON stream a live run emits) and yields the per-agent step-through a developer
//! walks.
//!
//! It is debug-only: it does not seed a workspace, launch a container, or produce a scored run. If
//! the record is incomplete — a turn wants a model response or tool outcome the record never pinned
//! — the driver reports the exact gap rather than guessing, which is precisely what replay exists to
//! expose.
//!
//! # Naming the record
//!
//! Two ways, and both are first-class:
//!
//! - **`tcab gg-replay <RUN_ID>`** fetches `GET /runs/{id}/replay` from the backend. This is the
//!   common case — the run you want to understand is one somebody linked you to, and hunting down
//!   its run tree first is friction with no purpose.
//! - **`tcab gg-replay --record <FILE>`** reads a local file: a run tree's `replay.json.gz`, a
//!   committed fixture, a record somebody sent you. The flag is *kept*, not demoted to a second
//!   positional, because it is already shipped: silently changing how an existing invocation is
//!   spelled breaks every script that used it, which is exactly the break `gg --config` is
//!   protected from.
//!
//! # What this reads
//!
//! Both formats, through one type, and both byte shapes. [`GgReplayRecord`] **upgrades** a
//! [v1](test_cabinet_core::gg_replay::GG_REPLAY_FORMAT_V1) body — the flat shape gg wrote before
//! pooling, and still what `GET /runs/{id}/replay` serves for every run captured before the change —
//! into the pooled v2 shape as it deserializes, so a record from either era reconstructs here; and
//! the loader sniffs gzip, so the run tree's compressed copy needs no unpacking first. A record from
//! a **newer** gg is refused by that same deserializer rather than read partially: reconstructing a
//! session from an incomplete understanding of its inputs is worse than not reconstructing it.
//!
//! # Reconstructing with an older gg
//!
//! `--gg <VERSION|PATH>` hands the whole reconstruction to a different `gg` binary — a published
//! release resolved by version, or one already on disk — and this process becomes a pass-through
//! for its output. That is the escape hatch for the direction `formatVersion` cannot rescue: this
//! build refuses a record from a *newer* gg, and a record from a much *older* one may pin inputs
//! this build no longer models. The build that wrote a record can always read it, and the record's
//! own [`recorder`](test_cabinet_core::gg_replay::GgReplayRecorder) block names that build — which
//! is why the banner prints it before delegating.
//!
//! This is also why every `gg` carries a [`replay` subcommand](test_cabinet_gg): the delegation is
//! `gg replay --record <FILE>`, so a release that cannot be asked to replay cannot be delegated to.

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use test_cabinet_core::backend_client::{BackendClient, HttpBackendClient};
use test_cabinet_core::gg_replay::GgReplayRecord;
use test_cabinet_gg::replay_cli::{ReplayReport, decompressed, parse_record, read_record};

use crate::cli::GgReplayArgs;
use crate::config;

/// How the program names itself in the reconstruction's output.
const PROGRAM: &str = "tcab gg-replay";

/// Load the replay record (by run id or from `--record`), reconstruct the run — here or through an
/// older `gg` — and report it.
pub async fn execute(args: GgReplayArgs) -> anyhow::Result<()> {
    let source = RecordSource::from_args(&args)?;

    // Delegation is decided before the record is parsed, because the whole point of it is that
    // *this* build may not be the right one to parse it with. The bytes are still fetched here (a
    // run id means nothing to a gg binary, which knows only files), and the record is peeked at for
    // the banner — a peek that is allowed to fail without stopping the delegation.
    if let Some(spec) = args.gg.as_deref() {
        return delegate(spec, &source, args.steps.as_deref()).await;
    }

    let record = match &source {
        RecordSource::File(path) => read_record(path)?,
        RecordSource::Run(run_id) => {
            let bytes = fetch_record(run_id).await?;
            parse_record(&bytes)
                .with_context(|| format!("parsing the replay record for run `{run_id}`"))?
        }
    };

    let label = source.label();
    let report = ReplayReport {
        program: PROGRAM,
        source: &label,
        steps: args.steps.as_deref(),
    };
    test_cabinet_gg::replay_cli::reconstruct_and_report(record, &report, &mut std::io::stdout())?;
    Ok(())
}

/// Where the record being reconstructed comes from.
///
/// Exactly one of the two, enforced by the clap group on [`GgReplayArgs`] — so the impossible third
/// state (neither, or both) is a parse error the user sees in terms of the flags they typed, not a
/// runtime branch here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordSource {
    /// A local file — plain JSON or gzipped.
    File(PathBuf),
    /// A published run, fetched from the backend.
    Run(String),
}

impl RecordSource {
    /// Read the source out of the parsed arguments.
    fn from_args(args: &GgReplayArgs) -> anyhow::Result<Self> {
        match (&args.run_id, &args.record) {
            (_, Some(path)) => Ok(Self::File(path.clone())),
            (Some(run_id), None) => Ok(Self::Run(run_id.clone())),
            // Unreachable through clap (the arg group is `required`), but a handler that would
            // panic or silently do nothing if the group were ever relaxed is worse than one line.
            (None, None) => bail!("name a run id, or a record file with --record"),
        }
    }

    /// How the source reads in the reconstruction's opening line.
    fn label(&self) -> String {
        match self {
            Self::File(path) => path.display().to_string(),
            Self::Run(run_id) => format!("run `{run_id}`"),
        }
    }
}

/// Fetch a published run's replay record from the backend.
async fn fetch_record(run_id: &str) -> anyhow::Result<Vec<u8>> {
    let base = config::backend_url().context(
        "TCAB_BACKEND_URL is not set, so a run id cannot be resolved — set it, or name a local \
         record with --record",
    )?;
    let client = HttpBackendClient::new(base).with_token(config::load_token());
    client
        .run_replay(run_id)
        .await
        .with_context(|| format!("fetching the replay record for run `{run_id}`"))
}

/// Reconstruct through a different `gg` binary, streaming its output through this process.
///
/// The record is materialized as **plain JSON in a temporary file** whichever way it was named. A
/// run id means nothing to a gg binary, and an older gg predates the gzip sniffing — so handing it
/// the least surprising thing it could be given is what makes the delegation work across the whole
/// range of releases it exists to reach.
async fn delegate(spec: &str, source: &RecordSource, steps: Option<&Path>) -> anyhow::Result<()> {
    let bytes = match source {
        RecordSource::File(path) => std::fs::read(path)
            .with_context(|| format!("reading the replay record at {}", path.display()))?,
        RecordSource::Run(run_id) => fetch_record(run_id).await?,
    };
    // Best-effort: a record this build cannot parse is exactly the case delegation exists for, so a
    // failed peek must not stop it — it only costs the banner its detail.
    let peeked: Option<GgReplayRecord> = parse_record(&bytes).ok();

    let binary = resolve_gg(spec).await?;
    println!(
        "{PROGRAM}: reconstructing {} with the gg at {}",
        source.label(),
        binary.display()
    );
    match peeked.as_ref().and_then(|r| r.recorder.gg_version.as_ref()) {
        Some(version) => println!("  the record says it was written by gg {version}"),
        None => println!("  the record does not say which gg wrote it"),
    }

    // The scratch file lives only for the child's lifetime; the record it holds is a copy of bytes
    // that already exist in the backend or on disk.
    let scratch =
        tempfile::TempDir::new().context("creating a scratch directory for the record")?;
    let record_path = scratch.path().join("replay.json");
    let plain = decompressed(&bytes)?;
    std::fs::write(&record_path, &plain)
        .with_context(|| format!("writing the record to {}", record_path.display()))?;

    let mut command = std::process::Command::new(&binary);
    command.arg("replay").arg("--record").arg(&record_path);
    if let Some(steps) = steps {
        command.arg("--steps").arg(steps);
    }
    // Inherited stdio: the child re-emits the run's telemetry on stdout, and forwarding it verbatim
    // is what makes a delegated reconstruction indistinguishable from a local one.
    let status = command.status().with_context(|| {
        format!(
            "invoking `{} replay` — is it a gg binary that supports the replay subcommand?",
            binary.display()
        )
    })?;
    if !status.success() {
        bail!(
            "the gg at {} did not reconstruct the record (exit {})",
            binary.display(),
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "signal".into()),
        );
    }
    Ok(())
}

/// What `--gg` resolved to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedGg {
    /// A binary already on disk: an explicit path, or a release downloaded by an earlier run.
    OnDisk(PathBuf),
    /// A published release that is not cached yet — download `url` and install it at `path`.
    Download {
        /// The release version, with any leading `v` stripped.
        version: String,
        /// The asset URL, from the same convention the run path installs gg by.
        url: String,
        /// Where the downloaded binary is cached.
        path: PathBuf,
    },
}

/// Resolve `--gg` to a binary on disk, downloading a released one if it is not cached yet.
async fn resolve_gg(spec: &str) -> anyhow::Result<PathBuf> {
    let repo = test_cabinet_core::gg_exec::release_repo();
    let target = test_cabinet_core::gg_exec::release_target();
    let cache = gg_cache_dir();

    match resolve_gg_with(spec, &cache, &repo, &target, |path| path.exists())? {
        ResolvedGg::OnDisk(path) => Ok(path),
        ResolvedGg::Download { version, url, path } => {
            println!("{PROGRAM}: downloading gg {version} from {url}");
            download_binary(&url, &path).await?;
            Ok(path)
        }
    }
}

/// The directory downloaded `gg` releases are cached in, under the CLI's own config directory so a
/// single `TCAB_CONFIG_DIR` relocates everything `tcab` writes.
fn gg_cache_dir() -> PathBuf {
    config::config_dir().join("gg")
}

/// Pure resolution of a `--gg` spec, with the filesystem probe injected so the rules are testable
/// without a real download or a real binary.
///
/// The order, and why each rule is the way it is:
///
/// 1. A spec naming an **existing path** is that binary. This is how a locally-built gg — the
///    `/cargo-target/…/release/gg` a developer just compiled — is used.
/// 2. A spec that is **path-shaped** (it contains a separator, or starts with `.` or `~`) but does
///    not exist is an **error**, never a fallback to treating it as a version. An explicit path that
///    cannot be honored is a misconfiguration, and the same stance the run path takes with
///    `TCAB_GG_BINARY`; silently reinterpreting it would send a typo'd path to GitHub as a version.
/// 3. Otherwise it is a **version**, with an optional leading `v` (both `0.6.9` and `v0.6.9` are
///    natural to type, and the release *tag* is the second). It must start with a digit — anything
///    else is neither a version nor a path, and saying so beats forming a URL that 404s.
/// 4. A version already in the cache is used as-is; otherwise it is downloaded. The cache key
///    carries the **target triple** as well as the version, because one cache directory can outlive
///    a change of `TCAB_GG_RELEASE_TARGET` and an `aarch64` binary named `gg-0.6.9` on an `x86_64`
///    host fails in a way nothing here would explain.
fn resolve_gg_with(
    spec: &str,
    cache_dir: &Path,
    repo: &str,
    target: &str,
    exists: impl Fn(&Path) -> bool,
) -> anyhow::Result<ResolvedGg> {
    let spec = spec.trim();
    if spec.is_empty() {
        bail!("--gg needs a released gg version (for example `0.6.9`) or a path to a gg binary");
    }

    let path_shaped =
        spec.contains(std::path::MAIN_SEPARATOR) || spec.starts_with('.') || spec.starts_with('~');
    let candidate = Path::new(spec);
    if exists(candidate) {
        return Ok(ResolvedGg::OnDisk(candidate.to_path_buf()));
    }
    if path_shaped {
        bail!("--gg points at `{spec}`, which does not exist");
    }
    // One check, after the optional `v` is stripped: `latest`, `stable`, `gg` and a bare `v` all
    // fail it, and each of them would otherwise become a URL that 404s for a reason the message
    // could not explain.
    let version = spec.strip_prefix('v').unwrap_or(spec);
    if !version.starts_with(|c: char| c.is_ascii_digit()) {
        bail!(
            "--gg takes a released gg version (for example `0.6.9`) or a path to a gg binary; \
             `{spec}` is neither"
        );
    }

    let path = cache_dir.join(format!("gg-{version}-{target}"));
    if exists(&path) {
        return Ok(ResolvedGg::OnDisk(path));
    }
    Ok(ResolvedGg::Download {
        version: version.to_string(),
        url: test_cabinet_core::gg_exec::release_asset_url(repo, version, target),
        path,
    })
}

/// Download a released `gg` to `path` and make it executable.
///
/// Written through a temporary file in the same directory and renamed into place, so a download
/// interrupted half-way never leaves a truncated binary that the next invocation would happily
/// treat as cached.
async fn download_binary(url: &str, path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating the gg cache directory {}", parent.display()))?;
    }

    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .with_context(|| format!("downloading {url}"))?;
    let status = response.status();
    if !status.is_success() {
        bail!("downloading {url} failed with HTTP {status} — is that a released gg version?");
    }
    let bytes = response
        .bytes()
        .await
        .with_context(|| format!("reading the response body from {url}"))?;

    // Appended, not `with_extension`: a cache name carries the version, so its last `.` is the one
    // in `0.6.9` and `with_extension` would rewrite `gg-0.6.9-…` into `gg-0.6.partial`.
    let partial = partial_path(path);
    std::fs::write(&partial, &bytes).with_context(|| format!("writing {}", partial.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755))
            .with_context(|| format!("making {} executable", partial.display()))?;
    }
    std::fs::rename(&partial, path)
        .with_context(|| format!("installing the downloaded gg at {}", path.display()))?;
    Ok(())
}

/// The scratch path a download is written to before being renamed into place.
///
/// The suffix is **appended** rather than set as an extension. A cache name carries a version, so
/// its last `.` is the one inside `0.6.9`, and `Path::with_extension` would turn
/// `gg-0.6.9-x86_64-unknown-linux-musl` into `gg-0.6.partial` — a name that collides across every
/// `0.6.x` and every target at once.
fn partial_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".partial");
    PathBuf::from(name)
}

#[cfg(test)]
#[path = "gg_replay.test.rs"]
mod tests;
