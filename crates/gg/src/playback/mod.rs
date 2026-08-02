//! **Playback**: re-running a recorded gg session through the *real* turn loop, with only the model
//! call and the shell answered from the [record](test_cabinet_core::gg_replay) and every other side
//! effect performed for real.
//!
//! A thirty-eight-minute session reconstructs in seconds, for free, emitting the full telemetry
//! stream **this build** of gg would emit — which is what makes it two things at once: a debugging
//! tool ("what did my prompt edit change?") and a regression signal gg has never had, in which a
//! committed real session asserts that this build still produces it.
//!
//! # Playback is not the [replay driver](crate::replay_driver)
//!
//! Keeping the two apart in code, docs and flags is deliberate — confusing them is how somebody ends
//! up believing a transcript viewer proved a regression.
//!
//! | | Passive replay | Playback (this module) |
//! | --- | --- | --- |
//! | Drives | its own walk of the record | the real turn loop |
//! | Side effects | none at all | everything except the model and `sh -c` |
//! | Produces | a step list for the console | a real telemetry stream, a real workspace, a session summary, a divergence report |
//! | Detects | gaps *within* a record | divergence between the record and **this build of gg** |
//!
//! # The two seams, and why they travel together
//!
//! A gg session has exactly two inputs that are not a function of its own state — the model call and
//! the shell — and between them they are ~all of a run's wall clock and ~all of its cost. A playback
//! substitutes **both**, in one parameter (gg's `SessionSeams`), and there is no way to assemble
//! half of it: a reconstruction that answered the model from a record while running the shell for
//! real would run real installs against a scratch tree while claiming to reconstruct a session.
//!
//! It is a **separate entrypoint**, not a capability and not an invocation field, because both of
//! those can be silently ignored by an older gg — and a request to answer from a record must never
//! degrade into real, paid API calls. To get a playback you have to call this function.
//!
//! # The workspace is empty, and that is a hard rule
//!
//! A playback builds in an **empty** directory and refuses any existing non-empty one. It is stated
//! as a strict rule rather than a marker heuristic on purpose: a collected run's produced tree lives
//! at a path carrying none of the obvious markers, so a marker check would have let a playback's
//! real `write_file` and real `git` mutate the produced tree in place.
//!
//! Say it plainly: **the recorded shell commands did not run**, so anything a command created —
//! `node_modules/`, `dist/`, a scaffolded project — is absent from a playback tree. Such a tree must
//! never be fed to produced-code analysis.
//!
//! The tree also picks up one thing the recorded run's did: its own
//! [capture journal](test_cabinet_core::gg_replay_journal::GG_REPLAY_JOURNAL_PATH). Capture is
//! always on and a reconstruction runs the real loop, so a playback records itself — which is
//! correct rather than incidental. The reconstruction's own inputs are as worth pinning as the
//! run's, and a record of a playback assembles and reconstructs exactly like any other.
//!
//! # Endings, and the clock
//!
//! A playback cannot reproduce a wall-clock ending: it takes seconds. Rather than fake a clock — gg
//! has no clock seam, and adding one would touch every timestamp in the crate — playback is honest
//! about it. The recorded ceiling is left exactly as configured (it cannot trip in seconds, so
//! rewriting the recorded capability set to "disable" it would change the thing being reconstructed
//! for no gain), each agent's recorded terminal status is compared against the reconstructed one,
//! and a difference is reported as [terminal drift](drift::DriftKind::TerminalStatus). A record whose
//! turns run out because the run ended on its deadline surfaces as a playback-specific model error
//! (`ModelError::Playback`), so the agent ends and the comparison reports
//! `max_runtime → model_error` rather than inventing an ending.
//!
//! Cost and turn ceilings are the opposite case and are honored **as recorded**: the recorded
//! responses carry their recorded usage, so a ceiling trips at the same turn. Reproducing a
//! limit-hit is a feature.
//!
//! # What this milestone covers
//!
//! Single-agent playback: the recorded [client factory](client::RecordedClientFactory), the
//! [drift matrix](drift), the workspace guard, and the report. The multi-agent milestone adds the
//! recorded shell's full lookup ladder with per-agent queues, tool re-execution *compared* against
//! the record, the binding table across all five creation paths, the `seq` ordering barrier, and the
//! `tcab gg-playback` front end. Where a seam here is narrower than the design, it says so at the
//! seam rather than here.

