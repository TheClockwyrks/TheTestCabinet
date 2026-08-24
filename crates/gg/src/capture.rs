//! gg **session capture**: streaming the non-deterministic inputs of a run into an on-disk
//! [journal](test_cabinet_core::gg_session_journal) so the session can be
//! [recorded](https://docs.testcabinet.ai/gg/session-record/) afterward.
//!
//! The [telemetry stream](crate::telemetry) is already most of the capture, but it carries
//! *summaries*: what a turn cost, not what it said. So gg additionally pins each agent's
//! **model I/O** and every **tool result** into a [`GgRecorder`], which appends them to
//! [`.gg/replay.ndjson`](test_cabinet_core::gg_session_journal::GG_SESSION_JOURNAL_PATH) as the run
//! proceeds. The host folds that journal into the served
//! [record](test_cabinet_core::gg_session_record::GgSessionRecord) after it collects the run tree — gg
//! assembles nothing.
//!
//! # Why a journal and a writer thread
//!
//! The predecessor held every entry as an owned JSON value in a mutex for the whole run and
//! serialized the lot in one shot at the end, which made a record's peak memory the record's whole
//! size — with full base64 image payloads re-serialized once per turn they survived. Streaming
//! removes that term outright: a body is written the first time it is seen and referenced by index
//! thereafter, and this process never holds one.
//!
//! The writing happens on a **dedicated OS thread** rather than inline, because gg runs every agent
//! on one `current_thread` runtime (`crate::lib`): a synchronous file write on that runtime stalls
//! every other agent and skews the very turn timings the run is measured on.
//!
//! # Capture stops atomically — it never drops a line
//!
//! A dropped pool line leaves a hole that positional assembly silently shifts, substituting the
//! wrong message body into a recorded prompt. So nothing is ever dropped individually:
//!
//! - minting a pool index and queueing its line happen under **one** critical section;
//! - a turn's newly interned bodies and the entry that references them are queued as **one
//!   indivisible batch**, so a batch either lands whole or not at all;
//! - and any failure — the byte ceiling, a queue the writer cannot keep up with, a dead writer —
//!   stops capture for the **whole run**, permanently.
//!
//! Together those make the written pools always a contiguous prefix, with no entry able to
//! reference a body that was never written. **Capture degrades; it never fails the run it
//! observes** — every stop is a recorded fact, and the run is untouched.
//!
//! # A record can never lie about being complete
//!
//! [`finish`](GgRecorder::finish) writes a mandatory [`End`](GgJournalLine::End) line. Its absence
//! is the only reliable signal that a session died mid-capture, because a killed gg cannot write a
//! self-reported truncation marker either — so assembly reads the *absence* rather than waiting for
//! a report.
//!
//! # The recording seams (decorators, not scattered calls)
//!
//! Capture is deliberately a **decorator around the existing choke points**, never a spray of
//! record calls through the [turn loop](crate::agent):
//!
//! - **Model I/O** is captured by wrapping the [`ModelClient`] in a [`RecordingClient`]: every
//!   `complete` a wrapped agent makes records its request (the conversation and the offered tool
//!   definitions, both pooled) and the response.
//! - **Tool results** are captured at the one point every dispatched call funnels through as its
//!   outcome is finalized (the loop's per-call completion, and the responses-as-code program's
//!   serviced-call completion), by calling [`GgRecorder::record_tool_result`] — so an intercepted
//!   delegation/review tool and a code-program-composed call are all captured alongside
//!   ordinary registry dispatch.
//! - **The prompt frame** is captured at the one place the loop holds the turn's
//!   [`PromptItem`] stream — the same call site that emits the telemetry
//!   [`Prompt`](test_cabinet_core::gg::GgTelemetryKind::Prompt) event — by calling
//!   [`GgRecorder::record_prompt_frame`]. The recorder deliberately does **not** thread through
//!   the [telemetry emitter](crate::telemetry) to get there: telemetry is a summary stream and
//!   stays unaware of capture.
//! - **Command lines** are captured by wrapping the [`ShellRunner`] in a
//!   [`RecordingShellRunner`]: all three paths that reach `sh -c` — the
//!   [`shell`](crate::tools::SHELL_TOOL) tool, a [responses-as-code](crate::sandbox) program's
//!   `system.shell(…)` and a [hook's](crate::hooks) commands — go
//!   through that one seam, and the [origin](ShellRequest::origin) the caller stamped says which.
//!   Only the third of them was captured before, so a record of a session that used the shell tool
//!   had no answer for a single one of its commands.
//! - **gg's own `git` subprocesses** are captured at their own choke point, every
//!   [`git`](crate::git) invocation at `git_output`, through a
//!   [`GitCapture`](crate::git::GitCapture).
//! - **The turn-boundary probes** — the cancel file and the wall-clock deadline — are recorded
//!   where the loop reads them, because both can end the session and neither is derivable from
//!   anything else the record holds.
//!
//! # What a capture keeps of a large payload
//!
//! Capture is always on and is not gated on any capability, so what it keeps has to be affordable
//! on every run. Two payload classes are therefore bounded: a text payload past
//! [its ceiling](test_cabinet_core::gg_session_record::GG_SESSION_STREAM_MAX_BYTES) is stored as
//! its kept tail with a [clip row](test_cabinet_core::gg_session_record::GgSessionTextClip) saying what was
//! dropped, and an image is stored as its
//! [descriptor](test_cabinet_core::gg_session_record::GgSessionImage) and never as its bytes. Everything
//! that changes control flow is recorded whole.
//!
//! Every entry is stamped with the recording agent's id and a **globally monotonic** sequence minted
//! across all agents from one counter, so ordering the entries by sequence recovers the true
//! interleaving of concurrently-running agents.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::sync::mpsc::{SyncSender, TrySendError, sync_channel};
use std::thread::JoinHandle;

use serde_json::Value;
use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::gg_session_journal::{GgJournalInterner, GgJournalLine};
use test_cabinet_core::gg_session_record::{
    GG_SESSION_FORMAT_VERSION, GG_SESSION_STREAM_MAX_BYTES, GG_SESSION_TOOL_MAX_BYTES,
    GgClientRole, GgSessionAgent, GgSessionCommand, GgSessionEntry, GgSessionEntryKind,
    GgSessionFileRegion, GgSessionImage, GgSessionInterner, GgSessionModalities,
    GgSessionModelError, GgSessionModelErrorKind, GgSessionPromptItem, GgSessionPromptSlot,
    GgSessionRecorder, GgSessionRequestShape, GgSessionRetention, GgSessionSeed, GgSessionToolCall,
    GgSessionToolOutcome, GgSessionTruncation, GgSessionTruncationReason, GgShellCwd,
    GgShellOrigin,
};

use crate::context::{PromptItem, PromptSlot, Retention};
use crate::fault::panic_message;
use crate::model::{Message, ModelClient, ModelError, ModelResponse, ToolCall, ToolDefinition};
use crate::tools::{
    ApiData, READ_FILE_CAP, ShellExecution, ShellRequest, ShellRunner, ShellStatus, ToolOutcome,
};

