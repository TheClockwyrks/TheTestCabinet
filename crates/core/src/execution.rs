//! Execution environment: containerization, seeding, and artifact collection.
//!
//! See `docs/execution.md`. Every run executes inside an isolated, containerized
//! environment seeded with a fresh git repository containing what the model
//! needs: the test case's specification, its assets, and the rendered reference
//! screenshots that serve as visual targets. The reference *source* mockups are
//! never seeded.

#[cfg(test)]
#[path = "execution.test.rs"]
mod tests;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::preview::LivePreviewEndpoint;
use crate::reference::RenderedReference;
use crate::test_case::{SpecFile, TestCaseVersion, Variant, WorkspaceFile};
use crate::validation::StepResult;

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

/// The workspace-relative folder the selected [engine](crate::engine)'s own
/// documentation is seeded into, copied out of the engine package's declared
/// `docs` directory.
///
/// It sits at the run root rather than under `.vendor/` because it is material the
/// model is *meant to read*: the engine documents itself from its own package, so
/// a case's specs never restate it and the rendered prompt points at
/// `/work/engine` instead. Both the seeder (which writes it) and the prompt (which
/// points the model at it) name it through this constant so they never drift —
/// the same reason [`GAME_JAM_PRIOR_ENTRIES_DIR`] exists. Empty of meaning for a
/// run with no engine, which seeds nothing here.
pub const ENGINE_DOCS_DIR: &str = "engine";

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
    /// [`GAME_JAM_PRIOR_ENTRIES_DIR`]
    /// and deliberately git-ignored (they are context, not part of the submission).
    /// Empty for every non-game-jam run and for a jam's first run.
    pub prior_game_jam_entries: &'a [crate::run_record::PriorGameJamEntry],
    /// The [engine](crate::engine) this run selected — the runtime the produced
    /// game is built on — when the caller resolved one.
    ///
    /// Seeding is where an engine becomes real: its package (and that package's
    /// `@clockwyrks` closure) is vendored into
    /// [`TCAB_ENGINE_DIR`](crate::test_case::TCAB_ENGINE_DIR), its own
    /// documentation is copied to [`ENGINE_DOCS_DIR`], and the seeded workspace
    /// `package.json` gains the matching `file:` dependency — the one file the
    /// harness ever rewrites, because an engine is a run dimension the (frozen)
    /// case cannot name for itself.
    ///
    /// `None` means no engine was selected, which is *exactly* what selecting
    /// [`NONE_SLUG`](crate::engine::NONE_SLUG) means: nothing is vendored and the
    /// seeded tree is byte-for-byte what it was before engines existed. Both
    /// spellings reach the same place, so a caller that never consulted the
    /// catalogue (a test standing up a repository, an older payload) need not
    /// invent a selection to say "no runtime".
    pub engine: Option<&'a crate::engine::ResolvedEngine>,
}

/// A seeded run repository, ready to be copied into a container.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeededRepo {
    /// Path to the freshly created repository on the host.
    pub path: PathBuf,
    /// The initial commit hash of the seeded repository.
    pub initial_commit: String,
    /// The version of the [engine](crate::engine) runtime vendored into this
    /// repository — the `version` declared by the package staged in the host
    /// package store — or `None` when the run selected an engine with no runtime.
    ///
    /// Read at seed time rather than inferred from the engine's slug, because the
    /// slug is stable while the runtime behind it moves: two runs of the same case
    /// under `simple-2d` months apart were built on different engines, and this is
    /// the only thing that says so. It is recorded on the run, which is why the
    /// seeder refuses to proceed when the staged package declares no real version
    /// rather than recording a placeholder.
    #[serde(default)]
    pub engine_version: Option<String>,
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
    /// Non-secret environment variables supplied to the container, alongside
    /// [`secrets`](Self::secrets).
    ///
    /// Kept separate from `secrets` precisely because these carry nothing
    /// sensitive: they are safe to log, to record on a tracing span, and to show
    /// in a diagnostic. Today this channel carries the harness telemetry
    /// configuration (the `OTEL_*` variables and the `TRACEPARENT` that links a
    /// harness's spans into the run's trace); see
    /// [`harness_telemetry`](crate::harness_telemetry). A value that *is*
    /// sensitive — an OTLP authorization header, for instance — belongs in
    /// `secrets` instead.
    pub env: BTreeMap<String, String>,
    /// Files materialized inside the container before the session, at absolute
    /// paths outside the seeded repository. This is how subscription-authentication
    /// credential files are made visible to a harness's CLI (under the run user's
    /// home) and how a harness that configures telemetry from a file rather than the
    /// environment (Codex, OpenCode) gets that file. Some of these carry credentials,
    /// so like [`secrets`](Self::secrets) they must never be written into the seeded
    /// repository or committed.
    pub files: Vec<ContainerFile>,
    /// Host directories whose contents are materialized inside the container before
    /// the session, at absolute paths outside the seeded repository. This is how a
    /// run's declared [audio packs](crate::audio_stage) are staged under `/opt/audio`.
    /// A tree carried here stays on the host until the container is started, so a
    /// palette of tens of megabytes never becomes a second copy held in the driver's
    /// memory for the run's duration.
    pub dirs: Vec<ContainerDir>,
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
/// host-path coupling, lets an in-memory runtime used by tests record exactly what
/// would be written, and keeps a secret off every argument list.
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

