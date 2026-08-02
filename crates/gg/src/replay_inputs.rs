//! The **shared replay index**: one agent-keyed, ordered view of everything a
//! [replay record](GgReplayRecord) pinned, plus the ordering barrier a concurrent
//! reconstruction serves those inputs under.
//!
//! A record is a flat, globally-ordered log of the inputs a run consumed
//! ([`entries`](GgReplayRecord::entries), each stamped with the agent that consumed it and a
//! [globally monotonic `seq`](GgReplayEntry::seq)). Every consumer wants the transpose of that:
//! *"what does agent `x` read next from the model?"*, *"…from tool dispatch?"*, *"…from the
//! clock?"*. This module computes the transpose once, resolves each entry's pooled payloads back
//! into the gg types the loop actually takes, and hands out per-agent, per-category cursors.
//!
//! # Why it is shared rather than per-consumer
//!
//! There are two consumers and they must not disagree. The [passive driver](crate::replay_driver)
//! reconstructs a record by walking it; a **driving playback** re-runs the real turn loop with the
//! model and the shell answered from the record. If each built its own view, a subtle difference in
//! how a pooled tool outcome is rehydrated — a dangling text index tolerated on one side and not the
//! other, say — would make the driver report a record as complete that the playback could not run,
//! which is precisely the class of confusion replay exists to remove. One index, one rehydration,
//! one vocabulary of failure.
//!
//! # The ordering barrier, and why the wait yields
//!
//! [`seq`](GgReplayEntry::seq) is a **completion** order: it is minted when an input is *recorded*,
//! not when it was issued. A gg run holds run-global mutable state — the
//! [board](https://docs.testcabinet.ai/gg/project-management/), inter-agent messages, collected
//! subagent results — that is rendered into every agent's pinned prompt each turn, so the recorded
//! interleaving is itself an input: an agent whose eleven-minute install finishes instantly under a
//! reconstruction would otherwise change what a *different* agent's next turn saw. The barrier
//! ([`await_turn`](ReplayInputs::await_turn)) restores it by serving a recorded input only once
//! every recorded input below it has been served.
//!
//! The wait is `async` and yielding, and that is not a style preference. gg runs **every agent on
//! one `current_thread` runtime** (see [`crate::run_from_args`]), so a blocking spin on the gate
//! does not stall one agent — it wedges the process, including the very agent the waiter is waiting
//! for. Every wait here parks on a [`Notify`] and every serve wakes the parked waiters.
//!
//! # It cannot deadlock silently, and it says so when it stalls
//!
//! A waiter only ever waits on strictly **lower** seqs, so the owner of the lowest unserved entry
//! never waits — the barrier cannot deadlock on itself. It can still fail to make progress two
//! ways, and both are reported rather than hung on:
//!
//! - **Provably**, when the agent that owes the lowest unserved input has
//!   [retired](ReplayInputs::retire): nobody will ever serve it, so every waiter behind it returns
//!   [`ReplayError::Deadlock`] naming the agent and the seq that stopped it.
//! - **By expiry**, when the owner is still live but simply never demands its recorded input (it
//!   took a branch this build no longer takes). That is a real divergence rather than a bug, so the
//!   wait is bounded: on expiry the **lowest** waiter is released, the inputs it stepped over are
//!   abandoned, and the whole thing is recorded as a [`ReplayStall`] on
//!   [`stalls`](ReplayInputs::stalls).
//!
//! # What is *not* served through a cursor
//!
//! [`PromptFrame`](GgReplayEntryKind::PromptFrame) entries are indexed
//! ([`prompt_frames`](ReplayInputs::prompt_frames)) but never consumed, and they do not gate the
//! barrier. A frame is gg's own record of the window it *built* for a turn — an observation to
//! compare a reconstruction against, not an input a reconstruction reads. Leaving it in the gate
//! would block every later waiter on an entry no consumer will ever ask for.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use test_cabinet_core::gg_replay::{
    GgReplayCommand, GgReplayEntry, GgReplayEntryKind, GgReplayModelError, GgReplayPromptItem,
    GgReplayRecord, GgReplayRequest, GgReplaySeed, GgReplayTextClip, GgReplayToolOutcome,
    GgShellCwd, GgShellOrigin,
};
use tokio::sync::Notify;
use tokio::time::{Instant, timeout_at};

use crate::model::{ImageContent, ModelResponse, ToolCall};
use crate::tools::{ToolData, ToolFailure, ToolOutcome};

/// How long a [barrier wait](ReplayInputs::await_turn) blocks before it is treated as a
/// [stall](ReplayStall) and the lowest waiter is released.
///
/// Generous, because the barrier's *normal* wait is bounded by another agent's next turn and a
/// reconstruction's turns cost no model latency at all — anything approaching this is a run that
/// stopped demanding its recorded inputs, not a run that is merely busy. It exists so a divergence
/// is reported in seconds instead of hanging a test suite forever.
pub const DEFAULT_STALL_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------
// Failure vocabulary
// ---------------------------------------------------------------------------