/// A standard capture must keep whole whatever the model was shown whole, and the largest such
/// payload gg produces is a whole-file `read_file`. So the record's tool ceiling has to cover the
/// tool layer's own cap — asserted here, at the one place both numbers are in scope, because the
/// failure it guards against is silent: a ceiling below the cap records a file the model read in
/// its entirety as a tail of itself, and a reader feeding that back would report the resulting
/// divergence as model drift rather than as a hole in the record.
///
/// A compile error, not a test, because either constant can be lowered by someone who has never
/// read the other and the relation between them is the whole invariant.
const _: () = assert!(GG_SESSION_TOOL_MAX_BYTES >= READ_FILE_CAP);

/// How many queued batches the writer thread may fall behind by before capture stops.
///
/// A bound rather than an unbounded queue because an unbounded one turns a stalled disk into
/// unbounded memory growth *inside the run container* — which would take the run down, and the one
/// rule capture obeys is that it never does that. Sized for the shape of the traffic rather than for
/// throughput: a batch is queued per model turn and per tool result, the writer's work per batch is
/// one `write_all`, and a writer that is 64 batches behind is not slow, it is stuck.
const JOURNAL_QUEUE_DEPTH: usize = 64;

/// How long [`finish`](GgRecorder::finish) will wait for room in a full queue to write the
/// terminating [`End`](GgJournalLine::End) line.
///
/// The `End` line is not one line among many: its absence is what makes assembly report the record
/// as [`SessionKilled`](GgSessionTruncationReason::SessionKilled), so dropping it on a momentarily
/// full queue would libel a session that ended cleanly as one that was killed — the single most
/// misleading thing this module could do. A writer merely *behind* by a burst of batches drains in
/// milliseconds, and this waits for that.
///
/// Bounded, and short, because the other failure is worse: an unbounded block would hand a stalled
/// disk the power to wedge the run's teardown, which is the very thing
/// [`JOURNAL_QUEUE_DEPTH`] exists to prevent. A queue still full after this is not behind, it is
/// stuck, and a record from a stuck writer is truncated no matter what this writes.
const END_LINE_QUEUE_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// How long each retry sleeps while waiting on a full queue. Small enough that the common case —
/// the writer being one `write_all` behind — costs a single tick.
const END_LINE_RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);

/// What a run's [capture](GgRecorder) achieved, reported once at
/// [`finish`](GgRecorder::finish) so the run's operator log can say so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GgCaptureReport {
    /// How many [entries](GgSessionEntry) reached the journal.
    pub entries: u64,
    /// How many bytes of pinned input reached the journal — what the
    /// [ceiling](test_cabinet_core::gg::GgRunLimits::replay_max_bytes) is measured against, so it
    /// excludes the terminating line, which is written whatever the ceiling says.
    pub bytes: u64,
    /// Why capture stopped short of the session, when it did.
    pub truncation: Option<GgSessionTruncation>,
    /// The writer thread's own I/O failure, when it had one. Distinct from
    /// [`truncation`](Self::truncation): a writer that died could not record why, so this is the
    /// only place the reason exists at all.
    pub write_error: Option<String>,
}

/// One model call, as the seam that made it hands it to the recorder — everything about the
/// *request* that is the same whether the call succeeded or failed.
///
/// Grouped rather than passed as six parameters because the success and failure seams take exactly
/// the same six, and a pair of long positional signatures is how the two come to disagree about
/// which client role or which call shape they are recording.
pub struct RecordedCall<'a> {
    /// The agent whose loop made the call.
    pub agent_id: &'a str,
    /// Which of gg's two model clients issued it.
    pub role: GgClientRole,
    /// Whether the offered tool was *required*.
    pub shape: GgSessionRequestShape,
    /// The conversation that was sent.
    pub messages: &'a [Message],
    /// The tool definitions that were offered. Empty records no toolset at all rather than an
    /// empty one: the contract distinguishes "offered nothing" from "offered an empty array".
    pub tools: &'a [ToolDefinition],
    /// The call's measured latency.
    pub duration_ms: Option<u64>,
}

/// The run's **invocation envelope**, as the launch hands it to the recorder — the fixed
/// identity the session started from.
pub struct RecordedSeed<'a> {
    /// The build prompt the root agent was invoked with.
    pub prompt: &'a str,
    /// The commit gg observed the seeded workspace at, when the run made one — the
    /// [baseline](crate::git::ensure_baseline). Absent for a run that never needed a repository.
    pub baseline_commit: Option<&'a str>,
    /// The **resolved** context window each bound model is measured against — the catalog's
    /// figure narrowed by any override and reduced by the compaction headroom, which is the
    /// number the fullness signal and the compaction trigger actually use.
    pub model_windows: BTreeMap<String, u64>,
    /// The modality state of each bound model **as it stands now**. Recorded again at the end of
    /// the run if it has moved, so the record carries the resolved state rather than the
    /// declared one.
    pub model_modalities: BTreeMap<String, GgSessionModalities>,
}

/// One subprocess gg ran, as the seam that ran it hands it to the recorder.
///
/// Borrowed rather than owned because both producers already hold the streams — a `git`
/// invocation's [`Output`](std::process::Output) and a validation command's captured pipes — and
/// a recorder that took them by value would copy megabytes on the way to clipping them.
pub struct RecordedCommand<'a> {
    /// The command line, as it would be read back.
    pub command: &'a str,
    /// Where it ran, relative to the agent's workspace wherever that is expressible.
    pub cwd: GgShellCwd,
    /// Its exit status. A process killed by a signal reports `-1`, which is what
    /// [`ExitStatus::code`](std::process::ExitStatus::code) has no value for; the record's field
    /// is a plain `i32` because every consumer of it branches on "zero or not".
    pub exit_code: i32,
    /// Everything it printed to standard output.
    pub stdout: &'a str,
    /// Everything it printed to standard error.
    pub stderr: &'a str,
}

/// Where `dir` is, relative to `workspace` — the portable form a recorded command's working
/// directory is stored in.
///
/// An absolute path says nothing a reader can use: the workspace root is an implementation detail
/// of the container the run happened in, so `/work/impl/web` and `/work` differ by the only part
/// worth recording. Storing the *relationship* is what makes the recorded directory comparable
/// across runs.
///
/// A path outside the workspace (a worktree gg created beside it, an absolute `cwd` a validation
/// command declared) is kept verbatim, because there is nothing to relativize it against.
pub fn shell_cwd(workspace: &Path, dir: &Path) -> GgShellCwd {
    match dir.strip_prefix(workspace) {
        Ok(relative) if relative.as_os_str().is_empty() => GgShellCwd::Workspace,
        Ok(relative) => GgShellCwd::Relative {
            // `/`-separated, matching the contract: gg runs on Linux, and a record read on any
            // other platform still has to compare against the path the run used.
            path: relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/"),
        },
        Err(_) => GgShellCwd::Absolute {
            path: dir.display().to_string(),
        },
    }
}