/// A host directory whose *contents* are materialized inside a started run
/// container, at an absolute path outside the seeded repository and owned by the
/// run user.
///
/// The counterpart of [`ContainerFile`] for a tree too large to carry as bytes on
/// the spec: a run's [staged audio palette](crate::audio_stage) is tens of
/// megabytes across dozens of files, and holding it inline would keep a second copy
/// resident in the driver for the whole run and cost a per-file round trip to
/// materialize. A tree carried here holds nothing sensitive, so it needs no
/// per-file mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContainerDir {
    /// The host directory to copy the contents of.
    pub host_path: PathBuf,
    /// Absolute destination directory inside the container (for example
    /// `/opt/audio`).
    pub container_path: String,
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
    /// When `idle_timeout` is set, a command that produces no output at all for
    /// that long is killed and the returned output is flagged
    /// [`idle_timed_out`](ExecOutput::idle_timed_out); see
    /// [`exec_stream`](crate::exec_stream) for why that bound exists.
    ///
    /// The default implementation falls back to the buffered [`exec`] and replays
    /// the captured output to the sink afterwards, so a runtime that does not
    /// stream still drives observers correctly. It cannot observe idleness — the
    /// output only arrives once the command has already finished — so it ignores
    /// `idle_timeout`. Runtimes that can stream override this to deliver lines
    /// live and to honour the watchdog.
    ///
    /// [`exec`]: ContainerRuntime::exec
    async fn exec_streamed(
        &self,
        container: &ContainerHandle,
        command: &[String],
        idle_timeout: Option<Duration>,
        sink: &mut dyn OutputSink,
    ) -> Result<ExecOutput> {
        let _ = idle_timeout;
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
    /// Whether the command was killed by the idle watchdog because it produced
    /// no output for
    /// [`HARNESS_IDLE_TIMEOUT`](crate::exec_stream::HARNESS_IDLE_TIMEOUT) rather
    /// than exiting on its own.
    ///
    /// A hung command has no meaningful exit code, so this is what distinguishes
    /// "the harness stopped responding" from "the harness failed" — see
    /// [`exec_stream`](crate::exec_stream).
    pub idle_timed_out: bool,
}

/// The case's dependency install, already run to its final outcome over a
/// collected tree.
///
/// The [toolchain stage](crate::toolchain_stage) runs the case's `[build]` install
/// over the collected tree so its commands have their dependencies, and validation
/// then needs that same tree installed. A lockfile install such as `npm ci` clears
/// `node_modules` and rebuilds it from the lockfile, so running the command a second
/// time reproduces the state it already produced. Carrying the recorded install on
/// the tree's own description is what lets validation skip the repeat and report the
/// recorded step in its place.
///
/// An install that did not succeed is carried too. The [verified
/// install](crate::install) has already made every attempt it is allowed, so its
/// failure is final: validation reports that step as its own and never builds the
/// tree, rather than spending the attempts over again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedInstall {
    /// The install command that was run, verbatim as the case's `[build]` table
    /// declares it. Validation compares its own case's install command against this
    /// before reusing the step, so a tree prepared by one command is never taken as
    /// preparation for a different one.
    pub command: String,
    /// The recorded outcome, reported by validation as its own install step so a
    /// reader sees the same summary whether or not validation ran the command.
    pub step: StepResult,
}