/// A divergence found while reading or reconstructing a run from its [replay record](GgReplayRecord)
/// — the gap replay exists to expose.
///
/// Every variant means the record is **not** a faithful, complete capture of the run: an input a
/// turn needed was not pinned, the pinned inputs do not line up with the turn structure, or the
/// pinned interleaving cannot be served. Rather than silently guess, the reader stops and reports
/// exactly which agent, turn, and tool it diverged at.
///
/// The variants split into two families. The first four are **index-level**: something the record
/// itself cannot answer. The rest are **walk-level**: raised by a
/// [reconstruction](crate::replay_driver) matching the record's turn shape against itself. They
/// share one enum because a consumer reports them in one place, and because a record that fails
/// either way has failed the same promise.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReplayError {
    /// An agent asked the index for a recorded input of a kind it has no more of — the capture is
    /// short, or this build of gg asks for something the recorded one did not.
    #[error(
        "replay gap: agent `{agent_id}` asked for the next recorded {kind} input and the record \
         has none left"
    )]
    Exhausted {
        /// The agent whose queue underflowed.
        agent_id: String,
        /// The category of input it asked for.
        kind: RecordedInputKind,
    },

    /// The [ordering barrier](ReplayInputs::await_turn) cannot advance: the agent that owes the
    /// lowest unserved input has retired, so it will never be served and every agent behind it
    /// would wait forever.
    #[error(
        "replay deadlock: agent `{agent_id}` is waiting to consume seq {seq}, but seq \
         {blocking_seq} belongs to `{blocking_agent}`, which has already finished — no agent can \
         advance"
    )]
    Deadlock {
        /// The waiting agent.
        agent_id: String,
        /// The seq it is waiting to consume.
        seq: u64,
        /// The agent that owes the entry blocking it.
        blocking_agent: String,
        /// The seq of that blocking entry.
        blocking_seq: u64,
    },

    /// A record entry references a pool slot the record does not carry. Assembly hard-errors on a
    /// dangling reference, so this is reachable only for a hand-built or hand-edited record — but
    /// substituting a default for a missing message body would reconstruct a session nobody ran.
    #[error(
        "replay: agent `{agent_id}` entry (seq {seq}) references {pool} {index}, which the \
         record's pool does not carry"
    )]
    DanglingPoolRef {
        /// The agent the entry is tagged with.
        agent_id: String,
        /// The `seq` of the entry holding the dangling reference.
        seq: u64,
        /// Which pool the reference points into.
        pool: ReplayPool,
        /// The index that is out of range.
        index: u32,
    },

    /// A record entry's payload did not deserialize into the gg type a replay feeds the loop.
    #[error("replay: agent `{agent_id}` entry (seq {seq}) is malformed: {detail}")]
    MalformedEntry {
        /// The agent the malformed entry is tagged with.
        agent_id: String,
        /// The `seq` of the malformed entry.
        seq: u64,
        /// What failed to parse.
        detail: String,
    },

    /// A turn's model response requested a tool call for which the record holds **no** outcome — the
    /// capture is incomplete (truncated mid-turn, or a tool result was never recorded).
    #[error(
        "replay gap: agent `{agent_id}` turn (seq {seq}) called `{tool}` (id `{call_id}`) but the \
         record has no recorded outcome for it — the capture is incomplete"
    )]
    MissingToolResult {
        /// The agent whose turn is missing an outcome.
        agent_id: String,
        /// The `seq` of that turn's model call.
        seq: u64,
        /// The name of the tool whose outcome is missing.
        tool: String,
        /// The id of the unanswered tool call.
        call_id: String,
    },

    /// A recorded tool result exists for an agent that has **no open model turn** — the record is
    /// missing the model call that would have requested it, or (in
    /// [code mode](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)) the turn whose program
    /// composed it.
    #[error(
        "replay divergence: agent `{agent_id}` (seq {seq}) has a recorded result for `{tool}` with \
         no open model turn — the record is missing the model call that requested it"
    )]
    ToolResultWithoutTurn {
        /// The agent the orphan result is tagged with.
        agent_id: String,
        /// The `seq` of the orphan tool-result entry.
        seq: u64,
        /// The tool the orphan result is for.
        tool: String,
    },

    /// An agent recorded **more** native tool results in a turn than its model response requested
    /// calls. (Program-composed results answer no requested call by construction and are attributed
    /// by their id prefix instead, so they can never raise this.)
    #[error(
        "replay divergence: agent `{agent_id}` (seq {seq}) recorded more tool results (`{tool}`) \
         than its turn requested calls"
    )]
    ExtraToolResult {
        /// The agent the surplus result is tagged with.
        agent_id: String,
        /// The `seq` of the surplus tool-result entry.
        seq: u64,
        /// The tool the surplus result is for.
        tool: String,
    },

    /// A recorded **native** tool result does not match the call the model made at that point in the
    /// turn — the record's tool results are misaligned with its model I/O.
    #[error(
        "replay divergence: agent `{agent_id}` (seq {seq}) recorded a result for `{recorded}` but \
         the model called `{expected}` at this point"
    )]
    ToolResultMismatch {
        /// The agent whose turn diverged.
        agent_id: String,
        /// The `seq` of the mismatched tool-result entry.
        seq: u64,
        /// The tool call the model actually made next.
        expected: String,
        /// The tool the recorded result claims to answer.
        recorded: String,
    },
}

/// Which category of pinned input a cursor serves — the vocabulary
/// [`Exhausted`](ReplayError::Exhausted) names, and the set of queues the index keeps per agent.
///
/// Deliberately **not** one variant per [entry kind](GgReplayEntryKind): a failed model call and a
/// successful one come off the same queue (a turn asks the model once and gets one or the other),
/// and a prompt frame is not consumable at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RecordedInputKind {
    /// A model call — [`ModelIo`](GgReplayEntryKind::ModelIo) or
    /// [`ModelError`](GgReplayEntryKind::ModelError).
    Model,
    /// A dispatched tool call's outcome.
    Tool,
    /// A `sh -c` command run on the agent's behalf.
    Shell,
    /// A `git` subprocess gg's own orchestration ran.
    Git,
    /// A read of the wall-clock deadline.
    Clock,
    /// A read of the cancel file.
    CancelProbe,
}

impl std::fmt::Display for RecordedInputKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Model => "model",
            Self::Tool => "tool",
            Self::Shell => "shell",
            Self::Git => "git",
            Self::Clock => "clock",
            Self::CancelProbe => "cancel-probe",
        })
    }
}

/// Which of a [record](GgReplayRecord)'s pools a [dangling
/// reference](ReplayError::DanglingPoolRef) points into.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayPool {
    /// [`messages`](GgReplayRecord::messages).
    Message,
    /// [`texts`](GgReplayRecord::texts).
    Text,
    /// [`blobs`](GgReplayRecord::blobs).
    Blob,
    /// [`toolsets`](GgReplayRecord::toolsets).
    Toolset,
}

impl std::fmt::Display for ReplayPool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Message => "message",
            Self::Text => "text",
            Self::Blob => "blob",
            Self::Toolset => "toolset",
        })
    }
}

// ---------------------------------------------------------------------------
// The rehydrated inputs
// ---------------------------------------------------------------------------

/// One recorded model call: the request that was sent, and what came back.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedModelCall {
    /// The global sequence it was recorded at.
    pub seq: u64,
    /// The pooled request — kept as references plus its
    /// [fingerprint](test_cabinet_core::gg_replay::GgTurnFingerprint) rather than resolved, because
    /// the fingerprint is what a playback compares its *live* request against and resolving it
    /// first would throw that away. Resolve it for display with
    /// [`request_view`](ReplayInputs::request_view).
    pub request: GgReplayRequest,
    /// What the call returned.
    pub outcome: RecordedModelOutcome,
    /// How long it took, when the capture was at
    /// [full fidelity](test_cabinet_core::gg_replay::GgReplayFidelity::Full). A standard capture
    /// records no latency clock, so this is `None` on most records.
    pub duration_ms: Option<u64>,
}

/// What a [recorded model call](RecordedModelCall) returned — the branch the live loop took.
#[derive(Debug, Clone, PartialEq)]
pub enum RecordedModelOutcome {
    /// The provider answered.
    Response(Box<ModelResponse>),
    /// The provider failed, and the loop branched on the failure — a vision refusal that strips
    /// images and retries, a retry exhaustion that counts against the run's error ceiling.
    Failed(GgReplayModelError),
}

