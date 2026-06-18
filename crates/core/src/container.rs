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
    async fn run(&self, args: &[String]) -> Result<std::process::Output> {
        Command::new(&self.binary)
            .args(args)
            .output()
            .await
            .map_err(|err| Error::ContainerRuntime(format!("failed to run {}: {err}", self.binary)))
    }
}

#[async_trait::async_trait]
impl ContainerRuntime for CliContainerRuntime {
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerHandle> {
        let mount_source = crate::host_path::mount_source(&spec.repo_path)?;

        // Pull the image if it is not already present locally: the harness image
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
        let mut child = Command::new(&self.binary)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| {
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