pub mod client;
pub mod drift;
pub mod projection;
pub mod shell;

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use test_cabinet_core::MODALITY_IMAGE;
use test_cabinet_core::gg::{
    GgAgentStatus, GgInvocation, GgSessionSummary, GgTelemetryEvent, GgTelemetryKind,
};
use test_cabinet_core::gg_replay::{GgReplayEntryKind, GgReplayRecord};

use crate::agent::{ROOT_AGENT_ID, SessionOutcome, SessionSeams, is_failure_status};
use crate::playback::client::RecordedClientFactory;
use crate::playback::drift::{Drift, DriftKind, DriftLedger, Strictness};
use crate::playback::projection::ContextProjection;
use crate::playback::shell::RecordedShellRunner;
use crate::replay_inputs::{ReplayError, ReplayInputs};
use crate::telemetry::{CapturingSink, Emitter, EventSink};

/// The modality token every model accepts, recorded alongside [`MODALITY_IMAGE`] so a
/// reconstruction's declared list is a list rather than a hole.
const MODALITY_TEXT: &str = "text";

/// A reason a playback could not **start** — as distinct from a
/// [divergence](drift::Drift), which is a thing it found once it had.
///
/// The split is the whole error design here: everything a reconstruction discovers about the record
/// or about this build goes in the report, because a report is what a developer came for. Only the
/// three conditions under which there is nothing to report at all are errors.
#[derive(Debug, thiserror::Error)]
pub enum PlaybackError {
    /// The record was captured before [format v2](test_cabinet_core::gg_replay), so its
    /// fingerprints were derived from its transcript rather than stamped by the recorder, and it
    /// carries no provenance table, no seed and no client role.
    ///
    /// A passive [walk](crate::replay_driver) of such a record is fine and still supported; a
    /// *driving* reconstruction of one would be guessing at every point the format has since made
    /// explicit. Fired on
    /// [`captured_before_v2`](GgReplayRecord::captured_before_v2) rather than on `formatVersion`,
    /// which reads `2` on an upgraded record by construction.
    #[error(
        "the replay record was captured by an older gg (format v{version}); a playback needs the \
         recorder-stamped fingerprints, agent table and seed that format v2 introduced. \
         `gg replay --record` still reconstructs it passively."
    )]
    Unversioned {
        /// The format the recorder actually wrote.
        version: u32,
    },

    /// The playback workspace exists and is not empty.
    #[error(
        "the playback workspace `{path}` is not empty (it holds {count} entry/entries, e.g. \
         {sample}). A playback builds in an empty directory and performs real file and git writes \
         in it, so it will not build in a directory that already holds anything — including a \
         collected run's produced tree."
    )]
    DirtyWorkspace {
        /// The directory that was refused.
        path: PathBuf,
        /// How many entries it holds.
        count: usize,
        /// A few of their names, so the refusal is actionable rather than merely correct.
        sample: String,
    },

    /// The record does not index: a malformed entry, or one referencing a pool slot the record does
    /// not carry. Raised before any telemetry is emitted, because a reconstruction that cannot
    /// finish must not first emit a stream that looks like one.
    #[error("the replay record cannot be indexed: {0}")]
    Index(#[from] ReplayError),

    /// The workspace could not be prepared, or a seeded file could not be written into it.
    #[error("preparing the playback workspace: {0}")]
    Io(String),
}

/// A playback, configured and not yet run.
///
/// A builder rather than a function with six parameters, because the two that matter — the record
/// and the workspace — are required and the rest have one right default each.
pub struct Playback {
    /// The record to reconstruct.
    record: Arc<GgReplayRecord>,
    /// The (empty) directory to build in.
    workspace: PathBuf,
    /// How much of a recorded request a live one must still match.
    strictness: Strictness,
    /// Where the reconstruction's telemetry goes in *addition* to the report's own capture — a
    /// CLI's stdout. `None` keeps the stream in the report alone.
    sink: Option<Box<dyn EventSink>>,
}

impl Playback {
    /// A playback of `record`, building in `workspace`, under
    /// [`Exact`](Strictness::Exact) strictness.
    pub fn new(record: impl Into<Arc<GgReplayRecord>>, workspace: impl Into<PathBuf>) -> Self {
        Self {
            record: record.into(),
            workspace: workspace.into(),
            strictness: Strictness::Exact,
            sink: None,
        }
    }