/// One recorded tool call and the exact outcome its dispatch returned, rehydrated into the gg types
/// the loop feeds forward.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedToolCall {
    /// The global sequence it was recorded at.
    pub seq: u64,
    /// The call.
    pub call: ToolCall,
    /// Where the call ran, when the seam knew. Always `None` on a record captured before the tool
    /// context carried a shell.
    pub cwd: Option<GgShellCwd>,
    /// What the outcome's `output` is missing, when a
    /// [standard](test_cabinet_core::gg_replay::GgReplayFidelity::Standard) capture clipped it —
    /// and `None`, the overwhelming majority, when the recorded text is the whole payload.
    ///
    /// Carried because a consumer that cannot tell a clip from a payload cannot tell drift from
    /// incompleteness. A playback serving a clipped outcome back to the model hands it a *tail* of
    /// what the run handed it, so the turn's content address diverges — and without this the
    /// mismatch is indistinguishable from the model having answered differently, which is the one
    /// question the reconstruction exists to settle. The clip carries the whole payload's
    /// [content address](test_cabinet_core::gg_replay::GgReplayTextClip::original_id), so a
    /// consumer that re-executes the call can still check it exactly.
    pub output_clip: Option<GgReplayTextClip>,
    /// The outcome, with its pooled payloads resolved.
    pub outcome: ToolOutcome,
}

/// One recorded subprocess — a `sh -c` command or a `git` invocation — with its pooled streams
/// resolved.
///
/// Named for the *thing that ran* rather than for either call path, because both paths produce
/// exactly this and a reconstruction compares them the same way: position is the key, the command
/// text and the directory are the check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedSubprocess {
    /// The global sequence it was recorded at.
    pub seq: u64,
    /// Which command path issued it — `None` for a `git` invocation, which is gg's own
    /// orchestration rather than one of the three shell paths.
    pub origin: Option<GgShellOrigin>,
    /// The command line.
    pub command: String,
    /// Where it ran, relative to the workspace where possible.
    pub cwd: GgShellCwd,
    /// The status it exited with.
    pub exit_code: i32,
    /// What it printed on stdout. [Clipped](test_cabinet_core::gg_replay::GgReplayTextClip) on a
    /// standard capture when it was longer than the ceiling — see [`stdout_clip`](Self::stdout_clip),
    /// which is the only way to tell a stream that ended there from one that was cut.
    pub stdout: String,
    /// What [`stdout`](Self::stdout) is missing, when it was clipped; `None` when it is whole.
    pub stdout_clip: Option<GgReplayTextClip>,
    /// What it printed on stderr, under the same clipping rule.
    pub stderr: String,
    /// What [`stderr`](Self::stderr) is missing, when it was clipped; `None` when it is whole.
    pub stderr_clip: Option<GgReplayTextClip>,
}

/// One recorded read of the wall-clock deadline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordedClock {
    /// The global sequence it was recorded at.
    pub seq: u64,
    /// Milliseconds elapsed since the session began, as the run observed them.
    pub elapsed_ms: u64,
    /// Milliseconds left before the run's ceiling, when one was configured.
    pub remaining_ms: Option<u64>,
}

/// One recorded read of the cancel file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordedProbe {
    /// The global sequence it was recorded at.
    pub seq: u64,
    /// Whether the probe found the session canceled.
    pub canceled: bool,
}

/// One recorded prompt frame: an agent's context window as it stood for the turn just sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedPromptFrame {
    /// The global sequence it was recorded at — always just above the model call it describes.
    pub seq: u64,
    /// The window's items, in the order they were rendered to the client.
    pub items: Vec<GgReplayPromptItem>,
}

/// Where one rehydrated input sat in the record's global order.
///
/// A trait rather than six copies of the same line so that [serving](ReplayInputs::serve) an input —
/// popping it *and* taking its seq out of the barrier's set — is written once. A category whose
/// serve forgot the second half would leave a seq nobody owes blocking every agent behind it.
trait RecordedInput {
    /// The global sequence this input was recorded at.
    fn seq(&self) -> u64;
}

macro_rules! recorded_input {
    ($($type:ty),+ $(,)?) => {
        $(impl RecordedInput for $type {
            fn seq(&self) -> u64 {
                self.seq
            }
        })+
    };
}

recorded_input!(
    RecordedModelCall,
    RecordedToolCall,
    RecordedSubprocess,
    RecordedClock,
    RecordedProbe,
);

/// Where a [recorded command lookup](ReplayInputs::take_shell) found its answer — the rungs of the
/// ladder, in the order they are tried.
///
/// The variants are distinct rather than one `Option` because *where* the answer was found is the
/// finding: a head match is a reconstruction running exactly as recorded, an out-of-order match is
/// gg's own machinery having stopped issuing a command, and a cross-agent match is the
/// [binding table](crate::playback::binding) being wrong in a way that the safety net caught. A
/// lookup that collapsed the three would answer the command correctly and say nothing about any of
/// that.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellLookup {
    /// The head of the agent's own queue was the command. The overwhelmingly common case, and under
    /// the [barrier](ReplayInputs::await_turn) essentially the only one.
    Head(RecordedSubprocess),
    /// The command occurs later in the agent's own queue. Everything before it was consumed, and
    /// comes back so the report can name what gg stopped running.
    OutOfOrder {
        /// The recorded command that answered.
        found: RecordedSubprocess,
        /// What was stepped over to reach it, in recorded order.
        skipped: Vec<RecordedSubprocess>,
    },
    /// The command was found in **another** agent's remaining commands.
    CrossAgent {
        /// The recorded command that answered.
        found: RecordedSubprocess,
        /// The recorded agent whose queue it came off.
        agent_id: String,
    },
    /// No recorded command matches, anywhere.
    Miss {
        /// What the agent's own queue would have answered next, when it has anything left — the
        /// most useful thing to tell somebody whose command was not recorded.
        head: Option<RecordedSubprocess>,
    },
}

/// A [barrier](ReplayInputs::await_turn) wait that expired: the lowest waiter was released, and the
/// recorded inputs it stepped over were abandoned.
///
/// A stall is a **finding**, not an error. It means the record pinned an input this reconstruction
/// never demanded, which is exactly what a developer comparing a record against a changed build
/// wants to be told.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayStall {
    /// The agent that was released.
    pub agent_id: String,
    /// The seq it was waiting to consume.
    pub seq: u64,
    /// The seqs below it that were given up on, ascending.
    pub abandoned: Vec<u64>,
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/// The per-agent queues one agent reads its recorded inputs from.
///
/// One queue per [category](RecordedInputKind) rather than one interleaved queue, because the
/// consumers are different code paths reached at different moments — the model client, tool
/// dispatch, the git wrapper, the turn-boundary probes — and a single queue would make each of them
/// responsible for skipping the others' entries. The global order they were recorded in is not lost:
/// it is re-imposed by the [barrier](ReplayInputs::await_turn), which is the one place it belongs.
#[derive(Debug, Default)]
struct AgentQueues {
    model: VecDeque<RecordedModelCall>,
    tool: VecDeque<RecordedToolCall>,
    shell: VecDeque<RecordedSubprocess>,
    git: VecDeque<RecordedSubprocess>,
    clock: VecDeque<RecordedClock>,
    probe: VecDeque<RecordedProbe>,
}