/// Translate a gg [`ModelError`] into the contract's [class-plus-detail](GgSessionModelError) form.
///
/// The *class* is what the turn loop branches on, which is why the contract carries an enum rather
/// than the error's rendered text: a reader has to know that a call failed for a reason
/// that strips images and retries, not merely that it failed.
fn session_model_error(error: &ModelError) -> GgSessionModelError {
    let message = error.to_string();
    match error {
        ModelError::MissingApiKey => GgSessionModelError {
            kind: GgSessionModelErrorKind::MissingApiKey,
            message,
            status: None,
            attempts: None,
            model_id: None,
        },
        ModelError::Fatal { status, .. } => GgSessionModelError {
            kind: GgSessionModelErrorKind::Fatal,
            message,
            status: Some(*status),
            attempts: None,
            model_id: None,
        },
        ModelError::RetryExhausted { attempts, .. } => GgSessionModelError {
            kind: GgSessionModelErrorKind::RetryExhausted,
            message,
            status: None,
            attempts: Some(*attempts),
            model_id: None,
        },
        ModelError::VisionUnsupported { model_id, .. } => GgSessionModelError {
            kind: GgSessionModelErrorKind::VisionUnsupported,
            message,
            status: None,
            attempts: None,
            model_id: Some(model_id.clone()),
        },
        ModelError::Parse(_) => GgSessionModelError {
            kind: GgSessionModelErrorKind::Parse,
            message,
            status: None,
            attempts: None,
            model_id: None,
        },
        // Every attempt was a [generation loop](crate::loopguard) and was thrown away. Its own
        // class rather than `RetryExhausted`'s, because a reader that folded the two
        // together would claim the provider refused a request it in fact answered — repeatedly.
        // `attempts` carries how many replies were discarded, which is the only place that number
        // survives *in the record*: the replies themselves never entered it (see
        // [`record_model_io`](CaptureHandle::record_model_io)). How much they generated is
        // published on the turn's own outcome event instead, where every other discarded reply's
        // size is published.
        ModelError::ResponseLoop { discarded, .. } => GgSessionModelError {
            kind: GgSessionModelErrorKind::ResponseLoop,
            message,
            status: None,
            attempts: Some(discarded.attempts),
            model_id: None,
        },
        // The call ran into the per-call ceiling — a stall, recorded because the loop retries the
        // turn on it, and a record without it would show two identical calls with no reason for
        // the second. The message already names the provider when the stream got far enough to
        // say who was serving it.
        ModelError::Timeout { .. } => GgSessionModelError {
            kind: GgSessionModelErrorKind::Timeout,
            message,
            status: None,
            attempts: None,
            model_id: None,
        },
    }
}

/// The mutable half of a capture, holding everything that must move together.
///
/// One mutex over the interner, the sequence counter and the queue is the whole of
/// [R12](https://docs.testcabinet.ai/gg/analysis/session-records/): an index minted without its line
/// queued, or a line queued out of index order, is a hole in a pool — and a hole is not a missing
/// entry, it is *every later entry referencing the wrong body*.
struct Capture {
    /// Pool ids and the lines each newly seen body produces. Holds no bodies.
    interner: GgJournalInterner,
    /// The queue to the writer thread. `None` once [`finish`](GgRecorder::finish) has closed it.
    queue: Option<SyncSender<String>>,
    /// The next globally monotonic [`seq`](GgSessionEntry::seq).
    next_seq: u64,
    /// How many entries have been queued.
    entries: u64,
    /// The `seq` of the last entry that made it into the journal.
    last_seq: Option<u64>,
    /// How many bytes have been queued, which is what the ceiling is measured against.
    bytes: u64,
    /// The per-run byte ceiling, or `None` for unbounded capture.
    max_bytes: Option<u64>,
    /// The [envelope](GgSessionSeed) last written to the journal, kept so the one field that is
    /// not final until the session is — the resolved modalities — can be updated without the
    /// launch having to hold (or re-read) the seeded files a second time.
    ///
    /// The only body this recorder retains, and it is retained for the same reason the interner
    /// retains pool *ids*: it is bounded by the run's configuration rather than by its length.
    seed: Option<GgSessionSeed>,
    /// Why capture stopped, once it has. Set exactly once; capture never resumes.
    stopped: Option<GgSessionTruncationReason>,
    /// Whether the terminating [`End`](GgJournalLine::End) line has been written.
    finished: bool,
}

impl Capture {
    /// Queue the bodies interned for this entry and the entry itself as one batch, at the next
    /// global sequence.
    ///
    /// The bodies go first, so a reader walking the journal in order never meets a reference to a
    /// body it has not yet seen.
    fn push(&mut self, agent_id: &str, kind: GgSessionEntryKind) {
        let seq = self.next_seq;
        self.next_seq += 1;
        let mut lines = self.interner.take_pending();
        lines.push(GgJournalLine::Entry {
            entry: Box::new(GgSessionEntry {
                agent_id: agent_id.to_string(),
                seq,
                kind,
            }),
        });
        if self.queue_batch(lines) {
            self.entries += 1;
            self.last_seq = Some(seq);
        }
    }

    /// Write `seed` as the journal's current [envelope](GgJournalLine::Seed), together with any
    /// blob lines interning its provided files produced.
    ///
    /// Remembered whether or not the batch lands. A batch that does not land has stopped capture,
    /// so nothing further is written either way, and remembering it keeps the recorder's own view
    /// of the envelope the one the journal would have carried.
    fn write_seed(&mut self, seed: GgSessionSeed) {
        let mut lines = self.interner.take_pending();
        lines.push(GgJournalLine::Seed {
            seed: Box::new(seed.clone()),
        });
        self.seed = Some(seed);
        self.queue_batch(lines);
    }

    /// Queue `lines` as one indivisible batch, returning whether it landed.
    ///
    /// Everything that can stop capture is decided here, in this order:
    ///
    /// 1. capture already stopped — nothing further is ever written;
    /// 2. the batch would cross the [byte ceiling](Capture::max_bytes) — the ceiling is exact
    ///    rather than approximate, because writing *part* of a batch is precisely the hole the
    ///    whole scheme exists to prevent;
    /// 3. the queue is full or the writer is gone — a stalled disk, which stops capture rather
    ///    than blocking the runtime every agent shares.
    ///
    /// A batch that does not land leaves the interner holding indices for bodies that were never
    /// written. That is harmless *because* capture is now stopped: no later entry can reference
    /// them, so what is on disk remains a contiguous prefix.
    fn queue_batch(&mut self, lines: Vec<GgJournalLine>) -> bool {
        if self.stopped.is_some() {
            return false;
        }
        let Some(queue) = self.queue.as_ref() else {
            return false;
        };
        let mut batch = String::new();
        for line in &lines {
            match serde_json::to_string(line) {
                Ok(json) => {
                    batch.push_str(&json);
                    batch.push('\n');
                }
                // Unreachable for the shapes this module builds (every payload is already a
                // `Value` or a plain scalar), and stopping is the only safe response if it ever
                // happens: the entry that named those bodies would otherwise never be written.
                Err(_) => {
                    self.stop(GgSessionTruncationReason::WriteFailed);
                    return false;
                }
            }
        }
        let size = batch.len() as u64;
        if let Some(max) = self.max_bytes
            && self.bytes + size > max
        {
            self.stop(GgSessionTruncationReason::ByteCeiling);
            return false;
        }
        match queue.try_send(batch) {
            Ok(()) => {
                self.bytes += size;
                true
            }
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                self.stop(GgSessionTruncationReason::WriteFailed);
                false
            }
        }
    }

    /// Stop capture for the whole run, recording `reason` if nothing has stopped it yet.
    fn stop(&mut self, reason: GgSessionTruncationReason) {
        self.stopped.get_or_insert(reason);
    }

    /// The truncation the record should carry, given what stopped capture.
    fn truncation(&self) -> Option<GgSessionTruncation> {
        self.stopped.map(|reason| GgSessionTruncation {
            reason,
            last_seq: self.last_seq,
            bytes: Some(self.bytes),
        })
    }
}

