//! Concrete container runtime and artifact collector backed by a CLI.
//!
//! See `docs/execution.md`. This drives a Docker- or Podman-compatible runtime
//! through its command line so no single runtime is hard-coded. A run container
//! is started detached from the harness's image, the seeded repository is copied
//! into a runtime-managed volume at `/work`, secrets are passed as environment
//! variables, and the produced working tree is collected when the run finishes.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tempfile::NamedTempFile;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::instrument;
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::exec_stream::drain_with_idle_timeout;
use crate::execution::{
    ArtifactCollection, ArtifactCollector, ContainerFile, ContainerHandle, ContainerRuntime,
    ContainerSpec, ContainerStart, ExecOutput, OutputSink,
};

/// The container working directory the seeded repository is copied into. Matches
/// the `WORKDIR` of the run-container images (`containers/base/Dockerfile`).
const WORK_DIR: &str = "/work";

/// The unprivileged user the run-container images run as: `containers/base/Dockerfile`
/// reuses the Node base image's `node` user (uid 1000). The copied-in working
/// tree is handed to this user so the harness — which runs as `node` — can build
/// in it regardless of how the host files were owned.
const RUN_USER: &str = "node";

/// A container runtime that shells out to a Docker-compatible CLI.
#[derive(Debug, Clone)]
pub struct CliContainerRuntime {
    /// The runtime binary (for example `podman` or `docker`).
    binary: String,
}

impl CliContainerRuntime {
    /// Use a specific runtime binary.
    pub fn with_binary(binary: impl Into<String>) -> Self {
        Self {
            binary: binary.into(),
        }
    }

    /// Detect an available runtime, preferring Podman, then Docker.
    ///
    /// Honors the `TCAB_CONTAINER_RUNTIME` environment variable as an override.
    pub fn detect() -> Result<Self> {
        if let Ok(binary) = std::env::var("TCAB_CONTAINER_RUNTIME")
            && !binary.trim().is_empty()
        {
            return Ok(Self::with_binary(binary));
        }
        for candidate in ["podman", "docker"] {
            if which::which(candidate).is_ok() {
                return Ok(Self::with_binary(candidate));
            }
        }
        Err(Error::ContainerRuntime(
            "no container runtime found on PATH (looked for podman, docker); \
             set TCAB_CONTAINER_RUNTIME to override"
                .to_string(),
        ))
    }

    /// The runtime binary name.
    pub fn binary(&self) -> &str {
        &self.binary
    }

    /// Run the runtime CLI with the given arguments, returning its output.
    ///
    /// The current trace context is propagated to the child as the `TRACEPARENT`
    /// environment variable so a runtime that itself emits telemetry can continue
    /// this trace. It is a no-op when nothing is in scope to propagate.
    async fn run(&self, args: &[String]) -> Result<std::process::Output> {
        let mut command = Command::new(&self.binary);
        command.args(args);
        if let Some(traceparent) = test_cabinet_telemetry::propagation::current_traceparent() {
            command.env("TRACEPARENT", traceparent);
        }
        command
            .output()
            .await
            .map_err(|err| Error::ContainerRuntime(format!("failed to run {}: {err}", self.binary)))
    }