impl AgentQueues {
    /// The seq of the next input this agent will consume, whichever category it comes from — the
    /// value the barrier gates on. `None` once every queue is drained.
    fn next_seq(&self) -> Option<u64> {
        [
            self.model.front().map(|call| call.seq),
            self.tool.front().map(|call| call.seq),
            self.shell.front().map(|run| run.seq),
            self.git.front().map(|run| run.seq),
            self.clock.front().map(|clock| clock.seq),
            self.probe.front().map(|probe| probe.seq),
        ]
        .into_iter()
        .flatten()
        .min()
    }
}

/// The index's mutable half: what has been consumed, who is waiting, and who has finished.
#[derive(Debug)]
struct InputState {
    /// Every agent's remaining inputs. A [`BTreeMap`] so a sweep over agents is in a stable order
    /// rather than in whatever order the hasher chose — under a reconstruction, iteration order is
    /// an input.
    queues: BTreeMap<String, AgentQueues>,
    /// The seqs of every consumable entry not yet served, ascending.
    unserved: BTreeSet<u64>,
    /// Agents currently parked in [`await_turn`](ReplayInputs::await_turn), keyed by the seq each is
    /// waiting to consume. Keys are unique because a seq belongs to exactly one entry, and an agent
    /// waits for its own next one.
    waiting: BTreeMap<u64, String>,
    /// Agents that have finished and will therefore never serve another input.
    retired: BTreeSet<String>,
    /// Barrier waits that expired.
    stalls: Vec<ReplayStall>,
}

/// One agent-keyed, ordered view of a [replay record](GgReplayRecord)'s pinned inputs.
///
/// Cheap to share: every method takes `&self`, so the whole thing lives behind one `Arc` handed to
/// every agent. See the [module docs](self) for what it is for and how the barrier behaves.
#[derive(Debug)]
pub struct ReplayInputs {
    /// The record itself, kept so pooled payloads can be resolved on demand — the message pool is
    /// the bulk of a record's bytes and a reconstruction resolves only the frames it renders.
    record: Arc<GgReplayRecord>,
    /// Every agent the record mentions, in creation order.
    ///
    /// Read from the [provenance table](GgReplayRecord::agents) first — it is the only source that
    /// covers an agent which was created and pinned nothing — and extended from the entries, which
    /// is what a record captured before the table (or one whose capture stopped before a spawn)
    /// still has.
    agent_ids: Vec<String>,
    /// Each agent's prompt frames, in seq order. Never consumed.
    frames: BTreeMap<String, Vec<RecordedPromptFrame>>,
    /// Which agent owes each consumable seq — how a blocked waiter names what is blocking it.
    owners: BTreeMap<u64, String>,
    /// The seqs an agent can still owe **after its own turn loop has ended** — every `git`
    /// invocation, and nothing else.
    ///
    /// gg's own bookkeeping outlives the loop it belongs to, and by a long way: an issue is
    /// dispatched, worked, committed and *merged* under the root's name, and every one of those
    /// `git` invocations is recorded after the root's own `finish`. So
    /// [`retire`](Self::retire) — which exists to turn a wait behind a finished agent into a
    /// provable [deadlock](ReplayError::Deadlock) — must not claim one behind a merge that has not
    /// run yet. Those waits fall back to the [stall](ReplayStall) ceiling, which is the right
    /// answer for a wait that *might* still be satisfied.
    after_loop: BTreeSet<u64>,
    /// The consumed/waiting/retired state.
    state: Mutex<InputState>,
    /// Woken on every serve and every retirement, so a barrier wait parks instead of spinning.
    wake: Notify,
    /// How long a barrier wait blocks before it is reported as a [stall](ReplayStall).
    stall_timeout: Duration,
    /// Whether [`await_turn`](Self::await_turn) enforces the recorded order at all.
    ///
    /// On by default and off only when a consumer asks — see
    /// [`without_barrier`](Self::without_barrier). The default falls the safe way: a consumer that
    /// never heard of the barrier gets the recorded interleaving rather than an arbitrary one.
    barrier: bool,
}