    /// Run under `strictness` instead of [`Exact`](Strictness::Exact).
    #[must_use]
    pub fn strictness(mut self, strictness: Strictness) -> Self {
        self.strictness = strictness;
        self
    }

    /// Also stream the reconstruction's telemetry to `sink` as it is emitted.
    ///
    /// The report carries every event regardless — the stream *is* the product of a playback — so
    /// this is for a front end that wants to watch it live rather than read it afterwards.
    #[must_use]
    pub fn sink(mut self, sink: Box<dyn EventSink>) -> Self {
        self.sink = Some(sink);
        self
    }

    /// Reconstruct the session, and report what happened.
    ///
    /// Returns `Err` only for the [three conditions](PlaybackError) under which there was nothing to
    /// reconstruct. Every divergence — including a fatal one that stopped the run — comes back in
    /// the [report](PlaybackReport), because the divergences found before the stop are exactly what
    /// the developer wanted.
    pub async fn run(self) -> Result<PlaybackReport, PlaybackError> {
        if self.record.captured_before_v2() {
            return Err(PlaybackError::Unversioned {
                version: self
                    .record
                    .upgraded_from
                    .unwrap_or(self.record.format_version),
            });
        }
        // The index parses every pinned entry up front, so a malformed or dangling record is
        // refused here rather than halfway through a reconstruction that has already emitted
        // telemetry for a session it cannot finish.
        let inputs = Arc::new(ReplayInputs::new(Arc::clone(&self.record))?);
        prepare_workspace(&self.workspace)?;

        let ledger = Arc::new(DriftLedger::new());
        let provided_files = seed_workspace(&self.record, &self.workspace, &ledger)?;
        let invocation = self.invocation(provided_files, &ledger);

        // The capture is the product; a caller-supplied sink is an additional live view of it.
        let capture = CapturingSink::new();
        let sink: Box<dyn EventSink> = match self.sink {
            Some(sink) => Box::new(TeeSink {
                capture: capture.clone(),
                also: sink,
            }),
            None => Box::new(capture.clone()),
        };
        let emitter = Emitter::with_sink(Some(invocation.session_id.clone()), sink);

        // Loud, before the first turn, on the root's stream: a relaxed reconstruction is a session
        // that did not happen, and the one thing that must never happen is somebody reaching for
        // `--strictness shape` to unblock a red build and then reading the result as a fact about
        // the run. It is said three more times — in the report's strictness, in `faithful: false`,
        // and in the exit code — but this is the one a person watching the stream sees first.
        if !self.strictness.can_be_faithful() {
            emitter.for_agent(ROOT_AGENT_ID, None).emit(GgTelemetryKind::Log {
                level: "warn".to_string(),
                message: format!(
                    "playback: reconstructing under `{}` strictness. Recorded responses are being \
                     fed to requests that no longer match them, so this reconstruction is NOT \
                     faithful — it is a session that did not happen, and nothing measured from it \
                     is a fact about the recorded run.",
                    self.strictness.label(),
                ),
            });
        }

        let outcome = crate::agent::run_with_seams(
            &invocation,
            &emitter,
            SessionSeams::substituted(
                Arc::new(RecordedClientFactory::new(
                    Arc::clone(&inputs),
                    Arc::clone(&ledger),
                    self.strictness,
                )),
                Arc::new(RecordedShellRunner::new(
                    Arc::clone(&inputs),
                    Arc::clone(&ledger),
                    self.workspace.clone(),
                )),
            ),
        )
        .await;

        let events = capture.events();
        let agents = compare_terminals(&self.record, &events, &ledger);
        report_undemanded(&self.record, &inputs, &ledger);

        Ok(PlaybackReport::new(
            self.record.session_id.clone(),
            self.strictness,
            self.workspace,
            outcome,
            events,
            agents,
            &ledger,
        ))
    }

