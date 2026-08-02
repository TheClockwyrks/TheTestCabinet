//! The **drift matrix**: what a reconstruction can find, and which findings are fatal under which
//! [strictness](Strictness).
//!
//! A playback exists to answer one question — *does this build of gg still produce the session the
//! record captured?* — so everything it notices is a **divergence** rather than an error, and
//! every divergence lands in one ledger with the same shape: what kind, whose, what happened, and
//! whether it stopped the reconstruction. One vocabulary, because a consumer (a CLI's exit code, a
//! test assertion, a report) reads them all in one place, and because the definition of
//! [faithful](super::PlaybackReport::faithful) is *"no divergence of any kind"* — which is a
//! sentence that only means something if there is exactly one place a divergence can be written
//! down.
//!
//! # The matrix
//!
//! A recorded model response is only a valid input while gg's prompt construction is unchanged, so
//! every turn's request is compared against the recorded one
//! [component by component](GgFingerprintComponent) — message count, system prompt, offered
//! toolset, conversation — in that order, because the first component that moves is the most
//! informative. What a moved component *costs* is the matrix:
//!
//! | Component | [`Exact`](Strictness::Exact) | [`Shape`](Strictness::Shape) | [`None`](Strictness::None) |
//! | --- | --- | --- | --- |
//! | `messages` | fatal | **fatal** | reported |
//! | `system` | fatal | reported | reported |
//! | `tools` | fatal | **fatal** | reported |
//! | `conversation` | fatal | reported | reported |
//!
//! `Shape`'s two fatal cells are the whole of its principle: the message count and the offered
//! toolset say *the loop asked the same number of questions with the same instruments*, which is
//! what keeps the recorded answers corresponding turn for turn. Everything else is wording. Note
//! that no cell is *ignored* — `None` still reports every difference it finds, because a mode for
//! triage that quietly discarded its findings would be a mode that reconstructs a fiction and says
//! nothing.
//!
//! Every other kind of divergence — an unbindable agent, a command the record has no answer for, a
//! terminal status that moved — is [reported](DriftVerdict::Reported) rather than fatal. They are
//! not staleness: they do not make the *next* recorded answer wrong, so stopping on them would
//! throw away the rest of a reconstruction that is still telling the truth.

use std::sync::Mutex;

use test_cabinet_core::gg_replay::GgFingerprintComponent;

/// How much of a recorded request a reconstruction's live request must still match.
///
/// The default is [`Exact`](Self::Exact), and it is the **only** setting under which a playback's
/// output is a faithful reconstruction: under either relaxation the loop is being fed answers to
/// questions it no longer asks, which is a session that did not happen.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Strictness {
    /// Every [component](GgFingerprintComponent) must match.
    #[default]
    Exact,
    /// The message count and the offered toolset must match; the system prompt and the transcript
    /// text may have moved. For extracting data from sessions recorded before a prompt edit.
    Shape,
    /// Nothing is required to match. Triage only — and the report says so, in its
    /// [strictness](super::PlaybackReport::strictness), in `faithful: false`, and in the
    /// [exit code](super::PlaybackReport::exit_code).
    None,
}

impl Strictness {
    /// The [matrix](self#the-matrix) cell for `component` under this strictness.
    pub fn verdict(self, component: GgFingerprintComponent) -> DriftVerdict {
        match (self, component) {
            (Self::Exact, _) => DriftVerdict::Fatal,
            (Self::Shape, GgFingerprintComponent::Messages | GgFingerprintComponent::Tools) => {
                DriftVerdict::Fatal
            }
            (Self::Shape, _) | (Self::None, _) => DriftVerdict::Reported,
        }
    }

    /// Whether a reconstruction run under this strictness can be [faithful](super::PlaybackReport::faithful)
    /// at all. Only [`Exact`](Self::Exact) can.
    pub fn can_be_faithful(self) -> bool {
        matches!(self, Self::Exact)
    }

    /// How this mode names itself in a report and in the warning a relaxed reconstruction opens
    /// with.
    pub fn label(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Shape => "shape",
            Self::None => "none",
        }
    }
}

/// What one divergence costs the reconstruction that found it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriftVerdict {
    /// The reconstruction cannot continue truthfully: the recorded answer is not an answer to the
    /// question the loop asked. The agent ends on a playback-specific model error,
    /// and the report carries the divergence as [`stopped_on`](super::PlaybackReport::stopped_on).
    Fatal,
    /// Recorded, and the reconstruction carries on. It is still not
    /// [faithful](super::PlaybackReport::faithful) — every divergence costs that — but the rest of
    /// the run is still worth reading.
    Reported,
}

