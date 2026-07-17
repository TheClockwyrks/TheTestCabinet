//! Execution environment: containerization, seeding, and artifact collection.
//!
//! See `docs/execution.md`. Every run executes inside an isolated, containerized
//! environment seeded with a fresh git repository containing what the model
//! needs: the test case's specification, its assets, and the rendered reference
//! screenshots that serve as visual targets. The reference *source* mockups are
//! never seeded.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::preview::LivePreviewEndpoint;
use crate::reference::RenderedReference;
use crate::test_case::{SpecFile, TestCaseVersion, Variant, WorkspaceFile};

/// The directory the seeded run repository is copied into inside the run
/// container, and the working directory the harness builds in. Spec `dest` paths
/// are relative to this, so the rendered prompt can point the model at absolute
/// in-container paths.
pub const WORKSPACE_DIR: &str = "/work";

/// The workspace-relative folder a game-jam run's *previous entries* are seeded
/// into: the gameplay READMEs of earlier runs of the same jam with the same harness
/// and model. It is reference material for building something distinct, not part of
/// the submission, so seeding git-ignores it (see [`crate::seeding`]). Both the
/// seeder (which writes it) and the prompt (which points the model at it) name it
/// through this constant so they never drift.
pub const GAME_JAM_PRIOR_ENTRIES_DIR: &str = "previous-entries";

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
    /// The live-preview listener's address, when a viewer is observing this run.
    /// For an asset-generation run this is written into the seeded
    /// `draw.config.json` so the drawing binary streams each frame back to the
    /// host; `None` for an unobserved run, which seeds no live endpoint.
    pub live_preview: Option<&'a LivePreviewEndpoint>,
    /// Earlier game-jam entries — the gameplay READMEs of prior runs of the same
    /// jam with the same harness and model — to seed as reference material so this
    /// run can build something distinct. Seeded into
    /// [`GAME_JAM_PRIOR_ENTRIES_DIR`](crate::execution::GAME_JAM_PRIOR_ENTRIES_DIR)
    /// and deliberately git-ignored (they are context, not part of the submission).
    /// Empty for every non-game-jam run and for a jam's first run.
    pub prior_game_jam_entries: &'a [crate::run_record::PriorGameJamEntry],
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
    /// Files materialized inside the container before the session, at absolute
    /// paths under the run user's home. This is how subscription-authentication
    /// credential files are made visible to a harness's CLI; it is empty for an
    /// API-key run. Like [`secrets`](Self::secrets), these may carry credentials
    /// and must never be written into the seeded repository or committed.
    pub files: Vec<ContainerFile>,
    /// Whether the container is granted outbound network access. Isolation
    /// protects the host filesystem and other runs, not the network, so this is
    /// expected to be enabled.
    pub network_enabled: bool,
    /// Extra host-to-IP mappings to add to the container's `/etc/hosts`, each in
    /// the runtime's `--add-host` form (`hostname:ip`). Used to give the container
    /// a route to the run host for the live asset preview
    /// (`host.docker.internal:host-gateway`); empty for a run with no live viewer.
    pub add_hosts: Vec<String>,
}

/// A file to materialize inside a started run container.
///
/// Subscription authentication needs a harness's credential files present in
/// the container at the paths its CLI reads (under the run user's `$HOME`).
/// Carrying the bytes here — rather than a host path — keeps the runtime free of
/// host-path coupling and lets an in-memory runtime used by tests record exactly
/// what would be written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerFile {
    /// Absolute destination path inside the container (for example
    /// `/home/node/.codex/auth.json`).
    pub container_path: String,
    /// The file's raw bytes.
    pub contents: Vec<u8>,
    /// The Unix mode the file is given — for example `0o600` so a credential is
    /// never left group- or world-readable.
    pub mode: u32,
}

/// A handle to a running container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerHandle {
    /// Runtime-specific identifier for the container.
    pub id: String,
}

/// The result of starting a container: a handle to it, plus how long the start
/// spent merely *waiting for capacity* before any startup work began.
///
/// On a busy cluster a run pod can sit `Pending` for a while because the
/// scheduler has nowhere to place it yet — it is queued, not broken. That queue
/// time is wall-clock the run did not spend doing anything, so it is reported
/// separately here and excluded from the run's measured duration. Runtimes that
/// admit a container immediately (a local Docker/Podman) report
/// [`Duration::ZERO`].
#[derive(Debug, Clone)]
pub struct ContainerStart {
    /// Handle to the started container.
    pub handle: ContainerHandle,
    /// Wall-clock time the container spent queued for capacity before startup
    /// work (image pull, container creation) began. Excluded from the recorded
    /// run duration.
    pub scheduling_wait: Duration,
}

impl ContainerStart {
    /// A start with no scheduling wait — the container was admitted immediately.
    pub fn ready(handle: ContainerHandle) -> Self {
        Self {
            handle,
            scheduling_wait: Duration::ZERO,
        }
    }
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
    ///
    /// The returned [`ContainerStart`] carries the handle and how long the start
    /// spent queued for capacity (see [`ContainerStart::scheduling_wait`]); a
    /// runtime that admits the container immediately reports a zero wait.
    async fn start(&self, spec: &ContainerSpec) -> Result<ContainerStart>;

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