    /// The invocation a reconstruction runs under: the recorded configuration verbatim, pointed at
    /// the playback's own workspace.
    ///
    /// Everything here comes from the record's [seed](test_cabinet_core::gg_replay::GgReplaySeed)
    /// except the two things that cannot: the workspace (a playback builds in an empty directory,
    /// which is the whole point) and the cancel file (the recorded path does not exist here, and a
    /// recorded cancellation surfaces instead as the record's turns running out).
    fn invocation(&self, provided_files: Vec<PathBuf>, ledger: &DriftLedger) -> GgInvocation {
        let seed = &self.record.seed;
        GgInvocation {
            session_id: self.record.session_id.clone(),
            workspace_dir: self.workspace.clone(),
            prompt: seed.prompt.clone(),
            capability_set: self.record.capability_set.clone(),
            model_windows: seed
                .model_windows
                .iter()
                .map(|(model_id, resolved)| {
                    (
                        model_id.clone(),
                        catalog_window(&self.record, *resolved, model_id, ledger),
                    )
                })
                .collect(),
            // The **resolved** modalities: a model a provider refused an image for mid-run is
            // declared text-only from the first turn, so the reconstruction never sends the image
            // the recorded run learned not to send. Starting from the un-denied state would drift on
            // every image turn for a reason that has nothing to do with any real change.
            model_modalities: seed
                .model_modalities
                .iter()
                .map(|(model_id, modalities)| {
                    let mut declared = vec![MODALITY_TEXT.to_string()];
                    if modalities.vision {
                        declared.push(MODALITY_IMAGE.to_string());
                    }
                    (model_id.clone(), declared)
                })
                .collect(),
            provided_files,
            cancel_file: None,
        }
    }
}

/// What one reconstruction found.
///
/// Written once, at the end of [`Playback::run`], and never mutated afterwards — in particular
/// [`faithful`](Self::faithful) is computed in one place from the ledger and the mode, so no call
/// site can assert fidelity it did not earn.
#[derive(Debug, Clone)]
pub struct PlaybackReport {
    /// The reconstructed session's id (the record's).
    pub session_id: String,
    /// The mode it ran under. Stamped here, in [`faithful`](Self::faithful), and in the
    /// [exit code](Self::exit_code), because a relaxed reconstruction that is mistaken for a clean
    /// one is the single most misleading thing this feature can produce.
    pub strictness: Strictness,
    /// The directory it built in — a real tree, minus everything the stubbed commands would have
    /// created. Never analysable as produced code.
    pub workspace: PathBuf,
    /// Whether the session launched at all, as the loop itself reports it.
    pub outcome: SessionOutcome,
    /// Every telemetry event the reconstruction emitted. The *product* of a playback: this is the
    /// stream this build of gg produces for the recorded session.
    pub events: Vec<GgTelemetryEvent>,
    /// The named [projection](ContextProjection) of that stream — what a faithful reconstruction
    /// must reproduce exactly, with wall clock excluded.
    pub context_projection: ContextProjection,
    /// Every divergence found, in detection order.
    pub divergences: Vec<Drift>,
    /// The first **fatal** divergence — what the reconstruction stopped on. `None` when nothing
    /// did.
    ///
    /// A fatal divergence returns a report *carrying* what stopped it rather than an error that
    /// throws the report away: the divergences found before that point are exactly what a developer
    /// wants.
    pub stopped_on: Option<Drift>,
    /// Each recorded agent's ending, beside the one the reconstruction reached.
    pub agents: Vec<AgentOutcome>,
    /// Whether this is a faithful reconstruction — see [the definition](Self::faithful).
    pub faithful: bool,
    /// The terminal session summary the reconstruction produced, when it reached one.
    pub summary: Option<GgSessionSummary>,
}

impl PlaybackReport {
    /// Assemble the report, computing [`faithful`](Self::faithful) — the **one** place it is
    /// computed.
    ///
    /// > A reconstruction is faithful **iff** it ran under [`Exact`](Strictness::Exact) strictness,
    /// > was not stopped early, and recorded **no** divergence of any kind.
    ///
    /// The definition in the design also names the ordering barrier and record-preferring tool
    /// comparison, which are the multi-agent milestone's and are not yet observations this build
    /// makes. They join the same ledger when they land, and this computation does not change: a
    /// `true` here means "no divergence *this build can observe*", which is why every seam that
    /// cannot yet observe something says so at the seam.
    #[allow(clippy::too_many_arguments)]
    fn new(
        session_id: String,
        strictness: Strictness,
        workspace: PathBuf,
        outcome: SessionOutcome,
        events: Vec<GgTelemetryEvent>,
        agents: Vec<AgentOutcome>,
        ledger: &DriftLedger,
    ) -> Self {
        let divergences = ledger.drifts();
        let stopped_on = ledger.stopped_on();
        let faithful =
            strictness.can_be_faithful() && stopped_on.is_none() && divergences.is_empty();
        let context_projection = ContextProjection::project(&events);
        let summary = context_projection.summary.clone();
        Self {
            session_id,
            strictness,
            workspace,
            outcome,
            events,
            context_projection,
            divergences,
            stopped_on,
            agents,
            faithful,
            summary,
        }
    }