/// What kind of divergence a reconstruction found.
///
/// Deliberately one flat enum rather than a hierarchy: a report lists them, a CLI counts them, and
/// a test asserts on them, and every one of those is easier when the vocabulary is closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriftKind {
    /// The live request is not the recorded question — the named
    /// [component](GgFingerprintComponent) moved.
    ///
    /// The archetype: somebody edited a prompt template, and every recorded response is now an
    /// answer to a question gg no longer asks.
    Fingerprint(GgFingerprintComponent),
    /// The recorded call served to an agent's own turn loop was issued by gg's *other* client (a
    /// handoff-compaction summarizer), or the reverse.
    ClientRole,
    /// The recorded call was made under the other call shape — the offered toolset was *required*
    /// in one and merely offered in the other.
    RequestShape,
    /// The agent asked for a turn the record does not have. The shape a recorded run that ended on
    /// its **wall-clock deadline** takes under a playback, which takes seconds and never reaches
    /// one.
    RecordExhausted,
    /// A live agent's [provenance](test_cabinet_core::gg_replay::GgReplayAgentOrigin) has no row in
    /// the record's agent table, so there is no recorded queue to answer it from.
    UnboundAgent,
    /// The record has a row for an agent the reconstruction never created.
    AgentNotReconstructed,
    /// An agent's recorded ending and its reconstructed one differ.
    TerminalStatus,
    /// A command line reached the shell seam and the record holds no answer for it.
    CommandNotRecorded,
    /// The command at the head of the agent's recorded queue is a *different* command, or the same
    /// command in a different directory — which is a different command.
    CommandMismatch,
    /// The record pinned inputs the reconstruction never demanded. Reported once, at the end, with
    /// the count.
    UnservedInputs,
    /// Part of the record's [seed](test_cabinet_core::gg_replay::GgReplaySeed) could not be applied
    /// to the reconstruction: a provided file that is not inside the workspace or whose blob is
    /// missing, or a context window no pushed figure resolves to.
    ///
    /// Reported rather than fatal, and rather than refused at startup, because a reconstruction
    /// missing one seeded file is still worth having — and the report is where a reader finds out
    /// that it was missing it.
    Seed,
}

impl DriftKind {
    /// The stable, machine-readable name a report and a CLI print.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Fingerprint(component) => match component {
                GgFingerprintComponent::Messages => "messages",
                GgFingerprintComponent::System => "system",
                GgFingerprintComponent::Tools => "tools",
                GgFingerprintComponent::Conversation => "conversation",
            },
            Self::ClientRole => "client-role",
            Self::RequestShape => "request-shape",
            Self::RecordExhausted => "record-exhausted",
            Self::UnboundAgent => "unbound-agent",
            Self::AgentNotReconstructed => "agent-not-reconstructed",
            Self::TerminalStatus => "terminal-status",
            Self::CommandNotRecorded => "command-not-recorded",
            Self::CommandMismatch => "command-mismatch",
            Self::UnservedInputs => "unserved-inputs",
            Self::Seed => "seed",
        }
    }
}

/// One divergence between the record and what this build of gg did with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Drift {
    /// What kind of divergence it is.
    pub kind: DriftKind,
    /// The **recorded** agent it is attributed to, or the live one when no binding was made.
    /// Empty for a session-level finding.
    pub agent_id: String,
    /// A self-contained sentence naming what diverged, with both sides of it where both are
    /// short enough to print. Written at the point of detection, because that is the only place
    /// that has both.
    pub detail: String,
    /// Whether this divergence stopped the reconstruction.
    pub fatal: bool,
    /// The first differing region of the two system prompts, with three lines of context each
    /// way — rendered only for a [`System`](GgFingerprintComponent::System) drift, where
    /// *"what did I break?"* has an answer that fits on a screen.
    ///
    /// Detection is not enough on its own: a report that says "the system prompt moved" and stops
    /// there hands the developer a diffing exercise, and the diff is the whole reason they ran the
    /// playback.
    pub diff: Option<String>,
}