/// The run-wide recorder every session-record entry is streamed through.
///
/// Held behind an [`Arc`](std::sync::Arc) on the orchestrator and shared across every agent (the
/// root and each subagent), so all agents' model I/O and tool results accumulate into one ordered
/// journal. The [`seq`](GgSessionEntry::seq) counter is global — minted here across all agents — so
/// the interleaving of concurrent agents is recoverable by sorting on it.
pub struct GgRecorder {
    /// Everything the capture mutates, behind the one lock described on [`Capture`].
    capture: Mutex<Capture>,
    /// The writer thread, joined by [`finish`](Self::finish). Behind its own lock because the
    /// recorder is shared immutably and joining consumes the handle.
    writer: Mutex<Option<JoinHandle<WriterReport>>>,
}

impl GgRecorder {
    /// Open `journal_path` and start capturing `session_id`'s inputs into it, bounded by
    /// `max_bytes`.
    ///
    /// Writes the [header](GgJournalLine::Header) line before returning, so that even a journal
    /// with no entries at all identifies the session it belongs to and the build that wrote it.
    /// The parent directory is created if it does not exist.
    ///
    /// Fails only when the journal cannot be opened — the one condition under which there is
    /// nothing to capture *into*. The caller reports that as a launch warning and runs without
    /// capture rather than failing the run over a debugging artifact.
    pub fn start(
        journal_path: &Path,
        session_id: &str,
        capability_set: &GgCapabilitySet,
        max_bytes: Option<u64>,
    ) -> std::io::Result<Self> {
        if let Some(parent) = journal_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = File::create(journal_path)?;
        let (queue, lines) = sync_channel::<String>(JOURNAL_QUEUE_DEPTH);
        let writer = std::thread::Builder::new()
            .name("gg-session-journal".to_string())
            .spawn(move || write_journal(file, &lines))?;

        let recorder = Self {
            capture: Mutex::new(Capture {
                interner: GgJournalInterner::new(),
                queue: Some(queue),
                next_seq: 0,
                entries: 0,
                last_seq: None,
                bytes: 0,
                max_bytes,
                seed: None,
                stopped: None,
                finished: false,
            }),
            writer: Mutex::new(Some(writer)),
        };
        recorder
            .capture
            .lock()
            .expect("session capture lock")
            .queue_batch(vec![GgJournalLine::Header {
                format_version: GG_SESSION_FORMAT_VERSION,
                session_id: session_id.to_string(),
                capability_set: Box::new(capability_set.clone()),
                recorder: GgSessionRecorder {
                    // This binary's own version, not the release version `core` resolves a
                    // download from: the record's question is "which build wrote this?".
                    gg_version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    commit: None,
                },
            }]);
        Ok(recorder)
    }

    /// Record the run's **[seed](GgSessionSeed)**: the fixed identity the session started
    /// from, before it consumes a single entry.
    ///
    /// Called by the launch, as soon as the orchestrator that resolved the envelope exists — not at
    /// teardown, because the records that most need a seed belong to the sessions that never
    /// reached one.
    ///
    pub fn record_seed(&self, seed: RecordedSeed<'_>) {
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        capture.write_seed(GgSessionSeed {
            baseline_commit: seed.baseline_commit.map(str::to_string),
            prompt: seed.prompt.to_string(),
            model_windows: seed.model_windows,
            model_modalities: seed.model_modalities,
        });
    }

    /// Update the recorded [seed](GgSessionSeed)'s **resolved** modality state, rewriting the
    /// envelope only if it has actually moved.
    ///
    /// Called once at the end of the run. A model's modality state is not a launch fact: a
    /// provider that refuses an image denies that model for the rest of the session, and a
    /// record that reported the un-denied state would say the run had vision on turns where it
    /// did not.
    ///
    /// The equality check is what keeps this free for the overwhelming majority of runs, in which
    /// nothing was ever denied: no denial, no second envelope, no bytes. It also means the journal
    /// carries a second seed line exactly when there is something new to say.
    pub fn record_resolved_modalities(&self, modalities: BTreeMap<String, GgSessionModalities>) {
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        let Some(seed) = capture.seed.clone() else {
            return;
        };
        if seed.model_modalities == modalities {
            return;
        }
        capture.write_seed(GgSessionSeed {
            model_modalities: modalities,
            ..seed
        });
    }

    /// Record one **[agent](GgSessionAgent)** and how it came to exist.
    ///
    /// Called twice per agent: once the moment it exists — before it queues for a scheduler slot,
    /// let alone takes a turn — and once when its loop ends, with the terminal status and any
    /// ceiling that stopped it. Assembly upserts the row by
    /// [`agent_id`](GgSessionAgent::agent_id), so the second supersedes the first and an agent that
    /// never reached an ending keeps the row it was born with.
    ///
    /// Recorded at all — rather than derived from which agents happen to appear in the entries —
    /// because the derivation silently omits the agents worth explaining: the one still queued
    /// behind the parallelism cap when the run was killed, the one whose first model call never
    /// returned. Both ran; neither pinned an input.
    pub fn record_agent(&self, agent: GgSessionAgent) {
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        capture.queue_batch(vec![GgJournalLine::Agent {
            agent: Box::new(agent),
        }]);
    }

    /// Record one agent turn's **model I/O**: the `messages`/`tools` request sent to the model and
    /// the `response` it returned, tagged with the recording `agent_id` and the next global
    /// sequence.
    ///
    /// `role` says which of gg's two model clients issued it and `shape` whether the offered tool
    /// was *required*; both are what keep a compaction turn from consuming an agent's next real
    /// turn, and a required call from being silently replayed as an offered one.
    ///
    /// An **empty** `tools` slice records no toolset at all rather than an empty one: the contract
    /// distinguishes "offered nothing" from "offered an empty array", and a turn that offers no
    /// tools is the former.
    ///
    /// `response` is the reply the client **returned**, which is the only reply the conversation
    /// ever held. A reply abandoned mid-stream by [loop detection](crate::loopguard) is therefore
    /// never journalled: it was never returned and never entered the conversation, so a record
    /// carrying it would describe a window the agent never had. All that survives of the discarded
    /// attempts is their [tally](crate::model::LoopAborts) — how many there were and how much they
    /// generated — on
    /// [`ModelResponse::loop_aborts`](crate::model::ModelResponse::loop_aborts) — or, when every
    /// attempt looped and nothing was returned at all, on the recorded
    /// [error](GgSessionModelErrorKind::ResponseLoop)'s `attempts`.
    pub fn record_model_io(&self, call: RecordedCall<'_>, response: &ModelResponse) {
        // Serialized outside the lock: this is the bulk of the per-turn work, and holding the one
        // lock every agent shares across it would serialize the fleet on the recorder.
        let messages: Vec<Value> = call.messages.iter().map(to_value).collect();
        let tools = (!call.tools.is_empty()).then(|| to_value(&call.tools));
        let response = to_value(response);

        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        let request =
            capture
                .interner
                .intern_request(call.role, call.shape, &messages, tools.as_ref());
        capture.push(
            call.agent_id,
            GgSessionEntryKind::ModelIo {
                request,
                response,
                duration_ms: call.duration_ms,
            },
        );
    }