    /// The process exit code a front end returns for this reconstruction — **with the mode stamped
    /// into it**.
    ///
    /// | Code | Meaning |
    /// | --- | --- |
    /// | 0 | faithful |
    /// | 1 | [`Exact`](Strictness::Exact), and it diverged |
    /// | 2 | reconstructed under [`Shape`](Strictness::Shape) |
    /// | 3 | reconstructed under [`None`](Strictness::None) |
    ///
    /// Distinguishing 2 and 3 from 1 is the point: a CI script that only checks `!= 0` behaves the
    /// same either way, and one that checks `== 0` cannot mistake a relaxed reconstruction for a
    /// clean one — which is precisely the mistake a mode reached for to unblock a red build invites.
    pub fn exit_code(&self) -> i32 {
        match self.strictness {
            _ if self.faithful => 0,
            Strictness::Exact => 1,
            Strictness::Shape => 2,
            Strictness::None => 3,
        }
    }
}

/// One agent's recorded ending beside its reconstructed one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentOutcome {
    /// The recorded agent's id.
    pub agent_id: String,
    /// The profile it ran under, from the record.
    pub profile: String,
    /// How it ended in the recorded run. `None` for an agent whose loop never ended — a predecessor
    /// that handed off, or an agent a killed run never reached the end of — which is not compared.
    pub recorded: Option<GgAgentStatus>,
    /// How it ended in the reconstruction. `None` when the reconstruction never produced this agent
    /// at all.
    pub reconstructed: Option<GgAgentStatus>,
}

/// A sink that writes to the report's capture **and** to a caller's live view.
struct TeeSink {
    /// The report's own capture.
    capture: CapturingSink,
    /// The caller's live view.
    also: Box<dyn EventSink>,
}

impl EventSink for TeeSink {
    fn write_line(&self, line: &str) {
        self.capture.write_line(line);
        self.also.write_line(line);
    }
}

/// Create the playback workspace, or refuse a non-empty one.
///
/// [Strict](self#the-workspace-is-empty-and-that-is-a-hard-rule) on purpose: this is the single
/// guardrail between a playback's real file and git writes and a collected run's produced tree, and
/// a heuristic that looked for markers would have let exactly that through.
fn prepare_workspace(path: &Path) -> Result<(), PlaybackError> {
    if !path.exists() {
        return std::fs::create_dir_all(path)
            .map_err(|err| PlaybackError::Io(format!("creating `{}`: {err}", path.display())));
    }
    let entries: Vec<String> = std::fs::read_dir(path)
        .map_err(|err| PlaybackError::Io(format!("reading `{}`: {err}", path.display())))?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    if entries.is_empty() {
        return Ok(());
    }
    let mut sample: Vec<String> = entries.iter().take(3).cloned().collect();
    sample.sort();
    Err(PlaybackError::DirtyWorkspace {
        path: path.to_path_buf(),
        count: entries.len(),
        sample: sample.join(", "),
    })
}