impl Drift {
    /// A divergence of `kind`, attributed to `agent_id`, that did not stop the reconstruction.
    pub fn reported(
        kind: DriftKind,
        agent_id: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            agent_id: agent_id.into(),
            detail: detail.into(),
            fatal: false,
            diff: None,
        }
    }

    /// The same, marked as whatever the [matrix](Strictness::verdict) said.
    #[must_use]
    pub fn with_verdict(mut self, verdict: DriftVerdict) -> Self {
        self.fatal = matches!(verdict, DriftVerdict::Fatal);
        self
    }

    /// The same, carrying a rendered [prompt diff](Self::diff).
    #[must_use]
    pub fn with_diff(mut self, diff: Option<String>) -> Self {
        self.diff = diff;
        self
    }
}

impl std::fmt::Display for Drift {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}]", self.kind.label())?;
        if !self.agent_id.is_empty() {
            write!(f, " agent `{}`:", self.agent_id)?;
        }
        write!(f, " {}", self.detail)
    }
}

/// Where every divergence a reconstruction finds is written down.
///
/// Shared (`Arc`) across the recorded [client factory](super::client::RecordedClientFactory), the
/// recorded [shell](super::shell::RecordedShellRunner) and the playback's own end-of-run sweeps,
/// because gg runs every agent on one runtime and a per-seam ledger would have to be merged in an
/// order nobody defined. Order is **detection order**, which is the order a reader wants: the first
/// entry is the first thing that went wrong.
#[derive(Debug, Default)]
pub struct DriftLedger {
    drifts: Mutex<Vec<Drift>>,
}

impl DriftLedger {
    /// An empty ledger.
    pub fn new() -> Self {
        Self::default()
    }

    /// Write one divergence down.
    pub fn record(&self, drift: Drift) {
        self.drifts.lock().expect("drift ledger lock").push(drift);
    }

    /// Every divergence found so far, in detection order.
    pub fn drifts(&self) -> Vec<Drift> {
        self.drifts.lock().expect("drift ledger lock").clone()
    }

    /// The first **fatal** divergence — what a report attributes the stop to.
    pub fn stopped_on(&self) -> Option<Drift> {
        self.drifts
            .lock()
            .expect("drift ledger lock")
            .iter()
            .find(|drift| drift.fatal)
            .cloned()
    }
}

/// How many lines of context a rendered [prompt diff](Drift::diff) carries either side of the
/// first differing line. Three: enough to recognize the surrounding block, few enough that the
/// answer is still one glance.
pub const DIFF_CONTEXT_LINES: usize = 3;

/// Render the **first differing region** of two prompts, with [three lines](DIFF_CONTEXT_LINES) of
/// context each way.
///
/// Line-oriented and first-difference-only on purpose. A full diff of two multi-thousand-token
/// system prompts is a document; what a developer who has just edited a template needs is the one
/// place their edit landed, in enough surrounding text to recognize it. Later differences are
/// almost always consequences of the first.
///
/// `None` when the two are identical (nothing to render) or when neither side could be resolved.
pub fn prompt_diff_region(recorded: &str, live: &str) -> Option<String> {
    if recorded == live {
        return None;
    }
    let recorded_lines: Vec<&str> = recorded.lines().collect();
    let live_lines: Vec<&str> = live.lines().collect();
    let first = recorded_lines
        .iter()
        .zip(live_lines.iter())
        .position(|(a, b)| a != b)
        // Identical up to the length of the shorter one: the difference is the tail, so the region
        // starts where the shorter prompt ended.
        .unwrap_or_else(|| recorded_lines.len().min(live_lines.len()));
    let start = first.saturating_sub(DIFF_CONTEXT_LINES);
    let end = first + DIFF_CONTEXT_LINES + 1;

    let mut out = String::new();
    out.push_str(&format!(
        "--- recorded (line {}{})\n",
        start + 1,
        if recorded_lines.is_empty() {
            ", empty"
        } else {
            ""
        }
    ));
    for line in recorded_lines
        .get(start..end.min(recorded_lines.len()))
        .unwrap_or_default()
    {
        out.push_str(&format!("  {line}\n"));
    }
    out.push_str(&format!("+++ live (line {})\n", start + 1));
    for line in live_lines
        .get(start..end.min(live_lines.len()))
        .unwrap_or_default()
    {
        out.push_str(&format!("  {line}\n"));
    }
    Some(out)
}

#[cfg(test)]
#[path = "drift.test.rs"]
mod tests;