    /// Record one model call that **failed**: the request that was sent and the error the loop
    /// branched on.
    ///
    /// Both classes of error that a loop *recovers* from change control flow, so both are
    /// recorded. A [vision refusal](GgSessionModelErrorKind::VisionUnsupported) strips the images
    /// and re-runs the same turn, so a record without the refusal would show two nearly identical
    /// calls and no reason for the second; a
    /// [retry exhaustion](GgSessionModelErrorKind::RetryExhausted) counts against the run's error
    /// ceiling, so a record without it could not explain why the run stopped.
    ///
    /// Recorded with the same request the successful call carries, because the request is what
    /// identifies *which* turn failed — a vision-refused turn and the stripped retry that follows
    /// it are two calls a few milliseconds apart, and only their conversations tell them apart.
    pub fn record_model_error(&self, call: RecordedCall<'_>, error: &ModelError) {
        // Serialized outside the lock, exactly as the successful path is.
        let messages: Vec<Value> = call.messages.iter().map(to_value).collect();
        let tools = (!call.tools.is_empty()).then(|| to_value(&call.tools));
        let error = session_model_error(error);

        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        let request =
            capture
                .interner
                .intern_request(call.role, call.shape, &messages, tools.as_ref());
        capture.push(
            call.agent_id,
            GgSessionEntryKind::ModelError {
                request,
                error,
                duration_ms: call.duration_ms,
            },
        );
    }

    /// The ceiling a **subprocess stream** is interned under. See [`GG_SESSION_STREAM_MAX_BYTES`].
    fn stream_max_bytes(&self) -> Option<usize> {
        Some(GG_SESSION_STREAM_MAX_BYTES)
    }

    /// The ceiling a **tool payload** is interned under, which is eight times the stream ceiling
    /// and for a reason worth restating at the seam: what a tool returns *is* what the model was
    /// shown, so clipping it below the tool layer's own cap would record a file the model read in
    /// full as a tail of itself. See [`GG_SESSION_TOOL_MAX_BYTES`].
    fn tool_max_bytes(&self) -> Option<usize> {
        Some(GG_SESSION_TOOL_MAX_BYTES)
    }

    /// Record one **shell command** gg ran on the agent's behalf, from whichever of the three
    /// command paths issued it.
    ///
    /// A [hook's](crate::hooks) commands are the reason this exists as a seam of its own: they run
    /// `sh -c` through the same code path a `shell` tool call does but never reach tool dispatch,
    /// so nothing below dispatch would see them — and an
    /// [agent-stop](test_cabinet_core::gg::GgHookEvent::AgentStop) gate decides whether the session
    /// is allowed to end, which is as control-flow-changing as an input gets.
    pub fn record_shell(
        &self,
        agent_id: &str,
        origin: GgShellOrigin,
        command: RecordedCommand<'_>,
    ) {
        self.record_command(
            agent_id,
            |command| GgSessionEntryKind::Shell { origin, command },
            command,
        );
    }

    /// Record one **`git` subprocess** gg's own orchestration ran — a worktree add, a commit, a
    /// merge, a diff.
    ///
    /// These bypass tool dispatch entirely, so this seam is the only thing that captures them —
    /// and they are not bookkeeping a reader can take for granted: a merge that conflicts
    /// changes the run, and a reviewer's verdict is rendered against whatever `git diff --stat`
    /// printed.
    pub fn record_git(&self, agent_id: &str, command: RecordedCommand<'_>) {
        self.record_command(
            agent_id,
            |command| GgSessionEntryKind::Git { command },
            command,
        );
    }

    /// Intern one subprocess's streams and push the entry `kind` builds from them.
    ///
    /// Both stream payloads are interned under the capture's
    /// [stream ceiling](Self::stream_max_bytes): a build log is the archetype of a payload that is
    /// megabytes long and was never shown to the model in full, so recording its kept tail with a
    /// row saying how much was dropped is what keeps one noisy command from spending the whole
    /// run's journal budget.
    fn record_command(
        &self,
        agent_id: &str,
        kind: impl FnOnce(GgSessionCommand) -> GgSessionEntryKind,
        command: RecordedCommand<'_>,
    ) {
        let max_bytes = self.stream_max_bytes();
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        let stdout = capture
            .interner
            .intern_text_clipped(command.stdout, max_bytes);
        let stderr = capture
            .interner
            .intern_text_clipped(command.stderr, max_bytes);
        let command = GgSessionCommand {
            command: command.command.to_string(),
            cwd: command.cwd,
            exit_code: command.exit_code,
            stdout,
            stderr,
        };
        capture.push(agent_id, kind(command));
    }

    /// Record one read of the **cancel file**.
    ///
    /// It ends the session, so a reader that could not see it would run past the point
    /// the run stopped — and a killed run is one of the two outcomes always-on capture exists for.
    /// Recorded on every read rather than only on the one that fired: "the probe was read forty
    /// times and found nothing" is what makes the fortieth read's `true` an input rather than an
    /// unexplained ending.
    pub fn record_cancel_probe(&self, agent_id: &str, canceled: bool) {
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        capture.push(agent_id, GgSessionEntryKind::CancelProbe { canceled });
    }

    /// Record one read of the **wall-clock deadline**: how long the session had been running, and
    /// how much of its budget was left.
    ///
    /// Recorded because it is the one clock read the loop *branches* on: the run stops at the turn
    /// boundary where the budget is spent, so a record that omitted it could not explain why a
    /// session ended where it did.
    pub fn record_clock(&self, agent_id: &str, elapsed_ms: u64, remaining_ms: Option<u64>) {
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        capture.push(
            agent_id,
            GgSessionEntryKind::Clock {
                elapsed_ms,
                remaining_ms,
            },
        );
    }

