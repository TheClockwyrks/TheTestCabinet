//! Execution environment: containerization, seeding, and artifact collection.
//!
//! See `docs/execution.md`. Every run executes inside an isolated, containerized
//! environment seeded with a fresh git repository containing what the model
//! needs: the test case's specification, its assets, and the rendered reference
//! screenshots that serve as visual targets. The reference *source* mockups are
//! never seeded.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::reference::RenderedReference;
use crate::test_case::{SpecFile, TestCaseVersion, Variant, WorkspaceFile};

/// The directory the seeded run repository is copied into inside the run
/// container, and the working directory the harness builds in. Spec `dest` paths
/// are relative to this, so the rendered prompt can point the model at absolute
/// in-container paths.
pub const WORKSPACE_DIR: &str = "/work";

/// A request to seed a run's repository.
///
/// Seeding creates a fresh git repository with a clean initial commit, no
/// upstream remote, and no prior history, containing the test case's
/// specification, assets, and the rendered reference screenshots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedRequest<'a> {
    /// The resolved test case version to seed from.
    pub test_case: &'a TestCaseVersion,
    /// The selected variant. Its specs are what [`Self::specs`] holds, and it is
    /// the context handed to any `.hbs` spec template rendered while seeding.
    pub variant: &'a Variant,
    /// The specs to seed for the selected variant. A spec whose source is a
    /// `.hbs` template is rendered into its `dest`; any other spec is copied
    /// verbatim. Obtain these from [`TestCaseVersion::seeded_specs`] for the
    /// chosen variant.
    pub specs: &'a [SpecFile],
    /// The starter workspace files to seed for the selected variant, copied
    /// verbatim into the run's root before the specs. Obtain these from
    /// [`TestCaseVersion::workspace_for`] for the chosen variant; empty when the
    /// case declares no workspace.
    pub workspace: &'a [WorkspaceFile],
    /// Reference screenshots rendered for this run, seeded as visual targets.
    /// The reference source mockups they were rendered from are not seeded.
    pub references: &'a [RenderedReference],
}

/// A seeded run repository, ready to be copied into a container.
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
    /// Create a fresh git repository seeded with the specification, assets, and
    /// the rendered reference screenshots. The reference *source* mockups must
    /// **not** be included.
    fn seed(&self, request: &SeedRequest<'_>) -> Result<SeededRepo>;
}

/// Specification for launching a run container.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerSpec {
    /// The container image to run.
    pub image: String,
    /// The host path of the seeded repository to copy in as the working tree.
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

/// Which standard stream a captured output line came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputStream {
    /// Standard output.
    Stdout,
    /// Standard error.
    Stderr,
}

/// One captured line of a command's output, tagged with the stream it came from.
///
/// A run records every raw line in arrival order so the harness's untranslated
/// output can be replayed through an [`EventParser`](crate::event::EventParser)
/// and the translation checked against the recorded normalized events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawOutputLine {
    /// The stream the line was written to.
    pub stream: OutputStream,
    /// The line, without its trailing newline.
    pub line: String,
}

/// Observes a command's output line by line as it is produced.
///
/// A streaming exec calls this for each line as the underlying process writes
/// it, before the command finishes, which is what lets callers translate output
/// into live [events](crate::event) rather than waiting for the full result.
pub trait OutputSink: Send {
    /// Handle one line of output from the given stream. The trailing newline is
    /// not included.
    fn on_line(&mut self, stream: OutputStream, line: &str);
}

/// Abstraction over a container runtime (Docker, Podman, or compatible).
///
/// Hard-coding a single runtime is avoided so compatible runtimes can be swapped
/// in.
#[async_trait::async_trait]
pub trait ContainerRuntime: Send + Sync {
    /// Start a container from the given spec, copying the seeded repository into
    /// its working tree and supplying secrets, without granting access to the
    /// host filesystem.
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerHandle>;

    /// Run a command inside the container and wait for it to finish.
    async fn exec(&self, container: &ContainerHandle, command: &[String]) -> Result<ExecOutput>;

    /// Run a command inside the container, forwarding each output line to `sink`
    /// as it is produced, and return the full captured output once it finishes.
    ///
    /// The default implementation falls back to the buffered [`exec`] and replays
    /// the captured output to the sink afterwards, so a runtime that does not
    /// stream still drives observers correctly. Runtimes that can stream override
    /// this to deliver lines live.
    ///
    /// [`exec`]: ContainerRuntime::exec
    async fn exec_streamed(
        &self,
        container: &ContainerHandle,
        command: &[String],
        sink: &mut dyn OutputSink,
    ) -> Result<ExecOutput> {
        let output = self.exec(container, command).await?;
        for line in output.stdout.lines() {
            sink.on_line(OutputStream::Stdout, line);
        }
        for line in output.stderr.lines() {
            sink.on_line(OutputStream::Stderr, line);
        }
        Ok(output)
    }

    /// Stop and remove the container.
    async fn stop(&self, container: &ContainerHandle) -> Result<()>;

    /// Ensure `image` is present in local storage, fetching it from its registry
    /// if it is not already pulled.
    ///
    /// This mirrors the `--pull missing` policy [`start`] uses: an image already
    /// present — including a purely local build with no registry behind it — is
    /// left untouched, and only a genuinely absent image is fetched. A run pulls
    /// the base image up front so it fails fast with a clear error on an
    /// unreachable registry, and so the run's exact image bytes can be resolved
    /// to a digest before the session.
    ///
    /// The default implementation is a no-op, for runtimes whose images are
    /// always present locally.
    ///
    /// [`start`]: ContainerRuntime::start
    async fn pull(&self, _image: &str) -> Result<()> {
        Ok(())
    }

    /// The registry digest reference (`repo@sha256:…`) of a locally-present image,
    /// if it has one. An image pulled from a registry carries a digest; a purely
    /// local build does not. Lets a run record the exact image bytes it ran even
    /// when the image was launched by a mutable tag. The default returns `None`
    /// (no digest known); CLI-backed runtimes resolve it from the image metadata.
    async fn image_digest(&self, _image: &str) -> Result<Option<String>> {
        Ok(None)
    }
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