impl ReplayInputs {
    /// Build the index over `record`, resolving every entry's pooled payloads into the gg types a
    /// replay feeds the loop.
    ///
    /// All the parsing happens **here**, before anything is served, so a malformed or dangling
    /// entry is reported with its location rather than surfacing halfway through a reconstruction
    /// that has already emitted telemetry for a session it cannot finish.
    pub fn new(record: impl Into<Arc<GgReplayRecord>>) -> Result<Self, ReplayError> {
        let record: Arc<GgReplayRecord> = record.into();

        // In true recording order. Sorted defensively: assembly writes the journal's order, which
        // is seq order, but the whole index is built on that ordering being real.
        let mut order: Vec<&GgReplayEntry> = record.entries.iter().collect();
        order.sort_by_key(|entry| entry.seq);

        let mut agent_ids: Vec<String> = Vec::new();
        let mut queues: BTreeMap<String, AgentQueues> = BTreeMap::new();
        let mut frames: BTreeMap<String, Vec<RecordedPromptFrame>> = BTreeMap::new();
        let mut owners: BTreeMap<u64, String> = BTreeMap::new();
        let mut unserved: BTreeSet<u64> = BTreeSet::new();
        let mut after_loop: BTreeSet<u64> = BTreeSet::new();

        // The [provenance table](GgReplayRecord::agents) first, in the order the run created its
        // agents. It is the better source precisely where the entries are silent: an agent that was
        // spawned and pinned nothing — parked behind the parallelism cap when the run was killed,
        // or still waiting on its first model call — appears here and nowhere else, and a
        // reconstruction that never learned of it runs a smaller fleet than the run did.
        for agent in &record.agents {
            let agent_id = agent.agent_id.as_str();
            if !queues.contains_key(agent_id) {
                agent_ids.push(agent_id.to_string());
                queues.insert(agent_id.to_string(), AgentQueues::default());
                frames.insert(agent_id.to_string(), Vec::new());
            }
        }

        for entry in order {
            let agent_id = entry.agent_id.as_str();
            // An agent the table did not name — every agent of a record captured before the table
            // existed, and any the capture missed — still gets its queue from its own entries.
            if !queues.contains_key(agent_id) {
                agent_ids.push(agent_id.to_string());
                queues.insert(agent_id.to_string(), AgentQueues::default());
                frames.insert(agent_id.to_string(), Vec::new());
            }
            let queue = queues.get_mut(agent_id).expect("agent queue");
            let seq = entry.seq;

            // Every consumable entry joins the barrier's set as it is indexed; a prompt frame does
            // not (see the module docs — nothing consumes one, so gating on it would block
            // everything behind it forever).
            let mut consumable = true;
            match &entry.kind {
                GgReplayEntryKind::ModelIo {
                    request,
                    response,
                    duration_ms,
                } => {
                    let response: ModelResponse = parse(entry, response, "model response")?;
                    queue.model.push_back(RecordedModelCall {
                        seq,
                        request: request.clone(),
                        outcome: RecordedModelOutcome::Response(Box::new(response)),
                        duration_ms: *duration_ms,
                    });
                }
                GgReplayEntryKind::ModelError {
                    request,
                    error,
                    duration_ms,
                } => queue.model.push_back(RecordedModelCall {
                    seq,
                    request: request.clone(),
                    outcome: RecordedModelOutcome::Failed(error.clone()),
                    duration_ms: *duration_ms,
                }),
                GgReplayEntryKind::ToolResult { call, outcome } => {
                    queue.tool.push_back(RecordedToolCall {
                        seq,
                        call: ToolCall {
                            id: call.id.clone(),
                            name: call.name.clone(),
                            arguments: call.arguments.clone(),
                        },
                        cwd: call.cwd.clone(),
                        output_clip: record.clip(outcome.output).cloned(),
                        outcome: ToolOutcome {
                            ok: outcome.ok,
                            output: text(&record, entry, outcome.output)?,
                            summary: outcome
                                .summary
                                .map(|index| text(&record, entry, index))
                                .transpose()?,
                            images: outcome
                                .images
                                .iter()
                                .map(|index| image(&record, entry, *index))
                                .collect::<Result<Vec<_>, _>>()?,
                            data: tool_data(&record, entry, outcome)?,
                            failure: outcome
                                .failure
                                .as_ref()
                                .map(|failure| parse::<ToolFailure>(entry, failure, "tool failure"))
                                .transpose()?,
                        },
                    });
                }
                GgReplayEntryKind::Shell { origin, command } => {
                    queue
                        .shell
                        .push_back(subprocess(&record, entry, Some(*origin), command)?)
                }
                GgReplayEntryKind::Git { command } => {
                    after_loop.insert(seq);
                    queue
                        .git
                        .push_back(subprocess(&record, entry, None, command)?)
                }
                GgReplayEntryKind::Clock {
                    elapsed_ms,
                    remaining_ms,
                } => queue.clock.push_back(RecordedClock {
                    seq,
                    elapsed_ms: *elapsed_ms,
                    remaining_ms: *remaining_ms,
                }),
                GgReplayEntryKind::CancelProbe { canceled } => {
                    queue.probe.push_back(RecordedProbe {
                        seq,
                        canceled: *canceled,
                    })
                }
                GgReplayEntryKind::PromptFrame { items } => {
                    consumable = false;
                    frames
                        .get_mut(agent_id)
                        .expect("agent frames")
                        .push(RecordedPromptFrame {
                            seq,
                            items: items.clone(),
                        });
                }
            }
            if consumable {
                owners.insert(seq, agent_id.to_string());
                unserved.insert(seq);
            }
        }

        Ok(Self {
            record,
            agent_ids,
            frames,
            owners,
            after_loop,
            state: Mutex::new(InputState {
                queues,
                unserved,
                waiting: BTreeMap::new(),
                retired: BTreeSet::new(),
                stalls: Vec::new(),
            }),
            wake: Notify::new(),
            stall_timeout: DEFAULT_STALL_TIMEOUT,
            barrier: true,
        })
    }

    /// The same index with a different [stall ceiling](DEFAULT_STALL_TIMEOUT) — for a test that
    /// wants a stall reported now rather than in half a minute.
    #[must_use]
    pub fn with_stall_timeout(mut self, timeout: Duration) -> Self {
        self.stall_timeout = timeout;
        self
    }

    /// The same index with the [ordering barrier](Self::await_turn) **off**: every
    /// [`await_turn`](Self::await_turn) returns immediately and recorded inputs are served in
    /// whatever order the reconstruction demands them.
    ///
    /// This is not a performance knob and it is not a convenience. It exists so the barrier's own
    /// value is measurable: run the same multi-agent record both ways, and the unordered
    /// reconstruction reports the [conversation](test_cabinet_core::gg_replay::GgFingerprintComponent::Conversation)
    /// drift that run-global prompt state — the board, inter-agent messages, collected subagent
    /// results — produces when an eleven-minute install finishes instantly. A claim about the
    /// barrier that could not be turned off would be an argument rather than a measurement.
    #[must_use]
    pub fn without_barrier(mut self) -> Self {
        self.barrier = false;
        self
    }

    /// The record this index was built over — the way to reach the pools, the
    /// [capability set](GgReplayRecord::capability_set), the
    /// [agents table](GgReplayRecord::agents) and any [truncation](GgReplayRecord::truncation).
    pub fn record(&self) -> &GgReplayRecord {
        &self.record
    }

    /// The run's [seed](GgReplaySeed): the invocation envelope a reconstruction starts from — the
    /// prompt, the resolved model windows and modalities, the provided files, the baseline commit.
    pub fn seed(&self) -> &GgReplaySeed {
        &self.record.seed
    }

    /// Every agent the record mentions, in creation order — the
    /// [provenance table](GgReplayRecord::agents), extended by any agent that appears only in the
    /// entries.
    pub fn agent_ids(&self) -> &[String] {
        &self.agent_ids
    }

    /// The pooled message body at `index`, with every blob reference inflated back into the image
    /// payload it stands for — the body exactly as the client sent it.
    pub fn message(&self, index: u32) -> Option<Value> {
        self.record.message_body(index)
    }

    /// One agent's recorded [prompt frames](RecordedPromptFrame), in seq order. Empty for an agent
    /// the record does not mention.
    pub fn prompt_frames(&self, agent_id: &str) -> &[RecordedPromptFrame] {
        self.frames
            .get(agent_id)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    /// A pooled request resolved into a readable JSON object: its role and shape, its conversation
    /// with every message body inflated, and the tool definitions it offered.
    ///
    /// For **display and debugging only**. A playback compares requests through the
    /// [fingerprint](test_cabinet_core::gg_replay::GgTurnFingerprint), never through this — the
    /// fingerprint is computed by one function on both sides, which is the whole basis of the
    /// staleness check.
    pub fn request_view(&self, request: &GgReplayRequest) -> Value {
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|index| self.message(*index).unwrap_or(Value::Null))
            .collect();
        let tools = request
            .toolset
            .and_then(|index| self.record.toolset(index))
            .map(|toolset| toolset.tools.clone());
        serde_json::json!({
            "role": request.role,
            "shape": request.shape,
            "messages": messages,
            "tools": tools,
            "fingerprint": request.fingerprint,
        })
    }

