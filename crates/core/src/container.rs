//! Concrete container runtime and artifact collector backed by a CLI.
//!
//! See `docs/execution.md`. This drives a Docker- or Podman-compatible runtime
//! through its command line so no single runtime is hard-coded. A run container
//! is started detached from the harness's image, the seeded repository is bind
//! mounted at `/work`, secrets are passed as environment variables, and the
//! produced working tree is collected when the run finishes.

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

/// The container working directory the seeded repository is mounted at. Matches
/// the `WORKDIR` of the run-container images (`containers/base/Dockerfile`).
const WORK_DIR: &str = "/work";

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

    /// Whether the configured runtime is Podman. On native Linux this selects the
    /// uid-mapping flag that keeps the container's `node` user able to write the
    /// bind-mounted repository; see [`ContainerRuntime::start`] for why that flag
    /// is scoped to Linux.
    fn is_podman(&self) -> bool {
        Path::new(&self.binary)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains("podman"))
            .unwrap_or(false)
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
}

#[async_trait::async_trait]
impl ContainerRuntime for CliContainerRuntime {
    // `spec` is skipped: it carries the run's secrets (API keys passed as
    // container env vars). Only the non-sensitive image reference is recorded.
    #[instrument(name = "container.start", skip_all, fields(image = %spec.image), err)]
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerHandle> {
        let mount_source = crate::host_path::mount_source(&spec.repo_path)?;

        // Pull the image if it is not already present locally: the base image
        // comes from a registry (resolved by digest), not a prior local build, so
        // a missing image must be fetched rather than failing the run. An image
        // already pulled by an earlier run is reused (digest refs are immutable).
        let mut args = vec![
            "run".to_string(),
            "--detach".to_string(),
            "--pull".to_string(),
            "missing".to_string(),
        ];
        if self.is_podman() && cfg!(target_os = "linux") {
            // Rootless Podman on Linux runs the container directly on the host, so
            // map the invoking host user to the container's uid to keep the
            // mounted repository writable by the run user. On macOS and Windows
            // Podman runs the container inside its own Linux VM; the host user has
            // no meaning there and `keep-id` would map to the wrong uid, so it is
            // omitted and the VM's default mapping is used.
            args.push("--userns=keep-id".to_string());
        }
        args.push("--volume".to_string());
        args.push(format!("{mount_source}:{WORK_DIR}"));
        args.push("--workdir".to_string());
        args.push(WORK_DIR.to_string());
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
        Ok(ContainerHandle {
            id: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        })
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

        // `cp <id>:/work/. <dest>` copies the contents of the working tree.
        // Unlike a bind-mount source, the destination is not run through
        // `host_path::mount_source`: `cp` is handled by the runtime CLI on the
        // host, so it writes to the native host path directly (a Windows
        // `C:\...` path, not its `/mnt/c/...` WSL form).
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