    /// Record one **tool result**: the `call` the agent (or a code program) made and the exact
    /// `outcome` the dispatch returned, tagged with the recording `agent_id` and the next global
    /// sequence.
    ///
    /// The outcome's bulky payloads are interned rather than inlined, and that is not only a size
    /// win: a tool's output is quoted **verbatim** into the `tool` message that carries it into the
    /// window, so the outcome and that message body are duplicates of one another and one table
    /// collapses the pair.
    ///
    /// A program-composed call arrives here under the synthetic id the loop minted for it
    /// ([`PROGRAM_CALL_ID_PREFIX`](crate::sandbox::PROGRAM_CALL_ID_PREFIX)), and that prefix is the
    /// only thing distinguishing the two in the record — it is what lets a reader attribute
    /// the entry to the open turn's *program* instead of to a native tool call the model never
    /// made.
    pub fn record_tool_result(&self, agent_id: &str, call: &ToolCall, outcome: &ToolOutcome) {
        let arguments = call.arguments.clone();
        let (data, lifted) = split_tool_data(outcome.data.as_ref());
        let failure = outcome.failure.as_ref().map(to_value);

        let max_bytes = self.tool_max_bytes();
        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        // The output is clipped under the capture's ceiling; the summary never is. A summary is a
        // sentence by construction, and one that somehow was not would still be shorter than the
        // ceiling it would be measured against.
        let output = capture
            .interner
            .intern_text_clipped(&outcome.output, max_bytes);
        // The text lifted out of `data` goes through the same pool under the same ceiling — and
        // usually lands on the entry `output` just took, because a whole-file read's `contents` and
        // its `output` are the same string.
        let data_text = lifted
            .as_deref()
            .map(|text| capture.interner.intern_text_clipped(text, max_bytes));
        let summary = outcome
            .summary
            .as_deref()
            .map(|summary| capture.interner.intern_text(summary));
        // Descriptors, never payloads — the same thing the telemetry stream records of an
        // attached image, so the two cannot disagree about what a turn carried.
        let images: Vec<GgSessionImage> = outcome
            .images
            .iter()
            .map(|image| GgSessionImage {
                media_type: image.media_type.clone(),
                bytes: image.bytes,
            })
            .collect();
        capture.push(
            agent_id,
            GgSessionEntryKind::ToolResult {
                call: GgSessionToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments,
                    // The working directory is not observable at this seam yet; recording
                    // `Workspace` would assert something the capture does not know.
                    cwd: None,
                },
                outcome: GgSessionToolOutcome {
                    ok: outcome.ok,
                    output,
                    summary,
                    images,
                    data,
                    data_text,
                    failure,
                },
            },
        );
    }

    /// Record one agent's **prompt frame**: the window as it stood for the turn just sent, each
    /// item carrying the four window-model fields a rendered message does not — its
    /// [slot](PromptSlot), its [retention](Retention), the [turn](PromptItem::turn) it was pushed
    /// on, and a paged file view's [region](crate::context::FileRegion).
    ///
    /// # Why this is a separate entry rather than fields on the request
    ///
    /// The request is what the *client* sent — a flat message array. Everything above is gg's own
    /// window model, and it is recoverable from nowhere else: not from that array, not from the
    /// telemetry stream, not from the raw output. Recording it is what lets a reader
    /// compare the window it **builds** against the one the record pinned, so a drift in what a
    /// compaction kept, or in which page of a file a view covers, is caught where it happens
    /// rather than several turns later when it changes what the model says.
    ///
    /// # It costs almost nothing
    ///
    /// Every message here was interned moments ago by the [`RecordingClient`] for this same turn's
    /// [`ModelIo`](GgSessionEntryKind::ModelIo) entry — same bodies, same content addresses, so the
    /// pool does not grow and the frame is a list of small integers. That holds only because both
    /// go through one [interner](GgSessionInterner); it is not an assumption the frame makes about
    /// the client's behavior, and a body this seam somehow sees first is simply interned here.
    ///
    /// Called **after** the model call it describes and before that agent's next one — the same
    /// attachment rule tool results follow. That ordering handles vision recovery for free: a
    /// refused image turn records `model_error → model_io → prompt_frame`, so the frame attaches
    /// to the call that was actually sent rather than to the one that was refused.
    pub fn record_prompt_frame(&self, agent_id: &str, items: &[PromptItem<'_>]) {
        // Serialized outside the lock, like every other seam: this is the bulk of the work, and the
        // one lock is shared by every agent in the run.
        let bodies: Vec<Value> = items.iter().map(|item| to_value(item.message)).collect();

        let mut capture = self.capture.lock().expect("session capture lock");
        if capture.stopped.is_some() {
            return;
        }
        let items: Vec<GgSessionPromptItem> = items
            .iter()
            .zip(bodies.iter())
            .map(|(item, body)| GgSessionPromptItem {
                message: capture.interner.intern_message(body),
                slot: match item.slot {
                    PromptSlot::System => GgSessionPromptSlot::System,
                    PromptSlot::Thread => GgSessionPromptSlot::Thread,
                    PromptSlot::ContextUsage => GgSessionPromptSlot::ContextUsage,
                    PromptSlot::TrailingNotice => GgSessionPromptSlot::TrailingNotice,
                },
                source: item.source,
                retention: match item.retention {
                    Retention::Pinned => GgSessionRetention::Pinned,
                    Retention::Ephemeral => GgSessionRetention::Ephemeral,
                },
                turn: item.turn,
                label: item.label.map(str::to_string),
                region: item.region.map(|region| GgSessionFileRegion {
                    offset: region.offset,
                    limit: region.limit,
                }),
            })
            .collect();
        capture.push(agent_id, GgSessionEntryKind::PromptFrame { items });
    }

    /// Close the journal: write the mandatory [`End`](GgJournalLine::End) line, drop the writer's
    /// queue and join the writer thread.
    ///
    /// The `End` line is written even when capture has already stopped — that is *how* the record
    /// says why — and is deliberately exempt from the byte ceiling, since a ceiling that suppressed
    /// the marker would turn a deliberate truncation into an indistinguishable one.
    ///
    /// Idempotent: a second call reports the same figures and writes nothing.
    pub fn finish(&self) -> GgCaptureReport {
        let mut capture = self.capture.lock().expect("session capture lock");
        let truncation = capture.truncation();
        if !capture.finished {
            capture.finished = true;
            let end = GgJournalLine::End {
                entries: capture.entries,
                truncation: truncation.clone(),
            };
            // Queued directly rather than through `queue_batch`, which would refuse it: capture
            // is often already stopped by the time this runs, and that is exactly the case whose
            // reason has to reach the record.
            if let Some(queue) = capture.queue.as_ref()
                && let Ok(line) = serde_json::to_string(&end)
            {
                send_end_line(queue, format!("{line}\n"));
            }
            // Dropping the queue closes the channel, which is what ends the writer's loop.
            capture.queue = None;
        }
        let entries = capture.entries;
        let bytes = capture.bytes;
        drop(capture);

        let handle = self.writer.lock().expect("session writer lock").take();
        // A writer that **panicked** reports as a write error rather than as no error at all. It
        // never got to say what it had written, so the journal is short by an unknown amount — the
        // one state a report of `None` would describe as a clean recording, which is the single
        // most misleading thing this module could do (see the module docs).
        //
        // It is reported and **not** latched as a [gg fault](crate::fault), which is the one place
        // in gg a panic of ours does not disqualify the run. That is a decision rather than an
        // omission, and it follows from what the journal is: a sidecar for *debugging* a run, not
        // part of the tree the run is scored on. A panicked writer costs the operator some replay
        // and costs the model's result nothing, so ending the run over it would throw away a real
        // result to protect a debugging aid — the opposite of the trade every other fault makes,
        // where the result itself is what cannot be trusted. What the ruling does require is that
        // the loss is *stated*, which is what the report above is for; a short journal that claimed
        // to be whole would be the misattribution, and it is the thing this closes.
        let write_error = handle.and_then(|handle| match handle.join() {
            Ok(report) => report.error,
            Err(payload) => Some(format!(
                "the journal writer thread panicked ({}); whatever it had not yet written is \
                 missing from the record",
                panic_message(&*payload)
            )),
        });
        GgCaptureReport {
            entries,
            bytes,
            truncation,
            write_error,
        }
    }
}