    /// The next model call recorded for `agent_id` — the answer that stands in for a live
    /// `complete`, whether the recorded call succeeded or failed.
    pub fn next_model(&self, agent_id: &str) -> Result<RecordedModelCall, ReplayError> {
        self.serve(agent_id, RecordedInputKind::Model, |queues| {
            queues.model.pop_front()
        })
    }

    /// The next tool outcome recorded for `agent_id` — what dispatch returned, in place of
    /// dispatching.
    pub fn next_tool(&self, agent_id: &str) -> Result<RecordedToolCall, ReplayError> {
        self.serve(agent_id, RecordedInputKind::Tool, |queues| {
            queues.tool.pop_front()
        })
    }

    /// The next `sh -c` command recorded for `agent_id`.
    ///
    /// This is the **head match** — the first and overwhelmingly common step of a recorded-command
    /// lookup, and under the [barrier](Self::await_turn) essentially the only one. The
    /// out-of-order, cross-agent and miss steps are [`take_shell`](Self::take_shell), which is this
    /// with the rest of the ladder around it.
    pub fn next_shell(&self, agent_id: &str) -> Result<RecordedSubprocess, ReplayError> {
        self.serve(agent_id, RecordedInputKind::Shell, |queues| {
            queues.shell.pop_front()
        })
    }

    /// Find the recorded answer for the command `command` run in `cwd` by `agent_id`, walking the
    /// [lookup ladder](ShellLookup) and consuming whatever it stepped over.
    ///
    /// **Position is the key; content is the check.** A run runs `npm run build` five times and gets
    /// five different answers, so the command text is not an identity — the order is. Hence the head
    /// of the agent's queue is tried first, and the pair (command, directory) is what decides
    /// whether it is the right answer. A directory mismatch on an otherwise-identical command falls
    /// through to a later rung and is reported, never silently accepted: the same command in a
    /// different tree is a different command.
    ///
    /// Each rung past the first consumes what it skipped, because a recorded command the
    /// reconstruction demonstrably did not ask for must not stay in the queue to answer a *later*
    /// command by accident — and because leaving it in would block the
    /// [barrier](Self::await_turn) behind an entry nobody will ever take.
    pub fn take_shell(&self, agent_id: &str, command: &str, cwd: &GgShellCwd) -> ShellLookup {
        let mut state = self.state.lock().expect("replay input state lock");
        let matches = |run: &RecordedSubprocess| run.command == command && &run.cwd == cwd;

        // Rung 1 and 2 — this agent's own queue, head first. One search covers both because the
        // head is simply position zero, and splitting them would let the two definitions of "is
        // this the same command?" drift apart.
        if let Some(queue) = state.queues.get_mut(agent_id)
            && let Some(position) = queue.shell.iter().position(matches)
        {
            let skipped: Vec<RecordedSubprocess> = queue.shell.drain(..position).collect();
            let found = queue.shell.pop_front().expect("the matched command");
            for run in &skipped {
                state.unserved.remove(&run.seq);
            }
            state.unserved.remove(&found.seq);
            drop(state);
            self.wake.notify_waiters();
            return match skipped.is_empty() {
                true => ShellLookup::Head(found),
                false => ShellLookup::OutOfOrder { found, skipped },
            };
        }

        // Rung 3 — another agent's remaining commands. The safety net for an imperfect
        // [binding](crate::playback::binding), and reporting it is what makes the binding auditable:
        // a reconstruction that quietly served agent A from agent B's queue would be exactly the
        // silent mis-attribution the whole per-agent keying exists to prevent.
        //
        // Nothing is consumed from *in front of* the hit here, unlike rung 2: the other agent has
        // not finished, and its earlier commands are still its own to ask for.
        let owner = state
            .queues
            .iter()
            .find(|(other, queue)| other.as_str() != agent_id && queue.shell.iter().any(matches))
            .map(|(other, _)| other.clone());
        if let Some(owner) = owner {
            let queue = state
                .queues
                .get_mut(&owner)
                .expect("the owning agent's queue");
            let position = queue.shell.iter().position(matches).expect("the match");
            let found = queue.shell.remove(position).expect("the matched command");
            state.unserved.remove(&found.seq);
            drop(state);
            self.wake.notify_waiters();
            return ShellLookup::CrossAgent {
                found,
                agent_id: owner,
            };
        }

        // Rung 4 — a miss. The head of the agent's own queue comes back with it, because the most
        // useful thing to tell somebody whose command was not recorded is what gg *did* run at this
        // point instead.
        let head = state
            .queues
            .get(agent_id)
            .and_then(|queue| queue.shell.front().cloned());
        ShellLookup::Miss { head }
    }

    /// Stop the [barrier](Self::await_turn) waiting on categories this consumer does not serve.
    ///
    /// A record pins six categories of input; a driving reconstruction serves only some of them.
    /// `git` invocations are re-run for real (they are gg's own bookkeeping, and the hardest paths
    /// to test any other way), and the [clock](RecordedInputKind::Clock) and the
    /// [cancel probe](RecordedInputKind::CancelProbe) are explicitly not reproduced — a playback
    /// takes seconds and gg has no clock seam. Their entries would otherwise sit in the barrier's
    /// set forever, and since a waiter blocks on **every** lower unserved seq, one un-consumed git
    /// invocation early in a run would stall every agent behind it for the whole reconstruction.
    ///
    /// So a consumer declares what it does not serve, once, before the first turn. The entries are
    /// dropped from the queues as well as from the barrier, which keeps
    /// [`unserved`](Self::unserved) an honest count of *pinned inputs this consumer could have
    /// demanded and did not* — the figure a reconstruction reports at the end.
    pub fn disregard(&self, kinds: &[RecordedInputKind]) {
        let mut state = self.state.lock().expect("replay input state lock");
        let mut dropped: Vec<u64> = Vec::new();
        for queue in state.queues.values_mut() {
            for kind in kinds {
                match kind {
                    RecordedInputKind::Model => {
                        dropped.extend(queue.model.drain(..).map(|call| call.seq))
                    }
                    RecordedInputKind::Tool => {
                        dropped.extend(queue.tool.drain(..).map(|call| call.seq))
                    }
                    RecordedInputKind::Shell => {
                        dropped.extend(queue.shell.drain(..).map(|run| run.seq))
                    }
                    RecordedInputKind::Git => {
                        dropped.extend(queue.git.drain(..).map(|run| run.seq))
                    }
                    RecordedInputKind::Clock => {
                        dropped.extend(queue.clock.drain(..).map(|clock| clock.seq))
                    }
                    RecordedInputKind::CancelProbe => {
                        dropped.extend(queue.probe.drain(..).map(|probe| probe.seq))
                    }
                }
            }
        }
        for seq in dropped {
            state.unserved.remove(&seq);
        }
        drop(state);
        // Whatever was blocked behind them can go now.
        self.wake.notify_waiters();
    }

