//! Concrete container runtime and artifact collector backed by a CLI.
//!
//! See `docs/execution.md`. This drives a Docker- or Podman-compatible runtime
//! through its command line so no single runtime is hard-coded. A run container
//! is started detached from the harness's image, the seeded repository is bind
//! mounted at `/work`, secrets are passed as environment variables, and the
//! produced working tree is collected when the run finishes.

use std::path::{Path, PathBuf};

use tokio::process::Command;
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::execution::{
    ArtifactCollection, ArtifactCollector, ContainerHandle, ContainerRuntime, ContainerSpec,
    ExecOutput,
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
            if which(candidate) {
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

    /// Whether the configured runtime is Podman, which needs uid-mapping flags so
    /// the container's `node` user can write the bind-mounted repository.
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
        let repo = spec
            .repo_path
            .to_str()
            .ok_or_else(|| Error::ContainerRuntime("repo path is not valid UTF-8".to_string()))?;

        let mut args = vec!["run".to_string(), "--detach".to_string()];
        if self.is_podman() {
            // Map the invoking host user to the container's uid so the mounted
            // repository remains writable by the run user.
            args.push("--userns=keep-id".to_string());
        }
        args.push("--volume".to_string());
        args.push(format!("{repo}:{WORK_DIR}"));
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
        // `--pull never` keeps the probe cost-free and fast: a missing image
        // fails immediately rather than reaching out to a registry.
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

/// Whether a binary resolves on `PATH`.
fn which(binary: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| dir.join(binary).is_file())
}