/// Hand the terminating [`End`](GgJournalLine::End) line to the writer, waiting out a queue that is
/// merely behind.
///
/// Unlike every other line, this one is retried: see [`END_LINE_QUEUE_GRACE`] for why losing it is
/// uniquely damaging and why the wait is nevertheless bounded. A disconnected writer (the thread
/// died on an I/O error) returns immediately — there is nobody to receive it, and the record it
/// already reported the failure through says so.
fn send_end_line(queue: &SyncSender<String>, line: String) {
    let deadline = std::time::Instant::now() + END_LINE_QUEUE_GRACE;
    let mut pending = line;
    loop {
        match queue.try_send(pending) {
            Ok(()) => return,
            Err(TrySendError::Full(returned)) => {
                if std::time::Instant::now() >= deadline {
                    return;
                }
                pending = returned;
                std::thread::sleep(END_LINE_RETRY_INTERVAL);
            }
            Err(TrySendError::Disconnected(_)) => return,
        }
    }
}

/// What the [writer thread](write_journal) did, reported back on join.
struct WriterReport {
    /// The I/O failure that ended it early, when one did.
    error: Option<String>,
}

/// The text a test plants in a captured body to make the writer thread **panic** on the batch that
/// carries it.
///
/// # Why the seam exists
///
/// A writer thread that dies mid-run is the one capture failure with no I/O error behind it, and the
/// one whose report is most easily wrong: the thread never reports anything, so the *absence* of an
/// error is what [`finish`](GgRecorder::finish) would otherwise see, and it would describe a journal
/// missing an unknown number of lines as a clean recording. Nothing a test can write makes a
/// `write_all` to a temp file panic, so without a seam that arm has no proof, and it is precisely
/// the arm where a regression is silent.
///
/// # What keeps it honest
///
/// It is `#[cfg(test)]`, so it does not exist in a released binary, and it is *data* rather than a
/// flag: the panic happens on the real writer thread, on a real batch, in the middle of the real
/// loop — which is the shape of the failure it stands in for.
#[cfg(test)]
pub(crate) const WRITER_PANIC_MARKER: &str = "gg-capture-writer-panic-fixture";

/// The writer thread's loop: append each queued batch to the journal until the recorder closes the
/// channel.
///
/// A batch is already a run of complete, newline-terminated lines, so one `write_all` per batch is
/// both the whole of the work and the unit of atomicity. On an I/O error the loop **returns** rather
/// than draining on: that disconnects the channel, so the recorder's next send fails and capture
/// stops for the whole run — which is the honest outcome, since anything it wrote after the failure
/// would be unreachable from a journal whose earlier bytes are missing.
fn write_journal(mut file: File, lines: &std::sync::mpsc::Receiver<String>) -> WriterReport {
    for batch in lines {
        // A test may have planted the marker that makes this thread die where no I/O error can; see
        // [`WRITER_PANIC_MARKER`].
        #[cfg(test)]
        assert!(
            !batch.contains(WRITER_PANIC_MARKER),
            "the journal writer met the test fixture's panic marker"
        );
        if let Err(err) = file.write_all(batch.as_bytes()) {
            return WriterReport {
                error: Some(err.to_string()),
            };
        }
    }
    WriterReport {
        error: file.flush().err().map(|err| err.to_string()),
    }
}

/// Serialize `value` for the journal, falling back to `null` rather than failing the run.
///
/// Unreachable for every type this module serializes (none has a map with non-string keys or a
/// failing `Serialize`), and a `null` payload is a visible defect in a record rather than a silent
/// one — which is the right shape for a capture that must never abort what it observes.
fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

/// Split a tool's structured [`ApiData`] into the part that is recorded inline and the one
/// unbounded text field that is [pooled instead](GgSessionToolOutcome::data_text).
///
/// Two variants carry the whole of what the tool returned a second time — a `read_file`'s
/// `contents` and a `shell`'s `body` — and both are duplicates of the `output` the same outcome
/// already interns. Recording them inline would put the record's single largest payload in the one
/// place that is neither pooled, deduped nor clipped, and would leave the entry holding two
/// disagreeing answers whenever the ceiling did cut `output`.
///
/// The lift is by **variant**, not by field name, so it cannot silently start (or stop) applying to
/// a payload as `ApiData` grows: a new variant carrying an unbounded string has to be added here
/// deliberately, and until it is, it is recorded inline exactly as today. Every other variant is a
/// handful of numbers and short strings and is left whole — pooling those would cost a pool entry
/// to save nothing.
///
/// The returned text is `Some` whenever the variant *has* the field, empty body included, so the
/// reading's restore is driven by the variant alone and never has to guess whether an
/// absent index means "empty" or "not lifted".
fn split_tool_data(data: Option<&ApiData>) -> (Option<Value>, Option<String>) {
    match data {
        Some(ApiData::FileText(file)) => {
            let mut file = file.clone();
            let contents = std::mem::take(&mut file.contents);
            (Some(to_value(&ApiData::FileText(file))), Some(contents))
        }
        Some(ApiData::Shell(shell)) => {
            let mut shell = shell.clone();
            let body = std::mem::take(&mut shell.body);
            (Some(to_value(&ApiData::Shell(shell))), Some(body))
        }
        other => (other.map(to_value), None),
    }
}

/// A [`ModelClient`] decorator that streams each turn's **model I/O** into a [`GgRecorder`].
///
/// It wraps the agent's real client and is the sole model-I/O recording seam: every `complete` the
/// agent makes flows through here, so the record holds the exact request/response pair of every
/// model step the session took. The `model_id` and error behavior pass straight through, so
/// wrapping is invisible to the loop.
pub struct RecordingClient {
    /// The wrapped real client.
    inner: Box<dyn ModelClient>,
    /// The shared recorder this client's I/O is streamed into.
    recorder: std::sync::Arc<GgRecorder>,
    /// The id of the agent this client drives, stamped onto every recorded entry.
    agent_id: String,
    /// Which of gg's two model clients this one is, stamped onto every recorded request so a
    /// compaction turn and the agent's own next turn cannot interleave into one indistinguishable
    /// queue.
    role: GgClientRole,
}

impl RecordingClient {
    /// Wrap `inner` so each of its `complete` calls is recorded under `agent_id` into `recorder`,
    /// as the agent's own turn loop.
    pub fn new(
        inner: Box<dyn ModelClient>,
        recorder: std::sync::Arc<GgRecorder>,
        agent_id: impl Into<String>,
    ) -> Self {
        Self {
            inner,
            recorder,
            agent_id: agent_id.into(),
            role: GgClientRole::Agent,
        }
    }

    /// The same wrapping for the **compaction summarizer's** client, whose calls rewrite the whole
    /// window rather than advancing the conversation.
    ///
    /// gg's second model client was never wrapped at all, so *every handoff-compaction model call
    /// in every record captured to date is missing* — and a handoff compaction is precisely the
    /// event a reader goes to a record to understand, because it is the point at which the agent's
    /// window stops being the conversation that produced it.
    ///
    /// The [role](GgClientRole) is what makes the second queue representable. Without it a
    /// summarizer call and the agent's own next turn interleave into one indistinguishable stream
    /// and a reader serves the wrong one to whichever asked first — so the discriminator
    /// is not labelling, it is the correctness condition for capturing this client at all.
    pub fn for_compaction(
        inner: Box<dyn ModelClient>,
        recorder: std::sync::Arc<GgRecorder>,
        agent_id: impl Into<String>,
    ) -> Self {
        Self {
            role: GgClientRole::Compaction,
            ..Self::new(inner, recorder, agent_id)
        }
    }

