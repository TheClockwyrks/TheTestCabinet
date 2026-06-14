//! Execution environment: containerization, seeding, and artifact collection.
//!
//! See `docs/execution.md`. Every run executes inside an isolated, containerized
//! environment seeded with a fresh git repository containing only what the model
//! needs: the test case's specification and its assets. Reference visuals are
//! never seeded.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::test_case::TestCaseVersion;

/// A request to seed a run's repository.
///
/// Seeding creates a fresh git repository with a clean initial commit, no
/// upstream remote, and no prior history, containing only the test case's
/// specification and assets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedRequest<'a> {
    /// The resolved test case version to seed from.
    pub test_case: &'a TestCaseVersion,
}

/// A seeded run repository, ready to be mounted into a container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeededRepo {
    /// Path to the freshly created repository on the host.
    pub path: PathBuf,
    /// The initial commit hash of the seeded repository.
    pub initial_commit: String,
}

/// Seeds fresh per-run repositories.
///
/// A new repository is created per run so that no prior history exists; models
/// have been observed recovering deleted reference implementations from git
/// history.
pub trait RepoSeeder: Send + Sync {
    /// Create a fresh git repository seeded with the specification and assets
    /// only. Reference visuals must **not** be included.
    fn seed(&self, request: &SeedRequest<'_>) -> Result<SeededRepo>;
}

/// Specification for launching a run container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerSpec {
    /// The container image to run.
    pub image: String,
    /// The host path of the seeded repository to mount as the working tree.
    pub repo_path: PathBuf,
    /// Secrets (such as API keys) supplied to the container. These must never be
    /// written into the seeded repository or committed anywhere.
    pub secrets: BTreeMap<String, String>,
    /// Whether the container is granted outbound network access. Isolation
    /// protects the host filesystem and other runs, not the network, so this is
    /// expected to be enabled.
    pub network_enabled: bool,
}

/// A handle to a running container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerHandle {
    /// Runtime-specific identifier for the container.
    pub id: String,
}

/// Abstraction over a container runtime (Docker, Podman, or compatible).
///
/// Hard-coding a single runtime is avoided so compatible runtimes can be swapped
/// in.
#[async_trait::async_trait]
pub trait ContainerRuntime: Send + Sync {
    /// Start a container from the given spec, mounting the seeded repository and
    /// supplying secrets, without granting host filesystem access beyond the
    /// mounted repository.
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerHandle>;

    /// Run a command inside the container and wait for it to finish.
    async fn exec(&self, container: &ContainerHandle, command: &[String]) -> Result<ExecOutput>;

    /// Stop and remove the container.
    async fn stop(&self, container: &ContainerHandle) -> Result<()>;

    /// Run a single command in a throwaway container from an image and capture
    /// its output. Used for cost-free probes such as a harness `--version`
    /// check; it must not require pulling the image from a remote registry.
    async fn run_once(&self, image: &str, command: &[String]) -> Result<ExecOutput>;
}

/// Output of a command executed inside a container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutput {
    /// The process exit code.
    pub exit_code: i32,
    /// Captured standard output.
    pub stdout: String,
    /// Captured standard error.
    pub stderr: String,
}

/// The collected output of a finished run.
///
/// When a run finishes, the working tree is collected as the run's primary
/// artifact. This produced repository is what gets validated and, if published,
/// released.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactCollection {
    /// Host path to the collected working tree.
    pub repo_path: PathBuf,
}

/// Collects artifacts from a finished run's container.
#[async_trait::async_trait]
pub trait ArtifactCollector: Send + Sync {
    /// Collect the run's working tree from the container as the primary
    /// artifact.
    async fn collect(&self, container: &ContainerHandle) -> Result<ArtifactCollection>;
}