/// Write the record's [seeded files](test_cabinet_core::gg_replay::GgReplaySeed::provided_files)
/// into the playback workspace, and report the workspace-relative paths the invocation carries.
///
/// The seed references the blob pool rather than carrying a second copy of the bytes — an
/// autoloaded case's reference mockups were sent to the model and are already pooled — so this is
/// the point at which a record proves it is self-contained: an empty directory plus a record is a
/// runnable session.
///
/// A path that is absolute or climbs out of the workspace is **skipped and reported**, never
/// written. A record is gg's own artifact, but this is the one place a record's contents become
/// filesystem writes, and "our own artifact" is not a security boundary.
fn seed_workspace(
    record: &GgReplayRecord,
    workspace: &Path,
    ledger: &DriftLedger,
) -> Result<Vec<PathBuf>, PlaybackError> {
    let mut written = Vec::new();
    for file in &record.seed.provided_files {
        let relative = Path::new(&file.path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::RootDir))
        {
            ledger.record(Drift::reported(
                DriftKind::Seed,
                "",
                format!(
                    "the seed names a provided file at `{}`, which is not inside the workspace; it \
                     was not written",
                    file.path
                ),
            ));
            continue;
        }
        let Some(blob) = record.blob(file.blob) else {
            ledger.record(Drift::reported(
                DriftKind::Seed,
                "",
                format!(
                    "the seed's provided file `{}` references blob {}, which the record does not \
                     carry; it was not written",
                    file.path, file.blob,
                ),
            ));
            continue;
        };
        let bytes = BASE64.decode(&blob.data_base64).map_err(|err| {
            PlaybackError::Io(format!("decoding the seeded file `{}`: {err}", file.path))
        })?;
        let target = workspace.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                PlaybackError::Io(format!("creating `{}`: {err}", parent.display()))
            })?;
        }
        std::fs::write(&target, bytes)
            .map_err(|err| PlaybackError::Io(format!("writing `{}`: {err}", target.display())))?;
        written.push(relative.to_path_buf());
    }
    Ok(written)
}

/// The **catalog** window to push for a model whose recorded, *resolved* window was `resolved`.
///
/// The seed records the window the run actually measured itself against — the catalog figure
/// narrowed by a [context-window-override](test_cabinet_core::gg::CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
/// and reduced by compaction's summary headroom — while an invocation carries the *raw* catalog
/// figure that gg then resolves for itself. Pushing the resolved number back in as a raw one would
/// apply both narrowings a second time, and the reconstruction would compact several turns earlier
/// than the run did.
///
/// So the resolution is inverted by **search rather than by arithmetic**: it is treated as the
/// monotone black box it is, and the smallest raw window that this build resolves to `resolved` is
/// the one pushed. That keeps working when the resolution rule changes, which an arithmetic inverse
/// would not — it would keep computing an answer, silently the wrong one.
///
/// When no raw window resolves to the recorded figure (an override that clamps below it, a
/// resolution rule this build no longer has), the recorded figure is pushed unchanged and the gap is
/// reported: a window that is *close* is a far better reconstruction than one that is absent, and
/// the divergence says which it was.
fn catalog_window(
    record: &GgReplayRecord,
    resolved: u64,
    model_id: &str,
    ledger: &DriftLedger,
) -> u64 {
    let set = &record.capability_set;
    let resolve = |raw: u64| {
        let windows = BTreeMap::from([(model_id.to_string(), raw)]);
        crate::agent::resolve_window_limit(set, &windows, model_id)
    };
    // The common case by far: nothing narrows, so the raw figure *is* the resolved one.
    if resolve(resolved) == Some(resolved) {
        return resolved;
    }
    // Otherwise the smallest raw window that still resolves to it. The upper bound is generous —
    // a headroom of 15/16ths would be an absurd configuration — and a search that does not find it
    // costs six comparisons.
    let (mut low, mut high) = (resolved, resolved.saturating_mul(16).max(resolved + 16));
    while low < high {
        let mid = low + (high - low) / 2;
        match resolve(mid) {
            Some(window) if window >= resolved => high = mid,
            _ => low = mid + 1,
        }
    }
    if resolve(low) == Some(resolved) {
        return low;
    }
    ledger.record(Drift::reported(
        DriftKind::Seed,
        "",
        format!(
            "no context window pushed for `{model_id}` resolves to the {resolved} token(s) the \
             recorded run measured itself against, so the recorded figure was pushed unchanged — \
             this reconstruction's fullness and compaction trigger are scaled differently from the \
             run's"
        ),
    ));
    resolved
}