    /// Record the outcome of one call — the response, or the error — under `shape`.
    ///
    /// Both halves go through one function so the two `ModelClient` methods cannot record a
    /// success and a failure on different terms, and so the latency clock is read in exactly one
    /// place: around the inner call and nowhere else, which is what makes the recorded figure the
    /// provider's latency rather than the recorder's own work.
    async fn record(
        &self,
        shape: GgSessionRequestShape,
        messages: &[Message],
        tools: &[ToolDefinition],
        call: impl std::future::Future<Output = Result<ModelResponse, ModelError>>,
    ) -> Result<ModelResponse, ModelError> {
        let started = std::time::Instant::now();
        let outcome = call.await;
        let recorded = RecordedCall {
            agent_id: &self.agent_id,
            role: self.role,
            shape,
            messages,
            tools,
            duration_ms: Some(started.elapsed().as_millis() as u64),
        };
        match &outcome {
            Ok(response) => self.recorder.record_model_io(recorded, response),
            Err(error) => self.recorder.record_model_error(recorded, error),
        }
        outcome
    }
}

#[async_trait::async_trait]
impl ModelClient for RecordingClient {
    /// Recorded on the way out, so the captured response is exactly what the loop consumed — and
    /// a failure is recorded too, as a [`ModelError`](GgSessionEntryKind::ModelError) entry.
    ///
    /// Capturing the failure *here* rather than at the loop's error arm is what makes the vision
    /// recovery come out right: the recovery re-runs the same turn through this same client, so a
    /// refused image turn records `model_error → model_io`, and the prompt frame the loop records
    /// afterwards attaches to the call that was actually sent. The loop's error arm sees only the
    /// second failure and could not record the first at all.
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.record(
            GgSessionRequestShape::Complete,
            messages,
            tools,
            self.inner.complete(messages, tools),
        )
        .await
    }

    /// Recorded as a **required** call, and delegated to the inner client's own implementation
    /// rather than to the trait default — otherwise wrapping a run in session capture would quietly
    /// downgrade a required tool call to an offered one, and the recorded run would not be the run
    /// that happened.
    async fn complete_requiring(
        &self,
        messages: &[Message],
        tool: &ToolDefinition,
    ) -> Result<ModelResponse, ModelError> {
        self.record(
            GgSessionRequestShape::CompleteRequiring,
            messages,
            std::slice::from_ref(tool),
            self.inner.complete_requiring(messages, tool),
        )
        .await
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }
}

/// A [`ShellRunner`] decorator that streams every command line an agent reaches into a
/// [`GgRecorder`] — the **shell** half of capture, the exact counterpart of
/// [`RecordingClient`].
///
/// # Why this exists at the seam rather than at the three call sites
///
/// Three paths reach a command line — the [`shell`](crate::tools::SHELL_TOOL) tool, a
/// [responses-as-code](crate::sandbox) program's `system.shell(…)`, and a
/// [hook's](crate::hooks) commands — and only one of them, the hook, runs at a call site that
/// holds the recorder. Capturing at the call sites would therefore leave a session that used the
/// shell tool with no answer for a single one of its commands, and anything reading the
/// [record](test_cabinet_core::gg_session_record::GgSessionRecord) back would find a hole where
/// every one of them should have been.
///
/// The seam is where all three meet, so the capture belongs here: one decorator, and the
/// [origin](ShellRequest::origin) the caller stamped says which path it came from. Recording at the
/// seam also means what is pinned is what the *process* did, before the
/// [output policy](crate::tools::OffloadPolicy) merged the streams and added gg's notes — which is
/// the right side of that line, because a reader re-applies this build's presentation to
/// the recorded bytes.
///
/// # The workspace it measures against is the **agent's**
///
/// Not the run's. An agent working in an [issue worktree](crate::board) has its own root, and a
/// command it ran in `web/` has to read back as `web/` rather than as
/// `worktrees/AUTH-1/web/` — otherwise the same command issued by the root and by an issue agent
/// records as two different commands, and a reader matches neither. So gg builds one of
/// these per agent, rooted where that agent is, and a command a
/// [hook](crate::hooks) ran somewhere else is relativized against the agent's root
/// exactly as its own [`ToolContext`](crate::tools::ToolContext) was derived from it.
pub struct RecordingShellRunner {
    /// The runner that actually answers — whatever the session's
    /// [shell seam](crate::agent::SessionSeams::shell) supplied:
    /// [`RealShellRunner`](crate::tools::real_shell) in a live run, and gg's own suite's substitute
    /// under test.
    inner: std::sync::Arc<dyn ShellRunner>,
    /// The shared recorder every command is streamed into.
    recorder: std::sync::Arc<GgRecorder>,
    /// The **agent's** workspace root, which a recorded working directory is expressed relative to.
    workspace: std::path::PathBuf,
}

/// Printed as its name alone: a [`ToolContext`](crate::tools::ToolContext) carrying a runner has to
/// stay printable (several tool errors rely on it), and neither the wrapped runner nor the recorder
/// has anything a reader of one of those errors wants.
impl std::fmt::Debug for RecordingShellRunner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecordingShellRunner")
            .field("workspace", &self.workspace)
            .finish_non_exhaustive()
    }
}

impl RecordingShellRunner {
    /// Wrap `inner` so every command it runs is recorded into `recorder`, with working directories
    /// measured against `workspace` — the calling agent's own root.
    pub fn new(
        inner: std::sync::Arc<dyn ShellRunner>,
        recorder: std::sync::Arc<GgRecorder>,
        workspace: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            inner,
            recorder,
            workspace: workspace.into(),
        }
    }
}

#[async_trait::async_trait]
impl ShellRunner for RecordingShellRunner {
    /// Run the command, then record what it did.
    ///
    /// Every ending is recorded, including the two that are not an ordinary exit. A
    /// [timeout kill](ShellStatus::TimedOut) and a process that
    /// [never started](ShellStatus::LaunchFailed) both pin as exit `-1`, which is the same value
    /// the record already uses for a signalled process: the record's field is a plain `i32`, every
    /// consumer of it branches on "zero or not", and what a reader needs from those cases
    /// is that the command did not succeed and printed whatever it printed.
    async fn run(&self, request: ShellRequest) -> ShellExecution {
        let agent_id = request.agent_id.clone();
        let command = request.command.clone();
        let cwd = shell_cwd(&self.workspace, &request.cwd);
        let origin = request.origin;
        let execution = self.inner.run(request).await;
        self.recorder.record_shell(
            &agent_id,
            origin,
            RecordedCommand {
                command: &command,
                cwd,
                exit_code: match &execution.status {
                    ShellStatus::Exited { code } => code.unwrap_or(-1),
                    _ => -1,
                },
                stdout: &execution.stdout,
                stderr: &execution.stderr,
            },
        );
        execution
    }
}

#[cfg(test)]
#[path = "capture.test.rs"]
mod tests;