    /// Whether `image` is present in local storage. Keeps [`pull`] idempotent and
    /// avoids contacting a registry for an image already pulled or built locally.
    /// `image inspect` succeeds for a present image and exits non-zero otherwise,
    /// on both Podman and Docker.
    ///
    /// [`pull`]: ContainerRuntime::pull
    async fn image_present(&self, image: &str) -> bool {
        let args = vec![
            "image".to_string(),
            "inspect".to_string(),
            image.to_string(),
        ];
        self.run(&args)
            .await
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    /// Copy the seeded repository into the started container's working directory
    /// and hand the result to the run user.
    ///
    /// The repository is read from its native host path — `cp` runs on the host
    /// side of the runtime, so a Windows `C:\...` source is used verbatim and
    /// never goes through a WSL `/mnt/<drive>` mount — and copied into the volume
    /// at `/work`. Copying (rather than bind-mounting the host directory) is what
    /// keeps the working tree off the host filesystem: a bind mount of the
    /// staging directory would, on Windows, mount the Windows partition the WSL2
    /// VM exposes as `/mnt/<drive>` DrvFs, which carries no Linux ownership and
    /// leaves the tree unwritable by the `node` user.
    ///
    /// `cp` does not set ownership to the container user consistently across
    /// runtimes, and the host files may be owned by any uid, so a following
    /// `chown` (run as uid 0 inside the container, whatever the run user) makes
    /// the unprivileged run user own the tree it builds in.
    async fn seed_workdir(&self, container: &ContainerHandle, repo_path: &Path) -> Result<()> {
        let source = repo_path.to_str().ok_or_else(|| {
            Error::ContainerRuntime(format!(
                "seed repository path is not valid UTF-8: {}",
                repo_path.display()
            ))
        })?;
        // `cp <src>/. <id>:/work` copies the directory's *contents* (the trailing
        // `/.`) into the working directory rather than nesting it under `/work`.
        let copy = vec![
            "cp".to_string(),
            format!("{source}/."),
            format!("{}:{WORK_DIR}", container.id),
        ];
        let output = self.run(&copy).await?;
        if !output.status.success() {
            return Err(Error::ContainerRuntime(format!(
                "seeding `{WORK_DIR}` from `{source}` failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        let chown = vec![
            "exec".to_string(),
            "--user".to_string(),
            "0".to_string(),
            container.id.clone(),
            "chown".to_string(),
            "--recursive".to_string(),
            format!("{RUN_USER}:{RUN_USER}"),
            WORK_DIR.to_string(),
        ];
        let output = self.run(&chown).await?;
        if !output.status.success() {
            return Err(Error::ContainerRuntime(format!(
                "handing `{WORK_DIR}` to `{RUN_USER}` failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(())
    }

    /// Materialize files into the started container at their absolute paths,
    /// owned by the run user with the requested mode.
    ///
    /// Subscription authentication needs a harness's credential files visible
    /// inside the container at the paths its CLI reads from `$HOME`
    /// (`/home/node`). Each file's bytes are staged in a private host temp file
    /// (created `0600`) and copied in with `cp`, mirroring how the working tree
    /// is seeded — copying a file rather than piping bytes through a command line
    /// keeps secret contents off any argument list. The copied file is then
    /// handed to the run user and its mode tightened, since `cp` sets neither
    /// consistently across runtimes.
    async fn materialize_files(
        &self,
        container: &ContainerHandle,
        files: &[ContainerFile],
    ) -> Result<()> {
        for file in files {
            // Create the parent directory as the run user so the tree under its
            // home stays user-owned (and writable, should the CLI refresh the
            // credential mid-session).
            if let Some(parent) = parent_dir(&file.container_path) {
                let mkdir = vec![
                    "exec".to_string(),
                    "--user".to_string(),
                    RUN_USER.to_string(),
                    container.id.clone(),
                    "mkdir".to_string(),
                    "-p".to_string(),
                    parent.to_string(),
                ];
                let output = self.run(&mkdir).await?;
                if !output.status.success() {
                    return Err(Error::ContainerRuntime(format!(
                        "creating `{parent}` in the container failed: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    )));
                }
            }

            let mut temp = NamedTempFile::new().map_err(|err| {
                Error::ContainerRuntime(format!(
                    "staging a container file on the host failed: {err}"
                ))
            })?;
            temp.write_all(&file.contents)
                .and_then(|()| temp.flush())
                .map_err(|err| {
                    Error::ContainerRuntime(format!(
                        "staging a container file on the host failed: {err}"
                    ))
                })?;
            let source = temp.path().to_str().ok_or_else(|| {
                Error::ContainerRuntime("staged container file path is not valid UTF-8".to_string())
            })?;
            let copy = vec![
                "cp".to_string(),
                source.to_string(),
                format!("{}:{}", container.id, file.container_path),
            ];
            let output = self.run(&copy).await?;
            if !output.status.success() {
                return Err(Error::ContainerRuntime(format!(
                    "copying a file to `{}` in the container failed: {}",
                    file.container_path,
                    String::from_utf8_lossy(&output.stderr).trim()
                )));
            }

            // Hand the file to the run user and tighten its mode (run as uid 0 to
            // chown). Container paths are fixed, quote-free constants, so single
            // quotes are a safe shell escape here.
            let fixup = vec![
                "exec".to_string(),
                "--user".to_string(),
                "0".to_string(),
                container.id.clone(),
                "sh".to_string(),
                "-c".to_string(),
                format!(
                    "chown {RUN_USER}:{RUN_USER} '{path}' && chmod {mode:o} '{path}'",
                    path = file.container_path,
                    mode = file.mode,
                ),
            ];
            let output = self.run(&fixup).await?;
            if !output.status.success() {
                return Err(Error::ContainerRuntime(format!(
                    "setting ownership and mode on `{}` in the container failed: {}",
                    file.container_path,
                    String::from_utf8_lossy(&output.stderr).trim()
                )));
            }
        }
        Ok(())
    }
}

/// The parent-directory portion of an absolute container path, or `None` when it
/// has no non-empty parent (a file at the filesystem root).
fn parent_dir(path: &str) -> Option<&str> {
    path.rsplit_once('/')
        .map(|(parent, _)| parent)
        .filter(|parent| !parent.is_empty())
}

/// Build the `run` argument vector that starts a container from a spec.
///
/// Pure given the spec, so the flags a run is launched with — in particular
/// which of them carry environment — are unit-tested without a container
/// runtime, the way the Kubernetes runtime's manifest construction is.
fn run_args(spec: &ContainerSpec) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "--detach".to_string(),
        "--pull".to_string(),
        "missing".to_string(),
        "--volume".to_string(),
        WORK_DIR.to_string(),
        "--workdir".to_string(),
        WORK_DIR.to_string(),
    ];
    if !spec.network_enabled {
        args.push("--network".to_string());
        args.push("none".to_string());
    }
    // Host mappings that give the container a route back to the run host (for
    // the live asset preview, `host.docker.internal:host-gateway`, and for a
    // harness exporting telemetry to a collector on the run host). Both Docker
    // and Podman accept `--add-host`, and `host-gateway` resolves to a
    // host-reachable address on each. Empty when a run needs neither.
    for mapping in &spec.add_hosts {
        args.push("--add-host".to_string());
        args.push(mapping.clone());
    }
    // Non-secret environment (harness telemetry configuration) and secrets both
    // become `--env` flags; they are separate fields only so that the non-secret
    // half stays safe to log. Secrets are applied last so a malformed telemetry
    // variable can never shadow the API key the harness authenticates with.
    for (key, value) in spec.env.iter().chain(spec.secrets.iter()) {
        args.push("--env".to_string());
        args.push(format!("{key}={value}"));
    }
    args.push(spec.image.clone());
    args
}

#[cfg(test)]
#[path = "container.test.rs"]
mod tests;

#[async_trait::async_trait]
impl ContainerRuntime for CliContainerRuntime {
    // `spec` is skipped: it carries the run's secrets (API keys passed as
    // container env vars). Only the non-sensitive image reference is recorded.
    #[instrument(name = "container.start", skip_all, fields(image = %spec.image), err)]
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerStart> {
        // The seeded repository is copied into the container after it starts
        // rather than bind-mounted from the host (see `seed_workdir`): an
        // anonymous volume keeps `/work` on the runtime's own Linux storage on
        // every platform, sidestepping the Windows partition's unwritable DrvFs
        // mount, and is removed together with the container by `stop`'s
        // `--volumes`.
        //
        // Pull the image if it is not already present locally: the harness image
        // comes from a registry (resolved by digest), not a prior local build, so
        // a missing image must be fetched rather than failing the run. An image
        // already pulled by an earlier run is reused (digest refs are immutable).
        let args = run_args(spec);

        let output = self.run(&args).await?;
        if !output.status.success() {
            return Err(Error::ContainerRuntime(format!(
                "starting container from `{}` failed: {}",
                spec.image,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        let handle = ContainerHandle {
            id: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        };

        // Seed the working tree now that the container exists. On any failure the
        // just-started container is torn down so a failed start leaks nothing.
        if let Err(err) = self.seed_workdir(&handle, &spec.repo_path).await {
            let _ = self.stop(&handle).await;
            return Err(err);
        }

        // Materialize any credential files (subscription authentication) at the
        // paths the harness CLI reads under the run user's home, before the
        // session. Same torn-down-on-failure contract as seeding.
        if let Err(err) = self.materialize_files(&handle, &spec.files).await {
            let _ = self.stop(&handle).await;
            return Err(err);
        }
        // A host Docker/Podman admits the container immediately — there is no
        // scheduler queue to wait behind, so the start spent no time queued.
        Ok(ContainerStart::ready(handle))
    }

    async fn exec(&self, container: &ContainerHandle, command: &[String]) -> Result<ExecOutput> {
        let mut args = vec![
            "exec".to_string(),
            "--workdir".to_string(),
            WORK_DIR.to_string(),
            container.id.clone(),
        ];
        args.extend(command.iter().cloned());

        let output = self.run(&args).await?;
        Ok(ExecOutput {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            idle_timed_out: false,
        })
    }

    #[instrument(name = "container.exec_streamed", skip_all, fields(container.id = %container.id), err)]
    async fn exec_streamed(
        &self,
        container: &ContainerHandle,
        command: &[String],
        idle_timeout: Option<Duration>,
        sink: &mut dyn OutputSink,
    ) -> Result<ExecOutput> {
        let mut args = vec![
            "exec".to_string(),
            "--workdir".to_string(),
            WORK_DIR.to_string(),
            container.id.clone(),
        ];
        args.extend(command.iter().cloned());

        // The harness is non-interactive, so close stdin: a harness that probes
        // stdin (Codex prints "Reading additional input from stdin...") then sees
        // EOF immediately instead of blocking on a stream that never arrives.
        let mut spawn = Command::new(&self.binary);
        spawn
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Propagate the current trace context to the runtime CLI itself, matching
        // [`run`]; a no-op when nothing is in scope to propagate.
        //
        // This reaches the `docker`/`podman` client process, **not** the process
        // inside the container: `docker exec` does not forward the client's
        // environment across the daemon. The harness's own `TRACEPARENT` is set
        // on the container at start time instead, from
        // [`ContainerSpec::env`](crate::execution::ContainerSpec::env) — see
        // [`crate::harness_telemetry`].
        if let Some(traceparent) = test_cabinet_telemetry::propagation::current_traceparent() {
            spawn.env("TRACEPARENT", traceparent);
        }
        let mut child = spawn.spawn().map_err(|err| {
            Error::ContainerRuntime(format!("failed to run {}: {err}", self.binary))
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            Error::ContainerRuntime("failed to capture container stdout".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            Error::ContainerRuntime("failed to capture container stderr".to_string())
        })?;
        let mut stdout = BufReader::new(stdout).lines();
        let mut stderr = BufReader::new(stderr).lines();

        let drained = drain_with_idle_timeout(&mut stdout, &mut stderr, idle_timeout, sink).await?;

        if drained.idle_timed_out {
            // The command will never finish on its own, so detach from it rather
            // than blocking forever in `wait`. This kills the `docker`/`podman`
            // client, not the process inside the container — that one dies with
            // the container, which the caller tears down immediately after a
            // failed run. The exit code of a process we killed says nothing about
            // the run; `idle_timed_out` is what the caller acts on.
            let _ = child.kill().await;
            return Ok(ExecOutput {
                exit_code: -1,
                stdout: drained.stdout,
                stderr: drained.stderr,
                idle_timed_out: true,
            });
        }

        let status = child.wait().await.map_err(|err| {
            Error::ContainerRuntime(format!("waiting on {} failed: {err}", self.binary))
        })?;
        Ok(ExecOutput {
            exit_code: status.code().unwrap_or(-1),
            stdout: drained.stdout,
            stderr: drained.stderr,
            idle_timed_out: false,
        })
    }

    async fn stop(&self, container: &ContainerHandle) -> Result<()> {
        let args = vec![
            "rm".to_string(),
            "--force".to_string(),
            "--volumes".to_string(),
            container.id.clone(),
        ];
        let output = self.run(&args).await?;
        if !output.status.success() {
            return Err(Error::ContainerRuntime(format!(
                "removing container `{}` failed: {}",
                container.id,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(())
    }

    async fn pull(&self, image: &str) -> Result<()> {
        // Already present (a prior run pulled it, or it is a local build with no
        // registry behind it): nothing to do. This keeps the pull idempotent and
        // matches the `--pull missing` policy `start` uses, so a local image is
        // never needlessly resolved against a registry.
        if self.image_present(image).await {
            return Ok(());
        }
        let args = vec!["pull".to_string(), image.to_string()];
        let output = self.run(&args).await?;
        if !output.status.success() {
            return Err(Error::ContainerRuntime(format!(
                "pulling image `{}` failed: {}",
                image,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(())
    }

    async fn image_digest(&self, image: &str) -> Result<Option<String>> {
        // Read the image's first repo digest. An image pulled from a registry has
        // one (`repo@sha256:…`); a local build has an empty `RepoDigests`, so the
        // template yields an empty string and we report no digest. A failed
        // inspect (image absent) is likewise reported as no digest rather than an
        // error — recording falls back to the launch reference.
        let args = vec![
            "image".to_string(),
            "inspect".to_string(),
            "--format".to_string(),
            "{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}".to_string(),
            image.to_string(),
        ];
        let output = self.run(&args).await?;
        if !output.status.success() {
            return Ok(None);
        }
        let digest = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok((!digest.is_empty()).then_some(digest))
    }
}

/// Collects a finished run's working tree by copying it out of the container.
#[derive(Debug, Clone)]
pub struct CliArtifactCollector {
    /// The runtime used to copy from the container.
    runtime: CliContainerRuntime,
    /// Base directory collected working trees are written under.
    base_dir: PathBuf,
}

impl CliArtifactCollector {
    /// Collect into unique directories under `base_dir` using `runtime`.
    pub fn new(runtime: CliContainerRuntime, base_dir: impl Into<PathBuf>) -> Self {
        Self {
            runtime,
            base_dir: base_dir.into(),
        }
    }
}

#[async_trait::async_trait]
impl ArtifactCollector for CliArtifactCollector {
    async fn collect(&self, container: &ContainerHandle) -> Result<ArtifactCollection> {
        let dest = self.base_dir.join(format!("artifact-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dest).map_err(|err| Error::ArtifactCollection(err.to_string()))?;
        let dest_str = dest
            .to_str()
            .ok_or_else(|| Error::ArtifactCollection("dest path is not valid UTF-8".to_string()))?;

        // `cp <id>:/work/. <dest>` copies the contents of the working tree out to
        // the native host path. `cp` is handled by the runtime CLI on the host,
        // so the destination is used verbatim — a Windows `C:\...` path, not its
        // `/mnt/c/...` WSL form.
        let args = vec![
            "cp".to_string(),
            format!("{}:{WORK_DIR}/.", container.id),
            dest_str.to_string(),
        ];
        let output = self.runtime.run(&args).await?;
        if !output.status.success() {
            return Err(Error::ArtifactCollection(format!(
                "copying `{WORK_DIR}` from container `{}` failed: {}",
                container.id,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(ArtifactCollection { repo_path: dest })
    }
}