impl PreparedInstall {
    /// Describe the tree an install left behind, whatever it came to.
    pub fn recorded(step: &StepResult) -> Self {
        Self {
            command: step.command.trim().to_string(),
            step: step.clone(),
        }
    }
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
    /// The dependency install a [post-run stage](crate::post_run) already ran over
    /// this tree, when one did.
    ///
    /// Deliberately not serialized. This describes the tree as it stands in **this**
    /// process, right now, and the only writer is the engine stamping what its own
    /// stages just did to the tree it is about to validate. A value that could be
    /// persisted or shipped could outlive the tree it describes, and validation would
    /// then skip an install for a tree nobody ever installed into. Every collection
    /// built anywhere else — `tcab validate` against an implementation directory
    /// among them — starts with nothing prepared and installs for itself.
    #[serde(skip)]
    pub prepared_install: Option<PreparedInstall>,
    /// The [engine](crate::engine) the run that produced this tree selected, when
    /// the caller resolved one.
    ///
    /// A seeded tree is engine-specific: the engine's package is vendored into it,
    /// its documentation is copied beside the specs, and the build writes its game
    /// against that runtime's API. The selection is a property of the tree itself,
    /// so it is carried on the tree's own description rather than passed to every
    /// [`Validator`](crate::validation::Validator) implementation, only one of which
    /// has any use for it.
    ///
    /// Deliberately not serialized, for the same reason
    /// [`prepared_install`](Self::prepared_install) is not: it describes the tree as
    /// it stands in **this** process. The run record carries the run's engine slug
    /// and version for anything that reads the selection back later.
    #[serde(skip)]
    pub engine: Option<crate::engine::ResolvedEngine>,
}

impl ArtifactCollection {
    /// A tree at `repo_path` that nothing has prepared.
    pub fn new(repo_path: impl Into<PathBuf>) -> Self {
        Self {
            repo_path: repo_path.into(),
            prepared_install: None,
            engine: None,
        }
    }

    /// The same tree, now carrying the install that was run over it.
    #[must_use]
    pub fn prepared_by(mut self, install: Option<PreparedInstall>) -> Self {
        self.prepared_install = install;
        self
    }

    /// The same tree, now carrying the engine the run that produced it was built on.
    #[must_use]
    pub fn built_on(mut self, engine: Option<crate::engine::ResolvedEngine>) -> Self {
        self.engine = engine;
        self
    }

    /// The engine **runtime** this tree was built on, or `None` when the run vendored
    /// none.
    ///
    /// The filter is what makes the answer usable directly: a run that selected
    /// [`NONE_SLUG`](crate::engine::NONE_SLUG) resolved an engine supplying no
    /// runtime, and that is indistinguishable here from a tree recording no selection
    /// at all, because both are validated by driving the build in a browser.
    pub fn engine_runtime(&self) -> Option<&crate::engine::ResolvedEngine> {
        self.engine
            .as_ref()
            .filter(|engine| engine.provides_runtime())
    }

    /// The recorded install to reuse for `command`, when this tree has had exactly
    /// that command run over it.
    ///
    /// The comparison is what keeps the signal honest: a tree prepared by one case's
    /// install command answers only for that command, and any other caller gets
    /// `None` and installs for itself.
    pub fn prepared_install_for(&self, command: &str) -> Option<&PreparedInstall> {
        self.prepared_install
            .as_ref()
            .filter(|prepared| prepared.command == command.trim())
    }
}

/// Collects artifacts from a finished run's container.
#[async_trait::async_trait]
pub trait ArtifactCollector: Send + Sync {
    /// Collect the run's working tree from the container as the primary
    /// artifact.
    async fn collect(&self, container: &ContainerHandle) -> Result<ArtifactCollection>;

    /// Salvage **one** file out of a container by its absolute in-container path,
    /// writing it to `dest` on the host. Returns whether the file was recovered.
    ///
    /// This exists for the runs that never reach [`collect`](Self::collect) at all.
    /// A `hung` or `timed_out` run is torn down on the engine's error path, which
    /// stops the container and returns *before* the tree is collected — so the
    /// analysis sidecars a run writes as it goes (gg's capture journal first among
    /// them) are lost for exactly the surprising outcomes they were captured to
    /// explain. One narrow copy is enough to rescue them: the sidecars are small,
    /// self-contained, and already complete on disk when the run stops responding.
    ///
    /// **Best-effort by contract.** A missing file, a container already gone, or a
    /// collector that cannot reach into a dying container reports `Ok(false)`, not an
    /// error: this runs on a path that is *already* failing a run, and a salvage
    /// attempt must never be what turns a diagnosable timeout into an unexplained
    /// collection failure. `Err` is reserved for a host-side failure to write `dest`.
    ///
    /// The default implementation salvages nothing, which is the honest answer for a
    /// collector with no per-file channel into the container — every caller must
    /// already handle "not recovered", since a run may simply not have written the
    /// file.
    async fn collect_file(
        &self,
        _container: &ContainerHandle,
        _container_path: &str,
        _dest: &std::path::Path,
    ) -> Result<bool> {
        Ok(false)
    }
}
