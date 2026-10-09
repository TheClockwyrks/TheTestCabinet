//! Normalized harness events: the one event taxonomy every supported harness's raw
//! output is translated into, and that a run records and streams.
//!
//! See `docs/events.md`. These are the shapes; the [`HarnessEvent`] a run streams
//! is built by `test_cabinet_core::event`, which holds the per-harness parsers, the
//! sinks and the system-event constructor, and re-exports everything here.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::metrics::TokenCounts;

/// A single normalized event emitted while a harness runs.
///
/// The common fields (timestamp and optional session ID) are carried alongside
/// the type specific [`EventKind`], which is flattened into the serialized form
/// so the type discriminator and its fields sit inline rather than under a
/// nested payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct HarnessEvent {
    /// ISO 8601 time the event was observed by the testing harness.
    pub timestamp: String,
    /// The underlying harness's session identifier, when one is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub session_id: Option<String>,
    /// The type specific event data.
    #[serde(flatten)]
    pub kind: EventKind,
}

/// The normalized event types, discriminated by the `type` field.
///
/// Variant tags are the discriminator slugs defined in `docs/events.md`
/// (`agent`, `command`, and so on); type specific fields are camelCased.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
// Every `Option<T>` field below is `#[serde(skip_serializing_if)]`, so it is
// omitted from the wire when absent rather than serialized as `null`; render it
// as a TypeScript optional (`field?: T`) to match.
#[cfg_attr(feature = "contract", ts(optional_fields))]
pub enum EventKind {
    /// A plain natural language message emitted by the agent.
    Agent {
        /// The text the agent emitted.
        message: String,
    },
    /// The model's internal reasoning ("thinking") content, reported by harnesses
    /// that expose it as a distinct stream from the agent's visible output. It is
    /// kept separate from [`Agent`](EventKind::Agent) because reasoning is often
    /// long and is a different kind of activity; callers can present it apart from
    /// the visible message (the UI collapses it by default).
    Reasoning {
        /// The text of the model's reasoning.
        message: String,
    },
    /// A shell command the agent ran.
    Command {
        /// The shell command the agent attempted to run.
        command: String,
        /// The directory the command ran from, when reported.
        #[serde(skip_serializing_if = "Option::is_none")]
        working_directory: Option<String>,
        /// The process exit code, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        /// Whether the command succeeded, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A file read.
    Read {
        /// The file that was read.
        path: String,
        /// The inclusive start line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        /// The inclusive end line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
        /// Whether the read succeeded, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A file write.
    Write {
        /// The file that was written.
        path: String,
        /// The inclusive start line written, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        /// The inclusive end line written, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
        /// Whether the write succeeded, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A filesystem or in-file search.
    Search {
        /// The search pattern, glob, or file name searched for.
        query: String,
        /// The scope that was searched, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// Whether the search completed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A directory listing.
    List {
        /// The directory whose contents were listed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// Whether the listing completed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// Use of a skill, when the harness distinguishes it from a file read.
    Skill {
        /// The skill file that was read.
        path: String,
        /// The harness provided skill name, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        skill_name: Option<String>,
        /// The inclusive start line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        /// The inclusive end line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
        /// Whether the skill use completed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// Subagent orchestration activity.
    Orchestration {
        /// The orchestration state the harness reported.
        action: OrchestrationAction,
        /// The harness provided subagent identifier, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        subagent_id: Option<String>,
        /// The harness provided subagent name, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        subagent_name: Option<String>,
        /// Whether the action completed successfully, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// An error reported by the harness itself (not an agent caused error).
    Error {
        /// A human readable description of the error.
        message: String,
        /// A harness provided stable error code, when one exists.
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// A potential issue reported by the harness.
    Warning {
        /// A human readable description of the potential issue.
        message: String,
        /// A harness provided stable warning code, when one exists.
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// A run lifecycle stage reported by the orchestrator itself, rather than
    /// translated from harness output. These mark the setup and teardown steps
    /// that bracket a harness session — pulling the image, starting the
    /// container, installing the harness, preparing the test case, and tearing
    /// down — so a caller sees what is happening during steps that can take a
    /// while instead of a silent wait before the harness's first event.
    System {
        /// The setup or teardown stage this event reports on.
        stage: SystemStage,
        /// Whether the stage is beginning, finished, or failed.
        status: SystemStatus,
        /// A human readable description of the stage and its status.
        message: String,
    },
    /// Per-turn token usage a harness reports partway through a run.
    ///
    /// Harnesses that report usage incrementally — Pi on each `message_end`,
    /// Kilo/OpenCode on each `step_finish` — emit one of these per turn, carrying
    /// that turn's [token counts](crate::metrics::TokenCounts) mapped onto the four
    /// normalized classes the *same way* the run-level total is (the shared mapping
    /// lives in [`crate::harness_registry`], so per-turn and session totals never
    /// diverge). It is the non-gg analogue of gg's per-turn `Usage` telemetry: the
    /// run-level total in [metrics](crate::metrics) answers "how much", while these
    /// per-turn slices answer "on what", so a comparison can attribute spend across
    /// a run. Emitted only by harnesses that report per-turn *deltas*; a harness
    /// that reports only a cumulative running total emits none (a cumulative
    /// snapshot is not a per-turn figure).
    // The text is emitted into the contract; the link names core's item.
    #[allow(rustdoc::broken_intra_doc_links)]
    Usage {
        /// This turn's token counts, by normalized class.
        tokens: TokenCounts,
        /// The harness-reported cost (USD) for this turn, when it reports one per
        /// turn. Most harnesses report cost only as a session total (or not at
        /// all), so this is usually absent.
        #[serde(skip_serializing_if = "Option::is_none")]
        cost: Option<f64>,
    },
    /// A first-party **gg** telemetry event, carried through the normalized event
    /// stream verbatim.
    ///
    /// gg — The Test Cabinet's own harness — is invoked directly rather than
    /// translated from a third-party CLI's output, and it emits a far richer,
    /// purpose-built [`GgTelemetryEvent`](crate::gg::GgTelemetryEvent) stream (the
    /// agent tree, the issue board, context-window breakdowns) that the normalized
    /// taxonomy above deliberately does not model. Rather than flatten that stream
    /// and lose its structure, a gg run carries each telemetry event **natively** in
    /// this variant, so gg's own events flow unchanged through the same
    /// sink → relay → `/jobs/{id}/live` path and into the run record's event store,
    /// where a gg-aware console renders them richly.
    ///
    /// The gg executor **also** emits the mapped, human-facing variants above
    /// (an [`Agent`](EventKind::Agent) message for an assistant message, a
    /// [`Command`](EventKind::Command)/[`Write`](EventKind::Write) for a tool call,
    /// and so on) alongside these native events, so a console that does not yet
    /// understand gg's stream still shows live activity. See
    /// [`crate::gg_exec`] for the bridge.
    // The text is emitted into the contract; the link names core's item.
    #[allow(rustdoc::broken_intra_doc_links)]
    Gg {
        /// The gg telemetry event, verbatim.
        ///
        /// Boxed so this one variant does not dominate the size of every event in the
        /// process: it carries a whole foreign document (a capability set, an issue
        /// board, a session summary) into an enum whose other variants are a handful of
        /// small strings, and it grows again with every addition to gg's contract.
        /// `Box<T>` serializes and renders in the contract exactly as `T`, so the wire
        /// shape is unchanged — the same reasoning boxes the summary inside
        /// [`SessionSummary`](crate::gg::GgTelemetryKind::SessionSummary).
        event: Box<crate::gg::GgTelemetryEvent>,
    },
    /// Harness output that could not be classified as any other type.
    Unknown {
        /// The original, unclassified harness output.
        #[cfg_attr(feature = "contract", ts(type = "unknown"))]
        raw: Value,
    },
}

/// The subagent orchestration states a harness can report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum OrchestrationAction {
    /// A subagent began running.
    SubagentStarted,
    /// A subagent finished successfully.
    SubagentCompleted,
    /// A subagent failed.
    SubagentFailed,
}

/// The setup and teardown stages of a run that the orchestrator reports as
/// [`EventKind::System`] events, in the order they occur around a harness
/// session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SystemStage {
    /// Pulling the run-container image.
    PullImage,
    /// Starting the run container.
    StartContainer,
    /// Installing the harness's CLI into the running container.
    InstallHarness,
    /// Confirming the installed harness CLI is usable.
    ProbeHarness,
    /// Running the test case's init command to prepare the workspace.
    InitTestCase,
    /// Collecting artifacts and stopping the container after the session.
    Teardown,
}

/// The point a [`SystemStage`] has reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum SystemStatus {
    /// The stage has begun.
    Started,
    /// The stage finished successfully.
    Completed,
    /// The stage failed; the run will not proceed past it.
    Failed,
}

impl SystemStage {
    /// A human readable description of this stage at the given status, used as
    /// the default message for a system event (`test_cabinet_core::event::HarnessEventExt::system`).
    pub fn describe(self, status: SystemStatus) -> String {
        use SystemStage::*;
        use SystemStatus::*;
        let phrase = match (self, status) {
            (PullImage, Started) => "Pulling the run-container image",
            (PullImage, Completed) => "Run-container image ready",
            (PullImage, Failed) => "Failed to pull the run-container image",
            (StartContainer, Started) => "Starting the run container",
            (StartContainer, Completed) => "Run container started",
            (StartContainer, Failed) => "Failed to start the run container",
            (InstallHarness, Started) => "Installing the harness CLI",
            (InstallHarness, Completed) => "Harness CLI installed",
            (InstallHarness, Failed) => "Failed to install the harness CLI",
            (ProbeHarness, Started) => "Checking if the harness is ready",
            (ProbeHarness, Completed) => "Harness ready",
            (ProbeHarness, Failed) => "Harness is unavailable",
            (InitTestCase, Started) => "Preparing the test case workspace",
            (InitTestCase, Completed) => "Test case workspace ready",
            (InitTestCase, Failed) => "Failed to prepare the test case workspace",
            (Teardown, Started) => "Tearing down the run container",
            (Teardown, Completed) => "Run container torn down",
            (Teardown, Failed) => "Failed to tear down the run container",
        };
        phrase.to_string()
    }
}
