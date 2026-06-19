//! Concrete container runtime and artifact collector backed by a CLI.
//!
//! See `docs/execution.md`. This drives a Docker- or Podman-compatible runtime
//! through its command line so no single runtime is hard-coded. A run container
//! is started detached from the harness's image, the seeded repository is copied
//! into a runtime-managed volume at `/work`, secrets are passed as environment
//! variables, and the produced working tree is collected when the run finishes.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::instrument;
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::execution::{
    ArtifactCollection, ArtifactCollector, ContainerHandle, ContainerRuntime, ContainerSpec,
    ExecOutput, OutputSink, OutputStream,
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
}

#[async_trait::async_trait]
impl ContainerRuntime for CliContainerRuntime {
    // `spec` is skipped: it carries the run's secrets (API keys passed as
    // container env vars). Only the non-sensitive image reference is recorded.
    #[instrument(name = "container.start", skip_all, fields(image = %spec.image), err)]
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerHandle> {
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
        for (key, value) in &spec.secrets {
            args.push("--env".to_string());
            args.push(format!("{key}={value}"));
        }
        args.push(spec.image.clone());

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
        Ok(handle)
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
        })
    }

    #[instrument(name = "container.exec_streamed", skip_all, fields(container.id = %container.id), err)]
    async fn exec_streamed(
        &self,
        container: &ContainerHandle,
        command: &[String],
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
        // Propagate the current trace context to the harness process so it can
        // continue this trace; a no-op when nothing is in scope to propagate.
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

        let mut captured_stdout = String::new();
        let mut captured_stderr = String::new();
        let mut stdout_open = true;
        let mut stderr_open = true;

        // Drain both streams concurrently so neither blocks the other by filling
        // its pipe buffer, forwarding each line to the sink as it arrives. Only
        // one select branch runs at a time, so the sink is never borrowed twice.
        while stdout_open || stderr_open {
            tokio::select! {
                line = stdout.next_line(), if stdout_open => match read_line(line)? {
                    Some(line) => {
                        sink.on_line(OutputStream::Stdout, &line);
                        captured_stdout.push_str(&line);
                        captured_stdout.push('\n');
                    }
                    None => stdout_open = false,
                },
                line = stderr.next_line(), if stderr_open => match read_line(line)? {
                    Some(line) => {
                        sink.on_line(OutputStream::Stderr, &line);
                        captured_stderr.push_str(&line);
                        captured_stderr.push('\n');
                    }
                    None => stderr_open = false,
                },
            }
        }

        let status = child.wait().await.map_err(|err| {
            Error::ContainerRuntime(format!("waiting on {} failed: {err}", self.binary))
        })?;
        Ok(ExecOutput {
            exit_code: status.code().unwrap_or(-1),
            stdout: captured_stdout,
            stderr: captured_stderr,
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

    async fn run_once(&self, image: &str, command: &[String]) -> Result<ExecOutput> {
        let Some(entrypoint) = command.first() else {
            return Err(Error::ContainerRuntime(
                "run_once requires a command".to_string(),
            ));
        };
        // `--pull never`: this one-shot is the harness availability probe, which
        // must stay cost-free and must never fetch anything (see
        // `Harness::check_availability` and `docs/harnesses.md`). A registry image
        // that has not been pulled yet is therefore reported unavailable — pulling
        // it is a stronger action reserved for an actual run (which uses
        // `--pull missing` in `start`), not for a cheap availability check.
        let mut args = vec![
            "run".to_string(),
            "--rm".to_string(),
            "--pull".to_string(),
            "never".to_string(),
            "--entrypoint".to_string(),
            entrypoint.clone(),
            image.to_string(),
        ];
        args.extend(command.iter().skip(1).cloned());

        let output = self.run(&args).await?;
        Ok(ExecOutput {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
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

/// Map a line read from a piped stream into our [`Result`], turning an I/O error
/// into a container runtime error.
fn read_line(line: std::io::Result<Option<String>>) -> Result<Option<String>> {
    line.map_err(|err| Error::ContainerRuntime(format!("reading container output failed: {err}")))
}