    /// The next `git` invocation recorded for `agent_id` — what gg's own orchestration got back,
    /// which a playback compares its (real) invocation against.
    pub fn next_git(&self, agent_id: &str) -> Result<RecordedSubprocess, ReplayError> {
        self.serve(agent_id, RecordedInputKind::Git, |queues| {
            queues.git.pop_front()
        })
    }

    /// The next wall-clock reading recorded for `agent_id`.
    pub fn next_clock(&self, agent_id: &str) -> Result<RecordedClock, ReplayError> {
        self.serve(agent_id, RecordedInputKind::Clock, |queues| {
            queues.clock.pop_front()
        })
    }

    /// The next cancel-file reading recorded for `agent_id`.
    pub fn next_probe(&self, agent_id: &str) -> Result<RecordedProbe, ReplayError> {
        self.serve(agent_id, RecordedInputKind::CancelProbe, |queues| {
            queues.probe.pop_front()
        })
    }

    /// Wait until `agent_id`'s next recorded input is the globally next one — the
    /// [ordering barrier](self#the-ordering-barrier-and-why-the-wait-yields).
    ///
    /// Returns immediately when the agent has no recorded inputs left (it is doing work the record
    /// does not pin, and gating that would serialize a run for no reason) or when nothing below its
    /// next input is outstanding. Otherwise it **yields** until every lower input has been served.
    ///
    /// # Errors
    ///
    /// [`Deadlock`](ReplayError::Deadlock) when the agent that owes the blocking input has already
    /// [retired](Self::retire) — waiting longer cannot help, so the waiter is told what stopped it
    /// instead of hanging the process.
    pub async fn await_turn(&self, agent_id: &str) -> Result<(), ReplayError> {
        if !self.barrier {
            return Ok(());
        }
        let waiting_for = match self.gate(agent_id)? {
            Gate::Ready => return Ok(()),
            Gate::Blocked { seq } => seq,
        };
        let _waiter = self.register(agent_id, waiting_for);
        let mut deadline = Instant::now() + self.stall_timeout;
        loop {
            // Arm the wake **before** re-checking the gate: a serve that lands between the check
            // and the park would otherwise be missed, and the waiter would sleep until the stall
            // ceiling on an input that was already available.
            let wake = self.wake.notified();
            tokio::pin!(wake);
            wake.as_mut().enable();

            if let Gate::Ready = self.gate(agent_id)? {
                return Ok(());
            }
            if timeout_at(deadline, wake).await.is_err() {
                if self.release_stalled(agent_id, waiting_for) {
                    return Ok(());
                }
                // Not the lowest waiter: the one that *is* releases itself on its own expiry, so
                // re-arm and give that a chance to unblock this.
                deadline = Instant::now() + self.stall_timeout;
            }
        }
    }

    /// Mark `agent_id` finished: it will never consume another recorded input.
    ///
    /// This is what makes a [`Deadlock`](ReplayError::Deadlock) *provable* rather than a timeout —
    /// an agent blocked behind an entry a retired agent owes can be told so immediately. Idempotent.
    pub fn retire(&self, agent_id: &str) {
        {
            let mut state = self.state.lock().expect("replay input state lock");
            state.retired.insert(agent_id.to_string());
        }
        self.wake.notify_waiters();
    }

    /// The [stalls](ReplayStall) the barrier has released so far, in the order they happened.
    pub fn stalls(&self) -> Vec<ReplayStall> {
        self.state
            .lock()
            .expect("replay input state lock")
            .stalls
            .clone()
    }

    /// How many recorded inputs have not been served — the count a reconstruction reports when it
    /// stops short of the record it was reading.
    pub fn unserved(&self) -> usize {
        self.state
            .lock()
            .expect("replay input state lock")
            .unserved
            .len()
    }

    /// Pop one input off `agent_id`'s `kind` queue, take its seq out of the barrier's set, and wake
    /// whoever was waiting on it.
    ///
    /// The one place a serve happens, so the bookkeeping cannot drift between categories: every
    /// cursor is this function with a different `take`.
    fn serve<T: RecordedInput>(
        &self,
        agent_id: &str,
        kind: RecordedInputKind,
        take: impl FnOnce(&mut AgentQueues) -> Option<T>,
    ) -> Result<T, ReplayError> {
        let taken = {
            let mut state = self.state.lock().expect("replay input state lock");
            let Some(taken) = state.queues.get_mut(agent_id).and_then(take) else {
                return Err(ReplayError::Exhausted {
                    agent_id: agent_id.to_string(),
                    kind,
                });
            };
            state.unserved.remove(&taken.seq());
            taken
        };
        // Outside the lock: a woken waiter takes it immediately.
        self.wake.notify_waiters();
        Ok(taken)
    }

    /// Register `agent_id` as waiting on `seq`, unregistering it however the wait ends — including
    /// when the future is dropped, which would otherwise leave a phantom waiter that the stall
    /// release mistakes for the lowest one.
    fn register(&self, agent_id: &str, seq: u64) -> WaiterGuard<'_> {
        self.state
            .lock()
            .expect("replay input state lock")
            .waiting
            .insert(seq, agent_id.to_string());
        WaiterGuard { inputs: self, seq }
    }

    /// Where `agent_id` stands at the barrier right now.
    fn gate(&self, agent_id: &str) -> Result<Gate, ReplayError> {
        let state = self.state.lock().expect("replay input state lock");
        let Some(mine) = state.queues.get(agent_id).and_then(AgentQueues::next_seq) else {
            // Nothing recorded left for this agent: it is doing work the record does not pin, and
            // has nothing to wait its turn for.
            return Ok(Gate::Ready);
        };
        let Some(&blocking) = state.unserved.range(..mine).next() else {
            return Ok(Gate::Ready);
        };
        let owner = self
            .owners
            .get(&blocking)
            .map(String::as_str)
            .unwrap_or_default();
        // A retired agent owes nothing further **from its loop** — but gg's own `git` outlives the
        // loop that dispatched it (an issue's commit and merge are recorded under the root, long
        // after the root's `finish`), so a wait behind one of those is not provably stuck and falls
        // through to the [stall](ReplayStall) ceiling instead.
        //
        // `owner == agent_id` is unreachable by construction — a queue is consumed in order, so an
        // agent's own lower entry would *be* its next one — but it is reported rather than waited
        // on, because the alternative to reporting an impossible state is hanging in it.
        if (state.retired.contains(owner) && !self.after_loop.contains(&blocking))
            || owner == agent_id
        {
            return Err(ReplayError::Deadlock {
                agent_id: agent_id.to_string(),
                seq: mine,
                blocking_agent: owner.to_string(),
                blocking_seq: blocking,
            });
        }
        Ok(Gate::Blocked { seq: mine })
    }

    /// Handle a barrier wait that hit its ceiling: release `agent_id` if it is the **lowest**
    /// waiter, abandoning the inputs below it and recording the [stall](ReplayStall). Returns
    /// whether it was released.
    fn release_stalled(&self, agent_id: &str, waiting_for: u64) -> bool {
        let mut state = self.state.lock().expect("replay input state lock");
        if state.waiting.keys().next() != Some(&waiting_for) {
            return false;
        }
        let abandoned: Vec<u64> = state.unserved.range(..waiting_for).copied().collect();
        for seq in &abandoned {
            state.unserved.remove(seq);
        }
        state.stalls.push(ReplayStall {
            agent_id: agent_id.to_string(),
            seq: waiting_for,
            abandoned,
        });
        drop(state);
        // The abandoned entries were blocking everybody behind them too.
        self.wake.notify_waiters();
        true
    }
}