/// Compare every recorded agent's ending against the reconstruction's, reporting the differences.
///
/// The reconstructed ending comes from two places because gg reports it in two places: the
/// per-agent [`AgentStatus`](GgTelemetryKind::AgentStatus) transitions, which are emitted only for a
/// multi-agent run, and the session summary's terminal status, which is the root's and is emitted
/// always. Reading both is what makes this work for a lone root agent — whose record *does* carry a
/// terminal row, because the status a reconstruction is compared against is as meaningful for one
/// agent as for a fleet.
///
/// Agents are matched by **id**, which is exact for the root and for every agent whose id a
/// reconstruction reproduces. A subagent's id comes off a global counter, so a record whose
/// reconstruction assigns them differently reports its subagents as not reconstructed until the
/// multi-agent milestone's binding table maps live ids back to recorded ones.
fn compare_terminals(
    record: &GgReplayRecord,
    events: &[GgTelemetryEvent],
    ledger: &DriftLedger,
) -> Vec<AgentOutcome> {
    let mut reconstructed: BTreeMap<String, GgAgentStatus> = BTreeMap::new();
    for event in events {
        match &event.kind {
            GgTelemetryKind::AgentStatus { status, .. }
                if matches!(status, GgAgentStatus::Done | GgAgentStatus::Failed) =>
            {
                if let Some(agent_id) = &event.agent_id {
                    reconstructed.insert(agent_id.clone(), *status);
                }
            }
            GgTelemetryKind::SessionSummary { summary } => {
                reconstructed.insert(
                    ROOT_AGENT_ID.to_string(),
                    if is_failure_status(&summary.terminal_status) {
                        GgAgentStatus::Failed
                    } else {
                        GgAgentStatus::Done
                    },
                );
            }
            _ => {}
        }
    }

    let mut outcomes = Vec::new();
    for agent in &record.agents {
        let outcome = AgentOutcome {
            agent_id: agent.agent_id.clone(),
            profile: agent.profile.clone(),
            recorded: agent.terminal_status,
            reconstructed: reconstructed.get(&agent.agent_id).copied(),
        };
        match (outcome.recorded, outcome.reconstructed) {
            // An agent that never ended in the recorded run has nothing to be compared against: a
            // predecessor that handed off, or one a killed run stopped mid-loop.
            (None, _) => {}
            (Some(_), None) => ledger.record(Drift::reported(
                DriftKind::AgentNotReconstructed,
                &agent.agent_id,
                format!(
                    "the record has a row for an agent on profile `{}` that this reconstruction \
                     never produced",
                    agent.profile,
                ),
            )),
            (Some(recorded), Some(live)) if recorded != live => ledger.record(Drift::reported(
                DriftKind::TerminalStatus,
                &agent.agent_id,
                format!("the recorded run ended it {recorded:?}; this one ended it {live:?}"),
            )),
            (Some(_), Some(_)) => {}
        }
        outcomes.push(outcome);
    }
    outcomes
}

/// Report the recorded inputs **this playback's seams serve** that were never demanded.
///
/// Scoped to the model and shell categories deliberately, and the scope is the honest statement of
/// what this milestone reconstructs. The other four are not undemanded so much as unclaimed:
///
/// - **tool results** are re-executed for real here and only *compared* against the record by the
///   multi-agent milestone, which is the milestone whose seam consumes that queue;
/// - **git** invocations run for real, by design — they are gg's own bookkeeping and the hardest
///   paths to test any other way;
/// - **the clock and the cancel probe** are explicitly not reproduced: a playback takes seconds and
///   has no clock seam, which is why a recorded deadline surfaces as the turns running out instead.
///
/// Counting any of those would put a divergence on every reconstruction and make the finding
/// meaningless. They are reached by subtraction rather than by a per-category cursor because the
/// [shared index](ReplayInputs) counts unserved inputs once, for every consumer, and a second
/// counter that could disagree with it would be worse than arithmetic.
fn report_undemanded(record: &GgReplayRecord, inputs: &ReplayInputs, ledger: &DriftLedger) {
    let never_served = record
        .entries
        .iter()
        .filter(|entry| {
            matches!(
                entry.kind,
                GgReplayEntryKind::ToolResult { .. }
                    | GgReplayEntryKind::Git { .. }
                    | GgReplayEntryKind::Clock { .. }
                    | GgReplayEntryKind::CancelProbe { .. }
            )
        })
        .count();
    let undemanded = inputs.unserved().saturating_sub(never_served);
    if undemanded == 0 {
        return;
    }
    ledger.record(Drift::reported(
        DriftKind::UnservedInputs,
        "",
        format!(
            "{undemanded} recorded model/shell input(s) were never demanded — the record pinned \
             inputs this build's run did not ask for"
        ),
    ));
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