/// Where an agent stands at the [barrier](ReplayInputs::await_turn).
enum Gate {
    /// Its next recorded input is the globally next one (or it has none left).
    Ready,
    /// Something below `seq` is still outstanding.
    Blocked {
        /// The seq the agent is waiting to consume.
        seq: u64,
    },
}

/// Unregisters a [barrier](ReplayInputs::await_turn) waiter however its wait ends — normally, on an
/// error, or because the future was dropped.
struct WaiterGuard<'a> {
    inputs: &'a ReplayInputs,
    seq: u64,
}

impl Drop for WaiterGuard<'_> {
    fn drop(&mut self) {
        self.inputs
            .state
            .lock()
            .expect("replay input state lock")
            .waiting
            .remove(&self.seq);
    }
}

// ---------------------------------------------------------------------------
// Pool resolution
// ---------------------------------------------------------------------------

/// Resolve one pooled subprocess — the shape both the shell and the git seams record.
fn subprocess(
    record: &GgReplayRecord,
    entry: &GgReplayEntry,
    origin: Option<GgShellOrigin>,
    command: &GgReplayCommand,
) -> Result<RecordedSubprocess, ReplayError> {
    Ok(RecordedSubprocess {
        seq: entry.seq,
        origin,
        command: command.command.clone(),
        cwd: command.cwd.clone(),
        exit_code: command.exit_code,
        stdout: text(record, entry, command.stdout)?,
        stdout_clip: record.clip(command.stdout).cloned(),
        stderr: text(record, entry, command.stderr)?,
        stderr_clip: record.clip(command.stderr).cloned(),
    })
}

/// Rehydrate a recorded outcome's structured [`ToolData`], putting the
/// [lifted text](test_cabinet_core::gg_replay::GgReplayToolOutcome::data_text) back where the
/// recorder took it from.
///
/// The recorder pools a `read_file`'s `contents` and a `shell`'s `body` rather than inlining them
/// (they duplicate the outcome's `output` byte for byte), so the parsed value arrives with that one
/// field empty and this puts it back. A record written before the lift carries no index and its
/// `data` is already whole, which is why the restore is driven by the index's presence.
///
/// A lifted index against a variant that has no such field is a **hard error**, not a silent drop:
/// it means the record was written by a build that lifts a field this one does not know about, and
/// feeding the loop a payload with that field empty is exactly the quiet divergence a replay exists
/// to make loud.
fn tool_data(
    record: &GgReplayRecord,
    entry: &GgReplayEntry,
    outcome: &GgReplayToolOutcome,
) -> Result<Option<ToolData>, ReplayError> {
    let Some(value) = outcome.data.as_ref() else {
        return Ok(None);
    };
    let mut data = parse::<ToolData>(entry, value, "tool data")?;
    if let Some(index) = outcome.data_text {
        let lifted = text(record, entry, index)?;
        match &mut data {
            ToolData::FileText(file) => file.contents = lifted,
            ToolData::Shell(shell) => shell.body = lifted,
            other => {
                return Err(ReplayError::MalformedEntry {
                    agent_id: entry.agent_id.clone(),
                    seq: entry.seq,
                    detail: format!(
                        "tool data: text {index} was lifted out of a `{}` payload, which this \
                         build has no field to restore it into",
                        variant_name(other)
                    ),
                });
            }
        }
    }
    Ok(Some(data))
}

/// The serde tag of a [`ToolData`] variant, for a diagnostic that has to name the shape it could
/// not handle.
///
/// Read off the serialization rather than matched arm by arm, so it cannot fall out of step as
/// variants are added. [`ToolData`] is **adjacently tagged** — `{"kind": …, "data": …}` — so the
/// name is the `kind` field specifically; taking the first key instead would print `data` or
/// `kind` depending on how the map happened to order itself, which is a diagnostic that names the
/// envelope rather than the payload it failed on.
fn variant_name(data: &ToolData) -> String {
    serde_json::to_value(data)
        .ok()
        .and_then(|value| match value {
            Value::Object(map) => map.get("kind").and_then(Value::as_str).map(str::to_owned),
            // A unit variant serializes as the bare tag.
            Value::String(name) => Some(name),
            _ => None,
        })
        .unwrap_or_default()
}

/// The pooled text at `index`, or a located [`DanglingPoolRef`](ReplayError::DanglingPoolRef).
fn text(record: &GgReplayRecord, entry: &GgReplayEntry, index: u32) -> Result<String, ReplayError> {
    record
        .text(index)
        .map(str::to_string)
        .ok_or(ReplayError::DanglingPoolRef {
            agent_id: entry.agent_id.clone(),
            seq: entry.seq,
            pool: ReplayPool::Text,
            index,
        })
}

/// The pooled blob at `index` as the image a tool outcome carries.
fn image(
    record: &GgReplayRecord,
    entry: &GgReplayEntry,
    index: u32,
) -> Result<ImageContent, ReplayError> {
    record
        .blob(index)
        .map(|blob| ImageContent::new(&blob.media_type, &blob.data_base64, blob.bytes))
        .ok_or(ReplayError::DanglingPoolRef {
            agent_id: entry.agent_id.clone(),
            seq: entry.seq,
            pool: ReplayPool::Blob,
            index,
        })
}

/// Deserialize a record entry's JSON payload into the gg type `T` a replay feeds the loop, turning a
/// parse failure into a located [`MalformedEntry`](ReplayError::MalformedEntry).
fn parse<T: serde::de::DeserializeOwned>(
    entry: &GgReplayEntry,
    value: &Value,
    what: &str,
) -> Result<T, ReplayError> {
    serde_json::from_value(value.clone()).map_err(|err| ReplayError::MalformedEntry {
        agent_id: entry.agent_id.clone(),
        seq: entry.seq,
        detail: format!("{what}: {err}"),
    })
}

#[cfg(test)]
#[path = "replay_inputs.test.rs"]
mod tests;
