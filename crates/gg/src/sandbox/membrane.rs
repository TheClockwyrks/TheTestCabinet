//! The membrane: the trust boundary, generated from `crates/gg/wit/gg-sandbox.wit`, and the one
//! helper every host function on it goes through.
//!
//! [`bindgen!`](wasmtime::component::bindgen) turns the WIT into one `Host` trait per interface,
//! and this module (with its five submodules) implements every one of them for [`MembraneState`].
//! That is what makes the boundary typed end to end: a program calls `readFile(path, { limit })`,
//! the guest lowers it into a WIT call with typed parameters, and the host receives
//! `read_file(path: String, offset: Option<u32>, limit: Option<u32>)`. Nothing on this path names a
//! call by a string or hands it a bag of JSON: [`MembraneState::call`] runs a typed method on the
//! [api](OperationApi), which builds the native implementation and calls it. Dispatch by name with a JSON
//! payload is the *other* surface's shape, where a model really does emit a name and an object, and
//! it is reached from the [loop](crate::agent) rather than from here. The compiler, not a test, is
//! what guarantees a WIT function cannot exist without a host implementation.
//!
//! # Two helpers, so the guarantees exist once
//!
//! **Every** host function on this membrane — all forty-eight of them, dispatching or not — opens
//! an API-call bracket with [`MembraneState::recorded`], which is what records the call the *model
//! wrote* under its own identity and is the only source of the [`Recording`](recording) token
//! without which a host function can reach neither the [api](OperationApi) nor the dispatch path. See
//! [`recording`] for what that record carries and why it is keyed on the operation.
//!
//! Inside that bracket, every host function that reaches gg's real machinery funnels through
//! [`MembraneState::call`] (or its one sibling [`call_raw`](MembraneState::call_raw)), carrying the
//! same [operation](OperationId) the bracket was opened with. That is where the run's wall-clock
//! deadline is honoured, where the ordered call record is kept, where pictures are collected, and
//! where a failed [`ToolOutcome`] becomes a typed `api-error`. A host function itself is three
//! lines: normalise what the WIT declared, call, and convert the
//! [structured sidecar](crate::tools::ApiData) into its typed WIT result.
//!
//! A handful of functions reach nothing and so skip both. The three
//! [session-ending calls](session) set this agent's ending flag through
//! [`MembraneState::declare`], because ending a session is the one thing a program may ask for that
//! no spent budget may withhold. The [documentation directory](docs), the
//! [program library](programs) and four of the five [view calls](views) go straight to the
//! [api](OperationApi) for the same reason: `dispatch`'s deadline guard is wrong for a call that performs
//! no work, and a program that cannot show itself what it computed has nothing to report at all. The
//! fifth view call, `open-file-view`, performs a read and goes through `dispatch` like any other —
//! under `views.open_file`, which is the call the model wrote, and not under either of the two other
//! operations that share the read.
//!
//! # The capability gate is the bracket, and it is the only one
//!
//! Every arm's SDK is **static**: every function is compiled, linked and callable in every program
//! whatever the run enabled, so no guest withholds a name and this boundary is the whole of gg's
//! enforcement. [`recorded`](recording) checks it — once, for every model-facing call, tool or not —
//! against the [grant](crate::sandbox::Grants) this agent holds, which is the same value the
//! [documentation runtime](crate::docs::DocsRuntime::bound) filters a search with. There is no
//! second reading anywhere: not in a guest, not per family, and not in [`dispatch`](MembraneState),
//! which used to carry an enabled-set backstop that refused with a gg tool name no model can type.
//!
//! # The state is the agent's, not the program's
//!
//! [`MembraneState`] is where a program's calls are aimed: it carries the invoker that reaches *this
//! agent's* loop, the [grant](crate::sandbox::Grants) *this agent* holds, and the flag that says
//! whether *this agent* has declared itself done. Nothing about ending a run lives in the guest, which is why `finish` needs
//! no exception and no unwind — it writes a field here, the program carries on, and the loop reads
//! the field when the program has ended.
//!
//! # Why a refusal, and not a trap
//!
//! `trappable_imports` is off, so a generated host function returns the WIT value type directly and
//! **cannot trap**. That is not a limitation to work around: it is what keeps a program's failures
//! inside the program, where the model can see them, catch them, and fix them. The deadline guard
//! is therefore a `limit-exceeded` error rather than a kill — the program is told its budget is
//! spent, its effects so far stand, and it stops on its own.
//!
//! # Where the two halves live
//!
//! This file is the **policy**: what is dispatched, what is refused, and what a failed outcome
//! becomes. Its [`capture`] sibling is the **bookkeeping**: what a program is allowed to leave
//! behind — the roster, the refusals, the logs, the pictures — and the caps that bound each of
//! them, all of which are charged to the next turn's context window.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use test_cabinet_core::gg::{GgCallFailure, GgUndocumentedCalls};
use wasmtime::component::ResourceTable;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

use super::invoker::{OperationApi, SandboxRefusal, SandboxToolCall, SandboxViewOpened};
use super::language::{ProgramLanguage, spell};
use super::limits::{MemoryLimiter, SandboxLimits};
use super::locate::Locations;
use super::operations::{
    Binding, Grants, OperationId, SESSION_APPROVE, SESSION_FINISH, SESSION_REQUEST_CHANGES,
    operation,
};
use super::{ProgramCompletion, ProgramError, ProgramErrorKind, ProgramScope};
use crate::ending::{Ending, EndingRole};
use crate::tools::{ApiData, ToolFailure, ToolOutcome};

mod capture;
mod context;
mod delegation;
mod docs;
mod knowledge;
pub(crate) mod math;
mod programs;
mod recording;
mod session;
mod views;
pub(crate) mod wire;
mod workspace;

use recording::{GuardedApi, Recording};

wasmtime::component::bindgen!({ world: "sandbox", path: "wit" });

use test_cabinet::gg::feedback;
use test_cabinet::gg::types::{self, ApiError, ErrorCode};

/// Which ending calls one sandbox run binds.
///
/// Almost always an agent's own [role](EndingRole): the guest is handed the same value the host
/// holds, so the ending calls bound into a program's scope and the ones this membrane will accept
/// are decided once, from one value — and the membrane checks it, rather than trusting the guest to
/// have withheld what it was told to withhold. See [`MembraneState::declare`] for why that check is
/// the gate rather than a backstop.
///
/// [`None`](Self::None) is the exception, and it exists for exactly one caller: an **on-use script**,
/// the code a [skill](crate::skills) or a [memory](crate::memories) runs when the agent first reads
/// it. That script is not the agent's turn — the model did not write it and is not answering for it
/// — so it must not be able to declare the session over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnding {
    /// The agent's own role. A turn.
    Role(EndingRole),
    /// No ending group at all. An on-use script.
    None,
}

impl RunEnding {
    /// The [role](EndingRole) this is, as the [grant](Grants) spells it: `None` for an on-use
    /// script, which is not the agent's turn and may end no session.
    ///
    /// A method rather than a `From` impl on `Option<EndingRole>`, because implementing a trait on a
    /// std type would make `EndingRole` — which is `pub(crate)`, deliberately — reachable at `pub`
    /// through it.
    pub(super) fn role(self) -> Option<EndingRole> {
        match self {
            Self::Role(role) => Some(role),
            Self::None => None,
        }
    }
}

impl From<RunEnding> for EndingKind {
    fn from(ending: RunEnding) -> Self {
        match ending {
            RunEnding::Role(EndingRole::Standard) => Self::Standard,
            RunEnding::Role(EndingRole::Review) => Self::Review,
            RunEnding::None => Self::None,
        }
    }
}

/// The per-[`Store`](wasmtime::Store) host state: the operation bridge, the memory limiter, the run's
/// wall-clock deadline, and everything the program accumulated on its way to a result.
///
/// It owns its invoker (rather than borrowing one) so the store's data is `'static` with no
/// lifetime erasure and no `unsafe`, and it is reclaimed whole by
/// `into_parts` on **every** exit path — including a trap — because the calls a
/// program landed before it was stopped are exactly what the model needs to see next turn.
pub(crate) struct MembraneState<A: OperationApi> {
    /// The native, typed operation surface a bridged call is aimed at: the loop's own state in
    /// production ([`LoopOperationApi`](crate::agent)), an in-memory fake under test.
    ///
    /// Behind a [guard](recording::GuardedApi) rather than in the open, so that no host function can
    /// reach it without first opening the API-call bracket that records what the model called.
    api: GuardedApi<A>,
    /// The [language](ProgramLanguage) this program is written in, held for one reason: a refusal
    /// that tells the model which call to make instead has to name it the way *this* program would
    /// write it. See [`spell`].
    language: &'static dyn ProgramLanguage,
    /// How many model-facing API calls this program has made — every host function, dispatching or
    /// not, refused or serviced. See [`recording`].
    api_calls: u64,
    /// How many of those calls the model made **without having read the call's documentation**, and
    /// which operations they were — the [discovery](crate::discovery) finding, accumulated at the
    /// same bracket that counts [`api_calls`](Self::api_calls) above it.
    ///
    /// A count and nothing more: it refuses nothing, ends nothing and is not consulted by anything
    /// the program can observe. Empty for the overwhelming majority of programs, and for every
    /// program of gg's own.
    undocumented: GgUndocumentedCalls,
    /// **What this agent was granted**, and therefore the whole capability gate.
    ///
    /// Every arm's SDK is static: every function is compiled, linked and callable whatever the run
    /// enabled, so no guest withholds a name and none of them is asked to. What a program gets for
    /// calling something it was not granted is decided here, once, by
    /// [`Grants::permits`](crate::sandbox::Grants::permits) — the same value and the same predicate
    /// the [documentation runtime](crate::docs::DocsRuntime::bound) answers a search with, so the
    /// call a model can *find* and the call the host will *service* are one set.
    ///
    /// It carries all three kinds of gate at once — the capability ids this agent holds, its
    /// [ending role](crate::ending::EndingRole) (or none at all, for an on-use script), and the
    /// operations its own allowlist names — because they are three arms of one question and reading
    /// them separately is how they came to be checked in three different places.
    grants: Grants,
    /// The linear-memory ceiling, and its record of having denied a growth.
    limiter: MemoryLimiter,
    /// The run's wall-clock budget, consulted before every bridged call. `None` for a run with no
    /// deadline at all.
    deadline: Option<Instant>,
    /// When this program began, so [`guest_elapsed`](Self::guest_elapsed) and the store's
    /// epoch-deadline callback can measure how long the guest has been executing. Set here so a
    /// state that never reaches a call still has a sane clock, and moved to the call itself by
    /// [`start_program`](Self::start_program).
    program_started: Instant,
    /// Total wall-clock time the program has spent **parked in bridged tool calls** — dispatch, the
    /// tool's own work, a `shell` build. Excluded from the guest's execution time so that time
    /// waiting on a host call is never charged against the [execution timeout](SandboxLimits::timeout):
    /// a program blocked minutes on a build is not a runaway.
    host_call_time: Duration,
    /// Whether the [execution timeout](SandboxLimits::timeout) stopped the program — set by the
    /// store's epoch-deadline callback when the guest's own execution outran the ceiling, and read
    /// by [`classify`](super::engine::classify) to name the cause, exactly as
    /// [`memory_denied`](Self::memory_denied) names an out-of-memory. A trap carries no code the
    /// callback could set from *inside* the guest, so the host records it here instead.
    timed_out: bool,
    /// Every serviced call, in call order, up to [`MAX_RECORDED_CALLS`](capture::MAX_RECORDED_CALLS).
    calls: Vec<SandboxToolCall>,
    /// How many calls the roster cap discarded. The turn dispatched `calls.len() + this`.
    calls_suppressed: u64,
    /// Where in [`calls`](Self::calls) the most recent record went, so a conversion that discovers
    /// the call failed amends the right entry. `None` when the cap suppressed it.
    last_recorded_call: Option<usize>,
    /// Every call refused before it reached the invoker, up to
    /// [`MAX_RECORDED_REFUSALS`](capture::MAX_RECORDED_REFUSALS).
    refusals: Vec<SandboxRefusal>,
    /// How many refusals the cap discarded, so the feedback can say so rather than lie by omission.
    refusals_suppressed: u64,
    /// The kept `console.*` lines, in order — the **last** ones the program produced. A deque
    /// because the caps evict from the front: see [`feedback::Host::log`].
    logs: VecDeque<String>,
    /// How many lines the caps evicted, so the feedback can say so rather than lie by omission.
    logs_suppressed: u64,
    /// Bytes of log kept so far, against [`MAX_LOG_BYTES`](capture::MAX_LOG_BYTES).
    log_bytes: usize,
    /// The views this program opened, in call order, up to
    /// [`MAX_RECORDED_VIEW_EVENTS`](capture::MAX_RECORDED_VIEW_EVENTS).
    views_opened: Vec<SandboxViewOpened>,
    /// The selectors this program closed, in call order — one entry per `close-view` that actually
    /// closed something.
    views_closed: Vec<String>,
    /// Every view call that was refused: a cap, an unusable selector, or a read that failed. Kept so
    /// the turn's feedback can say the material never reached the window, which is the one thing a
    /// silent refusal could not do.
    view_refusals: Vec<String>,
    /// How many view records the recording cap discarded across the three lists above.
    views_suppressed: u64,
    /// The shim's note that the program deferred work which ran after it ended.
    deferred_note: Option<String>,
    /// Every code module that threw while it was being loaded, as `(binding key, message)`.
    ///
    /// A module is somebody else's code — an authored skill's, or a memory the model wrote turns ago
    /// — so its failure is reported rather than raised, and it belongs in the turn's feedback beside
    /// the refusals rather than as the program's own error.
    module_errors: Vec<(String, String)>,
    /// Whether the program ended with a `return` that carried a value — a value gg discarded. The
    /// value itself never crosses the membrane; only the fact does, so the turn's feedback can point
    /// the model at `console.log`.
    returned_value: bool,
    /// The ending the program declared with one of its [ending calls](crate::ending::EndingRole):
    /// the flag this agent's context holds for the loop to read once the program has ended. `Some`
    /// ends the session.
    ///
    /// It is a **flag**, not a control-flow event: the call sets it and returns, the program carries
    /// on, and a later call replaces the declaration. [`revoke_completion`](Self::revoke_completion)
    /// is the one thing that takes it away.
    completion: Option<ProgramCompletion>,
    /// An ending that was revoked because the program then failed, kept so the turn's feedback can
    /// tell the model its ending was cancelled rather than leave it wondering why the run went on.
    revoked_completion: Option<Ending>,
    /// The throw the shim caught, if the program did not run to its end.
    program_error: Option<ProgramError>,
    /// The program this one handed gg to run in its place with `programs.rerun`, when the
    /// [library](crate::programs) is bound and the program used it.
    ///
    /// A flag in exactly the sense [`completion`](Self::completion) is: the call sets it and
    /// returns, the program runs on, and the loop reads it once the program has ended. The FIRST
    /// hand-over stands (a second is refused at the call), and
    /// [`revoke_completion`](Self::revoke_completion) takes this away alongside an ending, because a
    /// program that did not run to its end did not decide which program should run next either.
    rerun: Option<String>,
    /// Whether a hand-over was revoked because the program then failed, kept for the same reason
    /// [`revoked_completion`](Self::revoked_completion) is: a model whose replacement program simply
    /// never ran, with nothing said about it, would sit waiting for a turn that already happened.
    revoked_rerun: bool,
    /// This program's WASI context — the environment, the clock, the RNG, the network, and the
    /// container's filesystem preopened at `/`.
    ///
    /// gg's own surface is the membrane above; this is the *language's* surface, and a guest gets it
    /// whole so that a program written in the language's ordinary idiom works. See
    /// [`linker`](super::linker) for why it is ambient rather than pinned.
    ///
    /// Built without stdout. gg's telemetry stream is this process's stdout, so a guest write to
    /// fd 1 would corrupt the run's event stream — which is also why the component is baked
    /// `--disable stdio` and `console.*` is rebound to the feedback channel. Do not "fix" the
    /// omission by inheriting stdio.
    wasi: WasiCtx,
    /// The resource table backing the [WASI context](Self::wasi)'s handles — open files, streams,
    /// sockets. Separate from gg's own state because the two vocabularies never meet: nothing in the
    /// membrane hands a guest a WASI resource, and nothing here reads one.
    wasi_table: ResourceTable,
    /// Everything the guest wrote to **stderr**, bounded — see [`GuestStderr`].
    stderr: GuestStderr,
    /// How a frame in what the guest wrote is read back into the text the model wrote, for an arm
    /// whose compiler emits source — see [`ProgramLanguage::locations`].
    locations: Option<Locations>,
    /// The encoded answer [the JVM wire](wire)'s `call` produced and its `take` has not yet handed
    /// over. Empty for every other guest on this membrane, which never imports that interface.
    ///
    /// It is held here for one call's width and no longer: see the `wire` interface's own note for
    /// why a JVM guest cannot be handed an answer in the same call that produced it.
    wire_held: Vec<u8>,
}

/// A bounded, in-memory copy of everything the guest wrote to **standard error**.
///
/// # Why gg keeps it at all
///
/// Because a guest that stops has usually said something first, and until now gg threw it away.
/// Ambient WASI gives every guest a standard error; a language runtime writes its own diagnostics
/// there, and so does a program that reaches for its language's ordinary "write to fd 2". Those
/// bytes are the difference between a model being told what went wrong and a model being told "the
/// sandbox trapped", so the host keeps them and [`classify`](super::engine::classify) puts them in
/// front of the failure it reports.
///
/// It is worth recording what it turned out **not** to cover, because the Swift arm was the reason
/// this was built and is not the thing it saved. At `-Osize` that compiler does not print its
/// runtime failures at all: it replaces the report with a bare `unreachable` and encodes the message
/// in the artifact's debug information instead, which is why gg's engine symbolicates a trap. What
/// this channel carries on that arm is what a program wrote **on purpose**.
///
/// # Why it is not stdout
///
/// Stdout stays closed and must: gg's telemetry stream *is* this process's stdout, so a guest write
/// to fd 1 would corrupt the run's event stream. Stderr has no such conflict — nothing of gg's is on
/// fd 2 — and the two channels mean different things to every runtime that has them, which is why
/// opening one is not an argument for opening the other. A program that wants to *say* something
/// still uses `console.log`; this is where a runtime says something the program did not choose to.
///
/// # Why it never fails a write
///
/// `MemoryOutputPipe`, the obvious answer, **traps** when a write would exceed its capacity, which
/// would turn a chatty guest into a failed turn. This keeps [both ends](Kept) of what was written
/// and drops the middle.
///
/// # Why both ends
///
/// Because the runtimes disagree about which end carries the fault, and a program that writes a
/// great deal before dying loses whichever end is thrown away. Measured on this checkout, through
/// gate G8:
///
/// * Mono writes `System.StackOverflowException` **first** and then a thousand identical frames,
///   52 KB of them. Keeping the last 8 KiB kept a hundred and sixty copies of one frame and evicted
///   the only sentence naming the fault.
/// * A Rust panic and a Swift `fatalError` are the **last** thing on the channel, after whatever
///   the program itself wrote to fd 2 — which on the C#, C++, Swift and Rust arms is the program's
///   own text, since those four leave standard error to the program. Keeping the first 8 KiB would
///   evict the panic.
///
/// So the head and the tail are budgeted separately and what falls between them is deleted. Nothing
/// under [`STDERR_HEAD`] + [`STDERR_TAIL`] is touched at all, which is every guest report that gate
/// measures apart from that one.
#[derive(Clone, Default)]
pub(crate) struct GuestStderr(std::sync::Arc<std::sync::Mutex<Kept>>);

/// How much of the **start** of a guest's stderr the host keeps.
const STDERR_HEAD: usize = 4 * 1024;

/// How much of the **end** of a guest's stderr the host keeps.
///
/// Equal to [`STDERR_HEAD`], because neither end is the more likely to carry the fault: which one
/// does is a property of the runtime that wrote it, and gg reads eleven of them. Together they are
/// large enough that a stack trace or a compiler-style diagnostic survives whole, and small enough
/// that a program looping on a write to fd 2 cannot grow the host's memory.
const STDERR_TAIL: usize = 4 * 1024;

/// What the host is holding of one guest's standard error.
///
/// [`head`](Self::head) fills once and never moves again; everything after it lands in
/// [`tail`](Self::tail), which rolls. [`dropped`](Self::dropped) is what rolled off, and it is what
/// makes this a bound rather than a truncation.
#[derive(Default)]
struct Kept {
    /// The first [`STDERR_HEAD`] bytes written, whatever came after them.
    head: Vec<u8>,
    /// The last [`STDERR_TAIL`] bytes written, of everything past the head.
    tail: Vec<u8>,
    /// How many bytes were written between the two and deleted.
    dropped: usize,
}

impl GuestStderr {
    /// Append `bytes`, filling the head first and rolling the tail after it.
    fn append(&self, bytes: &[u8]) {
        let mut kept = self
            .0
            .lock()
            .expect("the guest stderr buffer is never poisoned");
        let mut bytes = bytes;
        if kept.head.len() < STDERR_HEAD {
            let take = (STDERR_HEAD - kept.head.len()).min(bytes.len());
            kept.head.extend_from_slice(&bytes[..take]);
            bytes = &bytes[take..];
        }
        kept.tail.extend_from_slice(bytes);
        if kept.tail.len() > STDERR_TAIL {
            let excess = kept.tail.len() - STDERR_TAIL;
            kept.tail.drain(..excess);
            kept.dropped += excess;
        }
    }

    /// What the guest wrote, as text, or the empty string when it wrote nothing.
    ///
    /// A guest that wrote no more than [`STDERR_HEAD`] + [`STDERR_TAIL`] bytes reads back exactly
    /// what it wrote, with no line of gg's in it. A guest that wrote more reads back its own head,
    /// [one line counting the deletion](dropped_bytes), and its own tail.
    ///
    /// The count is in **bytes**, which is the unit the eviction above worked in, and it is what
    /// tells a model it is reading a bounded report rather than a whole one. It is the count the
    /// same requirement puts on
    /// [every other trim](https://docs.testcabinet.ai/gg/responses-as-code/invariants/#trimming),
    /// spelt in the unit this one actually counted.
    ///
    /// Both cuts are moved out to a line boundary and the bytes that move with them are added to
    /// the count, because a frame cut in half reads as a frame the runtime wrote that way. A half
    /// of the channel holding no newline at all is kept as it stands: a runtime that wrote four
    /// kilobytes without ending a line has said one thing, and cutting all of it away to reach a
    /// boundary would delete the report to tidy it.
    ///
    /// Lossy, because these are a runtime's own bytes and not something gg chose the encoding of —
    /// and a message a model could have read, dropped because one byte was not UTF-8, would be the
    /// worst possible trade here.
    pub(crate) fn kept(&self) -> String {
        let kept = self
            .0
            .lock()
            .expect("the guest stderr buffer is never poisoned");
        if kept.dropped == 0 {
            let mut whole = kept.head.clone();
            whole.extend_from_slice(&kept.tail);
            return String::from_utf8_lossy(&whole).trim().to_string();
        }
        // The head keeps everything up to and including its last newline; the tail starts after its
        // first one. Either half without a newline is kept whole, and contributes nothing here.
        let head = match kept.head.iter().rposition(|byte| *byte == b'\n') {
            Some(end) => &kept.head[..=end],
            None => &kept.head[..],
        };
        let tail = match kept.tail.iter().position(|byte| *byte == b'\n') {
            Some(start) => &kept.tail[start + 1..],
            None => &kept.tail[..],
        };
        let dropped =
            kept.dropped + (kept.head.len() - head.len()) + (kept.tail.len() - tail.len());
        let mut text = String::from_utf8_lossy(head).into_owned();
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&dropped_bytes(dropped));
        text.push('\n');
        text.push_str(&String::from_utf8_lossy(tail));
        text.trim().to_string()
    }
}

/// The line a model reads in place of what it was not shown.
///
/// Worded after the Python guest's own trim, which counts the characters
/// it deleted off the end of a rendered traceback, because this is the same statement about the same
/// kind of channel and a second phrasing for it would read as a second kind of bound.
fn dropped_bytes(dropped: usize) -> String {
    format!("… {dropped} bytes dropped")
}

impl wasmtime_wasi::cli::IsTerminal for GuestStderr {
    /// Never. A runtime that believed it had a terminal would colour its diagnostics with ANSI
    /// escapes, and the model would be shown the escapes.
    fn is_terminal(&self) -> bool {
        false
    }
}

/// The **synchronous** stream a guest's writes land in.
///
/// It exists rather than being left to [`StdoutStream`](wasmtime_wasi::cli::StdoutStream)'s default
/// implementation, and that default is a trap this cost a debugging session to find: it wraps the
/// `AsyncWrite` below in an `AsyncWriteStream`, which buffers the guest's bytes and flushes them
/// from a background task. gg's sandbox is driven **synchronously** — `add_to_linker_sync`, a
/// blocking task, a store read the instant the program stops — so a guest that wrote its dying
/// message and then trapped had its message still sitting in that buffer when the failure was
/// rendered. It arrived sometimes and not others, which is the worst way for a diagnostic channel
/// to behave.
#[wasmtime_wasi::async_trait]
impl wasmtime_wasi::p2::OutputStream for GuestStderr {
    fn write(&mut self, bytes: bytes::Bytes) -> wasmtime_wasi::p2::StreamResult<()> {
        self.append(&bytes);
        Ok(())
    }

    /// Nothing to do: the write above already landed in the buffer.
    fn flush(&mut self) -> wasmtime_wasi::p2::StreamResult<()> {
        Ok(())
    }

    /// Always writable, and never in a quantity that could refuse a write. What bounds this channel
    /// is [`STDERR_HEAD`] and [`STDERR_TAIL`], which *drop* what fell between them rather than
    /// denying the newest — a guest told its stderr was full is a guest whose runtime may block,
    /// retry or trap on gg's bookkeeping.
    fn check_write(&mut self) -> wasmtime_wasi::p2::StreamResult<usize> {
        Ok(STDERR_HEAD + STDERR_TAIL)
    }
}

#[wasmtime_wasi::async_trait]
impl wasmtime_wasi::p2::Pollable for GuestStderr {
    /// Immediately. There is nothing to wait for: a write is a memcpy into a buffer.
    async fn ready(&mut self) {}
}

impl tokio::io::AsyncWrite for GuestStderr {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
        bytes: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        self.append(bytes);
        std::task::Poll::Ready(Ok(bytes.len()))
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Ok(()))
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        _context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Ok(()))
    }
}

impl wasmtime_wasi::cli::StdoutStream for GuestStderr {
    /// The synchronous stream above, which is what every guest gg drives actually writes through.
    fn p2_stream(&self) -> Box<dyn wasmtime_wasi::p2::OutputStream> {
        Box::new(self.clone())
    }

    /// Required by the trait and unused by this embedding, which links WASI synchronously. It is a
    /// real implementation rather than an `unimplemented!()` so that an async embedding of this
    /// state — a thing gg does not have and might — records the same bytes rather than panicking.
    fn async_stream(&self) -> Box<dyn tokio::io::AsyncWrite + Send + Sync> {
        Box::new(self.clone())
    }
}

/// The WASI half of a program's store.
///
/// Everything the guest's own language runtime reaches for goes through here; everything gg offers
/// goes through the membrane. The two are separate namespaces in the linker and separate state on
/// this struct, so a guest is reached only by the part of this it actually imports — the TypeScript
/// component reads the clock and the RNG through here and never opens a file, while a
/// `componentize-py` guest imports the whole surface and gets all of it.
impl<A: OperationApi> WasiView for MembraneState<A> {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.wasi_table,
        }
    }
}

/// The variable [`wasi_context`] names this run's execution budget in.
///
/// Read today by the ECMAScript guest alone (`packages/gg-sandbox/guest`); a guest that does not
/// read it simply has gg's epoch deadline as its only ceiling, which is what every arm had before it.
pub(crate) const GUEST_DEADLINE: &str = "GG_SANDBOX_DEADLINE_MS";

/// The budget a guest that can stop itself is given: gg's execution ceiling, less the guest's
/// [head start](super::engine::GUEST_HEAD_START).
///
/// Never zero and never longer than gg's own — `saturating_sub` on a ceiling shorter than the head
/// start leaves nothing, and a budget of nothing would interrupt a program before its first
/// statement, so the floor is half the ceiling. A run configured with a ceiling that short has a
/// proportionally thinner margin than the head start asks for, and that is the honest answer: the
/// alternative is a guest told it has more time than gg will give it.
pub(crate) fn guest_deadline(limits: SandboxLimits) -> Duration {
    limits
        .timeout
        .saturating_sub(super::engine::GUEST_HEAD_START)
        .max(limits.timeout / 2)
}

/// The WASI context every program gets: the process's environment, a real clock and RNG, the
/// network, and the filesystem preopened at `/`.
///
/// **Stdout is deliberately absent** — see [`MembraneState::wasi`].
///
/// The environment is inherited because a language runtime needs it to work at all — `HOME`,
/// `PATH`, `TMPDIR`, the locale — and a guest handed an empty one behaves like a guest on a broken
/// machine. The honest consequence is that whatever this process's environment holds, including the
/// run's model credentials, is readable from inside a program. That is the same reach a program
/// already has through the preopened filesystem, and the same reach an agent has through
/// [`shell`](crate::tools) in nearly every configuration.
///
/// The preopen is the one part that can fail, and it fails only if the host cannot open `/` at all.
/// That is not a reason to refuse to run the program: a guest that never touches the filesystem is
/// unaffected, and one that does gets an ordinary WASI error from its own runtime rather than a
/// sandbox that would not start. So the failure is ignored and the context simply has no preopen —
/// which is why [`preopen_root`] is a named function rather than a line here: an ignored failure
/// that is also an *unobserved* one would leave a whole capability quietly missing, so a test calls
/// it and asserts it worked.
fn wasi_context(
    language: &'static dyn ProgramLanguage,
    stderr: GuestStderr,
    limits: SandboxLimits,
) -> WasiCtx {
    let mut builder = WasiCtxBuilder::new();
    builder.inherit_env();
    // **This run's execution budget, in milliseconds**, for the arms whose engine can stop a runaway
    // loop ITSELF, and for no others.
    //
    // gg's own ceiling is the epoch deadline and stays so; what this buys is which of the two speaks
    // first. An epoch trap names nothing a model can act on — the store simply dies — where the
    // ECMAScript guest's engine answers with `InternalError: interrupted` and the JavaScript frames
    // that were executing. That guest subtracts its own parked-in-a-host-call time before deciding,
    // exactly as [`guest_elapsed`](MembraneState::guest_elapsed) does here, so a program sitting in
    // a twenty-minute `shell` build is not mistaken for one that is looping.
    //
    // Written only where it is read, because the same fact decides how a failure at the ceiling is
    // classified: [`spent_its_budget`](super::engine) recognises gg's ceiling from the elapsed time
    // for an arm whose guest stops itself, and that recognition would be a guess on an arm gg stops.
    //
    // An environment variable rather than a WIT parameter because the world is shared with ten
    // sibling guests and adding a parameter reshapes every one of them.
    //
    // ONE EPOCH TICK SHORT of gg's own ceiling, and the subtraction is what makes the whole thing
    // work rather than a rounding nicety. gg's deadline is armed in whole ticks against a
    // free-running counter, so it can be delivered up to a tick EARLY; a guest asked to stop at
    // the same instant therefore loses the race and the model reads an epoch trap after all —
    // measured, on a 250 ms ceiling. A tick is gg's own resolution, so giving it away costs a
    // 30 s budget 0.3% of itself and buys every runaway loop a sentence naming the function.
    if language.stops_itself_at_ggs_deadline() {
        builder.env(
            GUEST_DEADLINE,
            guest_deadline(limits).as_millis().to_string(),
        );
    }
    builder
        .inherit_network()
        .allow_ip_name_lookup(true)
        // Kept rather than inherited: this process's stderr is an operator's log, and a guest
        // runtime's dying message belongs in the model's feedback rather than in it.
        .stderr(stderr);
    // Deliberately ignored; see above.
    let _rooted = preopen_root(&mut builder);
    builder.build()
}

/// Preopen the container's root on `builder`, which is what lets a program reach the workspace
/// through its own language's file APIs rather than only through the [files](crate::tools) tools.
///
/// Separate from [`wasi_context`] so that the one call in the sandbox whose failure is swallowed can
/// still be *exercised*: nothing about a `WasiCtx` is inspectable once built, and no **registered**
/// guest imports `wasi:filesystem`, so without this a preopen that stopped succeeding — or a builder
/// call dropped in a refactor — would go unnoticed until a language months later blamed its own
/// toolchain. It is no longer only a unit test that reaches it: the prebuilt Python guest imports
/// the whole filesystem surface, and its substrate test opens a real file from inside a program.
fn preopen_root(builder: &mut WasiCtxBuilder) -> wasmtime::Result<()> {
    builder.preopened_dir("/", "/", DirPerms::all(), FilePerms::all())?;
    Ok(())
}

/// Everything one program accumulated, reclaimed from the store on the way out.
///
/// A struct rather than a tuple because [`run_program`](super::run_program) destructures it at the
/// single exit point and a seven-field tuple there would be unreadable — and because adding a
/// field to what a program accumulates should not silently re-order what the caller reads.
pub(crate) struct MembraneParts {
    /// Every serviced call the roster kept, in call order.
    pub calls: Vec<SandboxToolCall>,
    /// How many calls the roster cap discarded.
    pub calls_suppressed: u64,
    /// How many **model-facing API calls** the program made — a superset of the dispatched ones by
    /// the carve-outs (a view, an ending, a program-library call, a documentation search) and by the
    /// calls the membrane refused. See [`recording`].
    pub api_calls: u64,
    /// How many of those the model wrote without having read what they do, by operation — see
    /// [`crate::discovery`].
    pub undocumented: GgUndocumentedCalls,
    /// Every refused call the roster kept.
    pub refusals: Vec<SandboxRefusal>,
    /// How many refusals the cap discarded.
    pub refusals_suppressed: u64,
    /// The kept log lines — the last ones the program produced, in order.
    pub logs: Vec<String>,
    /// How many earlier log lines the caps evicted.
    pub logs_suppressed: u64,
    /// The views the program opened, in call order.
    pub views_opened: Vec<SandboxViewOpened>,
    /// The selectors the program closed, in call order.
    pub views_closed: Vec<String>,
    /// Every view call that was refused, in call order.
    pub view_refusals: Vec<String>,
    /// How many view records the recording cap discarded.
    pub views_suppressed: u64,
    /// The deferred-work note, when the shim reported one.
    pub deferred_note: Option<String>,
    /// Every code module that failed to load, as `(binding key, message)`.
    pub module_errors: Vec<(String, String)>,
    /// Whether the program ended by returning a value, which gg discarded.
    pub returned_value: bool,
    /// The ending the program declared, when it declared one and did not lose it.
    pub completion: Option<ProgramCompletion>,
    /// The ending the program lost by failing afterwards.
    pub revoked_completion: Option<Ending>,
    /// The program's uncaught throw, when the shim reported one.
    pub program_error: Option<ProgramError>,
    /// The program this one handed over with `programs.rerun`, when it did and did not then fail.
    pub rerun: Option<String>,
    /// Whether a hand-over was revoked because the program then failed, so the turn's feedback can
    /// say the replacement was not run rather than leave the model waiting for a program that never
    /// ran.
    pub revoked_rerun: bool,
}

impl<A: OperationApi> MembraneState<A> {
    /// The state for one program: bridged through `api`, written in `language`, offering exactly
    /// what `scope` says this program was given, bounded by `limits`, and stopping at `deadline`.
    ///
    /// It takes the whole [`ProgramScope`] rather than the operation names alone because everything in it
    /// is one decision — what this program may reach — and every part of that decision is checked
    /// **here** as well as bound into the guest's scope. Splitting it was how the ending group and
    /// the program-library flag came to be handed to the guest and to nobody else.
    pub(crate) fn new(
        api: A,
        language: &'static dyn ProgramLanguage,
        scope: ProgramScope<'_>,
        limits: SandboxLimits,
        deadline: Option<Instant>,
    ) -> Self {
        let stderr = GuestStderr::default();
        Self {
            api: GuardedApi::new(api),
            language,
            api_calls: 0,
            undocumented: GgUndocumentedCalls::default(),
            grants: scope.grants(),
            limiter: MemoryLimiter::new(limits.max_memory_bytes),
            deadline,
            program_started: Instant::now(),
            host_call_time: Duration::ZERO,
            timed_out: false,
            calls: Vec::new(),
            calls_suppressed: 0,
            last_recorded_call: None,
            refusals: Vec::new(),
            refusals_suppressed: 0,
            logs: VecDeque::new(),
            logs_suppressed: 0,
            log_bytes: 0,
            views_opened: Vec::new(),
            views_closed: Vec::new(),
            view_refusals: Vec::new(),
            views_suppressed: 0,
            deferred_note: None,
            module_errors: Vec::new(),
            returned_value: false,
            completion: None,
            revoked_completion: None,
            program_error: None,
            rerun: None,
            revoked_rerun: false,
            wasi: wasi_context(language, stderr.clone(), limits),
            wasi_table: ResourceTable::new(),
            stderr,
            locations: None,
            wire_held: Vec::new(),
        }
    }

    /// Read every frame the guest reports through `locations` before gg shows it to anyone.
    ///
    /// Set once, by [`evaluate`](super::evaluate), out of the arm's own answer for the texts this
    /// program is made of. It is a builder rather than a sixth constructor parameter because it is
    /// a property of the *prepared* program, which the state's other four arguments know nothing
    /// about.
    pub(crate) fn locating(mut self, locations: Option<Locations>) -> Self {
        self.locations = locations;
        self
    }

    /// The language this program is written in, for the one question
    /// [`classify`](super::engine::classify) has to ask an arm before it renders a failure: whether
    /// this artifact's DWARF names places the model's program has. See
    /// [`ProgramLanguage::wasm_frames_are_located`].
    pub(crate) fn language(&self) -> &'static dyn ProgramLanguage {
        self.language
    }

    /// What the guest wrote to **stderr**, bounded at both ends, or the empty string when it wrote
    /// nothing.
    ///
    /// Read by [`classify`](super::engine::classify) when a program failed, because on a guest
    /// without an exception mechanism this is the only account of the failure that exists. See
    /// [`GuestStderr`].
    /// Frames are read back through this program's own [locations](Self::locating) on the way out,
    /// so what gg reports is what the model wrote rather than what its compiler emitted.
    pub(crate) fn stderr_kept(&self) -> String {
        self.relocated(self.stderr.kept())
    }

    /// `text`, with every frame in it read back through this program's own
    /// [locations](Self::locating), or as it was when this arm has none.
    ///
    /// Applied to everything a guest reports that can carry a frame: what it wrote to standard
    /// error, and the message and location of a throw it reports over `feedback.report-error`. The
    /// ECMAScript guest reports a throw with the engine's own stack in the message, stated against
    /// `program.js`; read here, a frame in it names `program.ts` at the model's own line, exactly
    /// as the same frame would on the stderr path.
    pub(crate) fn relocated(&self, text: String) -> String {
        match &self.locations {
            Some(locations) => locations.rewrite(&text),
            None => text,
        }
    }

    /// Put `text` on the guest's stderr, exactly as a language runtime writing to fd 2 does.
    ///
    /// The seam [`classify`](super::engine::classify)'s own tests drive: what they are asserting is
    /// that a guest which spoke on its way down is heard on **every** classification path, and the
    /// alternative way to arm that is to compile an arm's toolchain and provoke a real runtime
    /// failure — which is a per-arm substrate test costing seconds, not a property of the classifier.
    ///
    /// `#[cfg(test)]` because production writes here only through the WASI stream: a host-side
    /// caller that could invent a guest's diagnostics is exactly what this channel must not have.
    #[cfg(test)]
    pub(crate) fn note_stderr(&self, text: &str) {
        self.stderr.append(text.as_bytes());
    }

    /// The memory limiter, for [`Store::limiter`](wasmtime::Store::limiter) to consult before each
    /// `memory.grow`.
    pub(crate) fn limiter(&mut self) -> &mut MemoryLimiter {
        &mut self.limiter
    }

    /// Whether the memory cap denied a growth — the evidence
    /// [`classify`](super::engine::classify) reads to name the cause of a failure that a component,
    /// having no single named memory, cannot otherwise be asked about.
    pub(crate) fn memory_denied(&self) -> bool {
        self.limiter.denied()
    }

    /// How long the guest has been executing on its **own** account: the wall clock since the
    /// program began, minus every stretch it spent parked in a bridged tool call. This is the
    /// quantity the [execution timeout](SandboxLimits::timeout) bounds, and the figure a run reports
    /// as its program's cost.
    pub(crate) fn guest_elapsed(&self) -> Duration {
        self.program_started
            .elapsed()
            .saturating_sub(self.host_call_time)
    }

    /// **Start the program's clock**, called immediately before the guest's `run` export is invoked.
    ///
    /// Everything between this state being built and that call is gg's own work — building the
    /// store, and instantiating the component, which for the ECMAScript guest is where its ~10 MiB
    /// engine heap is allocated. Charging that to the program is wrong twice over. It inflates the
    /// [cost](super::SandboxOutcome::elapsed) a turn reports for a program that had not run a statement,
    /// and — the reason this exists — it is subtracted from the
    /// [head start](super::engine::GUEST_HEAD_START) that lets a guest which can stop itself answer
    /// a runaway loop before gg's ceiling does. An instantiate that stretched under load used to eat
    /// that whole margin, and the model read an epoch trap naming nothing instead of its own
    /// engine's `InternalError: interrupted`.
    ///
    /// Nothing unbounded escapes the ceiling by moving it: instantiation is fixed work on gg's own
    /// artifact, the memory cap is armed on the store before it and still denies a guest its heap
    /// there, and the run's own wall-clock [deadline](Self::deadline) bounds the whole turn either
    /// way.
    ///
    /// **A caller that builds a store by hand must call this too** — every test helper that copies
    /// [`evaluate`](super::evaluate) does, for the same reason production does.
    pub(crate) fn start_program(&mut self) {
        self.program_started = Instant::now();
    }

    /// Record that a bridged call parked the guest for `elapsed`, so that time is excluded from
    /// [`guest_elapsed`](Self::guest_elapsed) and never counts against the execution timeout.
    fn charge_host_time(&mut self, elapsed: Duration) {
        self.host_call_time = self.host_call_time.saturating_add(elapsed);
    }

    /// Whether the [execution timeout](SandboxLimits::timeout) stopped the guest — the flag the
    /// epoch-deadline callback sets and [`classify`](super::engine::classify) reads.
    pub(crate) fn timed_out(&self) -> bool {
        self.timed_out
    }

    /// Whether the program **said why it failed** before it stopped running.
    ///
    /// Read by [`keep_reported_error`](super::keep_reported_error) after a trap, and only there. A
    /// guest that catches its own throw reports the failure and then returns normally, so for every
    /// arm with an exception mechanism this is never consulted; a guest that reports a failure and
    /// is then killed by its own runtime reaches the host with the failure recorded and the store
    /// trapped, and the recorded failure is the better of the two things gg could tell the model.
    pub(crate) fn reported_error(&self) -> bool {
        self.program_error.is_some()
    }

    /// Record that the guest outran its execution timeout, for [`classify`](super::engine::classify)
    /// to read after the resulting trap unwinds. Called from the store's epoch-deadline callback.
    pub(crate) fn mark_timed_out(&mut self) {
        self.timed_out = true;
    }

    /// The reclaimed [operation api](OperationApi) and everything the program accumulated, consuming the
    /// state. The api is handed back so the loop reclaims the per-turn state it moved in (the
    /// context window, the skills/docs runtimes, the delegation context).
    pub(crate) fn api_and_parts(self) -> (A, MembraneParts) {
        let parts = MembraneParts {
            calls: self.calls,
            calls_suppressed: self.calls_suppressed,
            api_calls: self.api_calls,
            undocumented: self.undocumented,
            refusals: self.refusals,
            refusals_suppressed: self.refusals_suppressed,
            logs: self.logs.into(),
            logs_suppressed: self.logs_suppressed,
            views_opened: self.views_opened,
            views_closed: self.views_closed,
            view_refusals: self.view_refusals,
            views_suppressed: self.views_suppressed,
            deferred_note: self.deferred_note,
            module_errors: self.module_errors,
            returned_value: self.returned_value,
            completion: self.completion,
            revoked_completion: self.revoked_completion,
            program_error: self.program_error,
            rerun: self.rerun,
            revoked_rerun: self.revoked_rerun,
        };
        (self.api.into_inner(), parts)
    }

    /// Everything the program accumulated, discarding the reclaimed api — the shape the membrane's
    /// own unit tests read, which never need the api back.
    #[cfg(test)]
    pub(crate) fn into_parts(self) -> MembraneParts {
        self.api_and_parts().1
    }

    /// Take back a completion the program declared, because the program then failed.
    ///
    /// The two callers are the two ways a program can fail after `finish` returned: the shim's
    /// single `catch` ([`feedback::Host::report_error`](capture)) for a throw, and
    /// [`run_program`](super::run_program) for a sandbox ceiling that stopped the guest outright.
    /// Both mean the same thing — the program did not run the checks its summary claims to rest on —
    /// and the answer to both is another turn rather than an ending gg cannot vouch for.
    ///
    /// The ending is kept in [`revoked_completion`](Self::revoked_completion) rather than dropped:
    /// a model whose ending vanished with no explanation would simply write it again.
    pub(crate) fn revoke_completion(&mut self) {
        if let Some(completion) = self.completion.take() {
            self.revoked_completion = Some(completion.ending);
        }
        // A hand-over is revoked on exactly the same evidence and for the same reason: the program
        // that chose which program should run next did not run to its end, so what it chose rests on
        // checks that never finished. Running it anyway would compound one failed program with a
        // second the model no longer has a reason to want.
        if self.rerun.take().is_some() {
            self.revoked_rerun = true;
        }
    }

    /// Bridge one typed membrane call to gg's real toolset, turning a failed outcome into the typed
    /// error the program sees thrown.
    ///
    /// This is what twenty-seven of the twenty-eight bound operations call. The twenty-eighth is
    /// `shell`, which needs a non-`ok` outcome as a value — see [`call_raw`](Self::call_raw).
    ///
    /// The [`Recording`] is the caller's proof that the API call it is servicing has already been
    /// recorded under its own identity, and `id` is that identity said again for the dispatch —
    /// the same [operation](OperationId) the bracket was opened with, because that is the call the
    /// model wrote. What runs underneath may be shared: `files.read_file` and `views.open_file`
    /// are two operations over one internal read, and each is recorded, refused and reported as
    /// itself.
    fn call(
        &mut self,
        recording: Recording,
        id: OperationId,
        run: impl FnOnce(&mut A) -> ToolOutcome,
    ) -> Result<ToolOutcome, ApiError> {
        // For every call but `shell`, the internal call's verdict and the model-facing call's are
        // the same thing.
        let outcome = self.dispatch(recording, id, run, |outcome| outcome.ok)?;
        if outcome.ok {
            Ok(outcome)
        } else {
            Err(self.api_error(id, &outcome))
        }
    }

    /// As [`call`](Self::call), but a non-`ok` outcome is returned as a **value** rather than as an
    /// error.
    ///
    /// `shell` is the only caller: a process that ran is a success of the call whatever it exited
    /// with, and throwing on a non-zero exit would make `shell("npm test")` unusable inside an
    /// expression — which is the single most common thing a program does. The presence of a
    /// [`ApiData::Shell`] sidecar is what distinguishes "it ran and exited non-zero" from "it
    /// could not be launched, or the timeout killed it", and it is therefore also what the roster
    /// records: a completed process is a **successful call**, summarised as `exited 1`, not a
    /// failure carrying the command's whole output as its message.
    fn call_raw(
        &mut self,
        recording: Recording,
        id: OperationId,
        run: impl FnOnce(&mut A) -> ToolOutcome,
    ) -> Result<ToolOutcome, ApiError> {
        self.dispatch(recording, id, run, |outcome| {
            matches!(outcome.data, Some(ApiData::Shell(_)))
        })
    }

    /// Set this agent's ending flag: the program's declaration that its session is over.
    ///
    /// It bypasses [`dispatch`](Self::dispatch) entirely, and that function's one remaining guard
    /// is wrong here: the deadline would withhold the exit at exactly the moment a run most needs
    /// it. Ending performs no work, so there is nothing for a spent budget to protect.
    ///
    /// # It has no guard of its own, and that is the point
    ///
    /// **Which endings this program may declare was already checked**, by the
    /// [bracket](recording) this call is inside: an ending operation is
    /// [bound by a role](crate::sandbox::Binding::Ending), so a reviewer that called `finish` was
    /// refused before this ran. That ordering is what a role check has to have — a well-formed
    /// `approve` from an agent that may not approve must be `unavailable` rather than accepted on
    /// its way past an `invalid-argument` that never fires — and putting the check in the bracket
    /// is what gives it to every gate at once instead of to this one call.
    ///
    /// **It is a flag, and setting it is all this does.** The call returns, the program runs on, and
    /// the [loop](crate::agent) reads the flag once the program has ended. That is the whole of the
    /// mechanism: no unwind, no exception a program could catch or fail to catch, and therefore no
    /// question about what a `try`/`catch` around the work does to the session's ending.
    ///
    /// **Last call wins**, and the replacements are counted in
    /// [`ProgramCompletion::superseded`]. With no unwind, calling one twice is an ordinary thing for
    /// a program to do — an ending on two branches that both run, one inside a loop — and the later
    /// declaration is the one made with more of the program's work behind it. The count is kept
    /// because a program that declared its session over several times in several different words is
    /// worth a line on the operator's stream.
    ///
    /// Whether the declaration is **well-formed** — a non-empty summary, a non-empty change list, an
    /// in-range attempt — is [`Ending`]'s question, asked at this trust boundary rather than in the
    /// guest, because these values become the agent's whole answer to whoever asked for the work.
    fn declare(
        &mut self,
        _recording: Recording,
        ending: Result<Ending, String>,
        id: OperationId,
    ) -> Result<(), ApiError> {
        let ending = ending.map_err(|message| ApiError {
            code: ErrorCode::InvalidArgument,
            operation: id.key.to_string(),
            message,
        })?;
        let superseded = match self.completion.take() {
            Some(previous) => previous.superseded.saturating_add(1),
            None => 0,
        };
        self.completion = Some(ProgramCompletion { ending, superseded });
        Ok(())
    }

    /// Bridge one call to the invoker, guarded and recorded.
    ///
    /// The order here is the design, and every guarantee the membrane makes lives in it: the
    /// deadline first (a spent budget refuses everything, including a call that would otherwise be
    /// free), then the call, then the collection of whatever it produced.
    ///
    /// **There is no capability check here any more.** There used to be one — the enabled-set
    /// backstop behind a guest that could withhold a name — and it was a second reading of a
    /// question [`recorded`](recording) now answers for *every* model-facing call, tool or not,
    /// before the body it wraps ever runs. Two readings would be two chances to disagree, and this
    /// one had the worse message of the pair: it refused with **gg's** tool name (`read_file`),
    /// which is a word no model can type in any arm.
    ///
    /// There is deliberately **no** guard on this agent's completion flag. `finish` sets a flag and
    /// the program runs on, so work after it is ordinary work — a last `writeFile`, a tidying pass,
    /// a check whose result the model wanted logged — and refusing it would turn a shape gg told the
    /// model was harmless into a failed turn. The flag decides what happens when the program *ends*;
    /// it is not a gate on what the program may still do.
    ///
    /// `completed` is what the roster records as this call's verdict, and it is a parameter rather
    /// than `outcome.ok` because the two differ for exactly one tool — see
    /// [`call_raw`](Self::call_raw). A verdict that is only knowable *after* the outcome has been
    /// converted is settled by [`amend_last_call_as_failed`](Self::amend_last_call_as_failed)
    /// instead.
    fn dispatch(
        &mut self,
        recording: Recording,
        id: OperationId,
        run: impl FnOnce(&mut A) -> ToolOutcome,
        completed: fn(&ToolOutcome) -> bool,
    ) -> Result<ToolOutcome, ApiError> {
        if self.deadline_spent() {
            return Err(self.refuse(
                id,
                ErrorCode::LimitExceeded,
                "the run's wall-clock budget is spent",
            ));
        }

        // Time spent inside the tool is the guest parked, not the guest running, so it is excluded
        // from the execution timeout: a program blocked on a long `shell` build is not a runaway.
        let started = Instant::now();
        let mut outcome = run(self.api(recording));
        self.charge_host_time(started.elapsed());
        // One channel: a picture enters the window through a view or not at all, so a bare read's
        // picture is dropped here and its description corrected to say so.
        capture::withhold_pictures(&mut outcome, self.language);
        let completed = completed(&outcome);
        self.record(id, &outcome, completed);
        Ok(outcome)
    }

    /// How this program's [language](ProgramLanguage) spells the operation `id` — the qualified name
    /// any sentence put in front of the model quotes back.
    fn spelled(&self, id: OperationId) -> String {
        spell(self.language, id)
    }

    /// **The capability gate.** Whether this agent may make the call `id` names, and — when it may
    /// not — the sentence that says so.
    ///
    /// This is the whole of gg's enforcement, and it is one call to
    /// [`Grants::permits`](crate::sandbox::Grants::permits). Every arm's SDK is static, so a
    /// program can *write* any call the language will compile; whether it *happens* is decided
    /// here, at the boundary, from the same grant the
    /// [documentation runtime](crate::docs::DocsRuntime::bound) filters a search with. There is no
    /// second reading anywhere — not in a guest that leaves a name out of scope, not in a
    /// per-family helper, and not in [`dispatch`](Self::dispatch).
    ///
    /// It is called from inside the call's own [bracket](recording), never before it, so a refused
    /// call is still an API call the model made and is still counted as a failed one. That count is
    /// the point: "the model reached for something this agent was not granted" is precisely what a
    /// reader comparing two configurations is looking for, and a refusal that closed no bracket
    /// would be invisible to it.
    ///
    /// An id with no row is **serviced**, and that is the safe direction rather than an oversight:
    /// it means gg's own table has fallen behind a host function, and refusing every call gg has
    /// mislaid would take a run down over drift.
    ///
    /// # Why `operation` is gg's name and the message is the language's
    ///
    /// [`ApiError::operation`] is an **identity**: the thing that failed, in gg's own vocabulary, so a
    /// catch site can report it without parsing prose. The `message` is an **instruction**, and an
    /// instruction naming a call has to name it the way this program would write it, so it
    /// [spells](spell) every call it quotes. The two fields differ on purpose; they are not two
    /// attempts at the same thing.
    ///
    /// The class is [`Unavailable`](ErrorCode::Unavailable) in every case, which is what the host
    /// reads back as [`UnknownName`](super::ProgramErrorKind::UnknownName) when the throw is not
    /// caught — the same class, and the same recovery, a guest that could leave the name out of
    /// scope used to produce.
    ///
    /// # Which record a cross-arm count must join on
    ///
    /// **The refusal roster, not the turn's error type.** The line above holds only for a guest
    /// that hands the failure's code up with the throw — Python, Ruby, C++, C# and the three
    /// ECMAScript-engine arms — and the other four do not. Measured: Swift's top-level code is not
    /// a `throws` context its shell can wrap, so an uncaught gg failure is not a program error at
    /// all but a trapped store, and Rust, Kotlin and Java die the same way. Counting
    /// `program_unknown_name` across arms therefore reads correct on seven and silently wrong on
    /// the other four.
    ///
    /// What **is** uniform on all eleven is [`record_refusal`](Self::record_refusal) just below:
    /// every refusal is opened and closed as an API call and lands on the turn's roster under gg's
    /// own [operation id](OperationId), caught or uncaught, whatever the guest made of the throw.
    /// That is the record a comparison of two configurations joins on, and
    /// `/gg/languages/static-sdks/` tells an operator the same thing.
    fn granted(&mut self, id: OperationId) -> Result<(), ApiError> {
        let Some(operation) = operation(id) else {
            return Ok(());
        };
        if self.grants.permits(operation) {
            return Ok(());
        }
        // Three different names for one call, and each is the only one right where it goes. The
        // model is quoted the call in the language it is writing, because a refusal it can act on
        // names something it could type. The roster is keyed on gg's own operation id, because a
        // cross-arm readout joins on an identity no arm chose. And the error carries the bare key,
        // because a catch site branches on the thing that failed rather than on prose.
        let message = self.withheld(&self.spelled(id), operation.binding);
        self.record_refusal(id, &message);
        Err(ApiError {
            code: ErrorCode::Unavailable,
            operation: id.key.to_string(),
            message,
        })
    }

    /// Why `spelled` is withheld from this agent — the sentence a [refusal](Self::granted) carries.
    ///
    /// It says that the call is not available and, where there is one, which call to make **instead**.
    /// It deliberately does not say what would unlock it. Naming the capability or the allowlist
    /// entry that is missing tells the model about gg's configuration surface, which is the one thing
    /// in its situation it cannot change: the profile was fixed before the session began and no
    /// program can edit it, so the sentence would be an explanation the model can only read and not
    /// act on — and an invitation to spend a turn trying.
    ///
    /// An alternative is different, and is the one thing worth saying. A reviewer that reached for
    /// `finish` has two calls that *do* end its session, so it is told which; there is no equivalent
    /// for a workspace call this agent was not granted, and inventing one would be gg guessing.
    ///
    /// The call is [spelled](spell) in the program's own language, because the sentence is put in
    /// front of a model and a model reads a name it could write. gg's own vocabulary is what the
    /// error's [`ApiError::operation`] carries instead — an identity for a catch site, not an
    /// instruction.
    fn withheld(&self, spelled: &str, binding: Binding) -> String {
        match binding {
            Binding::Ending(_) => self.wrong_ending(spelled),
            // `Always` is unreachable: `permits` answers `true` for every agent, so nothing that is
            // always bound ever reaches a refusal. It shares the capability arm's sentence rather
            // than being an `unreachable!()` because a membrane that panicked would take the store
            // down and tell the model nothing at all, which is the one failure this whole boundary
            // exists to prevent.
            // A [positional](Binding::Machine) refusal is the same sentence for the same reason,
            // and here the reason is not even about configuration: an agent standing outside a
            // machine — or in a terminal state — has nothing it could do to acquire the transition,
            // so there is no alternative to name and nothing to explain.
            Binding::Capability(_) | Binding::Machine | Binding::Always => {
                format!("`{spelled}` is not available.")
            }
        }
    }

    /// Why an **ending** call is withheld, said in terms of what this program *was* dispatched to
    /// do.
    ///
    /// It names the endings the program does have rather than only the one it does not: an agent
    /// that reached for the wrong ending has a right one, and being told which is the difference
    /// between a turn it recovers from and a turn it spends guessing. An on-use script has no right
    /// one — it is not a turn, so no ending belongs to it — and is told only that the call is not
    /// available, which is the whole of what is true.
    ///
    /// Every call it names is [spelled](spell) for the reason the withheld call itself is: naming
    /// one is an **instruction** — "use this instead" — and an instruction written in gg's own
    /// `snake_case` vocabulary would tell the model to make a call its SDK does not spell that way.
    fn wrong_ending(&self, spelled: &str) -> String {
        match self.grants.ending() {
            Some(EndingRole::Standard) => {
                let finish = self.spelled(SESSION_FINISH);
                format!("`{spelled}` is not available. Use `{finish}` instead.")
            }
            Some(EndingRole::Review) => {
                let approve = self.spelled(SESSION_APPROVE);
                let request_changes = self.spelled(SESSION_REQUEST_CHANGES);
                format!(
                    "`{spelled}` is not available. Use `{approve}` or `{request_changes}` instead."
                )
            }
            None => format!("`{spelled}` is not available."),
        }
    }

    /// Record a refusal and render it as the error the program will see thrown.
    ///
    /// The roster is keyed on the rendered [operation id](OperationId) and the error carries the
    /// bare key, exactly as [`granted`](Self::granted)'s refusals are: a cross-arm readout joins on
    /// an identity no arm chose, and a `catch` site branches on the call that failed.
    fn refuse(&mut self, id: OperationId, code: ErrorCode, message: impl Into<String>) -> ApiError {
        let message = message.into();
        self.record_refusal(id, &message);
        ApiError {
            code,
            operation: id.key.to_string(),
            message,
        }
    }

    /// Whether the run's wall-clock budget is spent.
    fn deadline_spent(&self) -> bool {
        self.deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    /// How much of the run's wall-clock budget is left, for clamping a `shell` timeout. `None` when
    /// the run has no deadline — in which case gg's own absolute ceiling is the only bound left, and
    /// the clamp still applies it.
    fn remaining_budget(&self) -> Option<Duration> {
        self.deadline
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
    }

    /// The typed error a failed outcome becomes, classified by the failure the internal call
    /// reported rather than by matching on its prose.
    ///
    /// [`ApiError::operation`] carries the **operation's key**, never the name of whatever ran
    /// underneath. The field's name belongs to the failure type every call shares; what goes in it
    /// is the call the program wrote, so `gg.views.openFile` reports `open_file` even though the
    /// read underneath it is the one `files.read_file` performs. Reporting the internal name would
    /// put a word in front of the model that its SDK does not spell and that no arm can type.
    fn api_error(&self, id: OperationId, outcome: &ToolOutcome) -> ApiError {
        ApiError {
            code: error_code(outcome.failure),
            operation: id.key.to_string(),
            // The model-facing text, which for a failure is both the outcome's `output` and its
            // telemetry summary — the same sentence the native tool-calling path would show.
            message: outcome.output.clone(),
        }
    }

    /// The error a successful call with no [structured sidecar](ApiData) becomes, with the call's
    /// own record corrected to say it failed.
    ///
    /// Unreachable in a correct build — every tool a typed membrane function reads data from emits
    /// it, and the tool suite asserts so per tool — which is exactly why it must not invent a value
    /// here. A program handed a fabricated empty result would branch on it and be wrong; a program
    /// told `io-error` naming the tool reports something a developer can fix.
    ///
    /// The record is amended rather than left alone because the call *was* dispatched and *was*
    /// recorded a moment ago, as a success: without this the roster the model reads next turn would
    /// say the call succeeded while the program was thrown into, which is the one thing worse than
    /// either message on its own.
    fn missing_data(&mut self, id: OperationId, produced: Option<&ApiData>) -> ApiError {
        let produced = match produced {
            Some(data) => format!(" (it produced a `{}` payload instead)", data_kind(data)),
            None => String::new(),
        };
        // Spelled for the message and keyed for the field, on the split every model-facing failure
        // here makes: the sentence is read by a model and names something it could have typed, and
        // the field is read by a `catch` and names the call in gg's own vocabulary.
        let spelled = self.spelled(id);
        let message =
            format!("`{spelled}` produced no structured result{produced}; this is a gg defect");
        self.amend_last_call_as_failed(&message);
        ApiError {
            code: ErrorCode::IoError,
            operation: id.key.to_string(),
            message,
        }
    }
}

pub(super) fn wire_failure(code: ErrorCode) -> GgCallFailure {
    match code {
        ErrorCode::InvalidArgument => GgCallFailure::InvalidArgument,
        ErrorCode::NotFound => GgCallFailure::NotFound,
        ErrorCode::Conflict => GgCallFailure::Conflict,
        ErrorCode::Refused => GgCallFailure::Refused,
        ErrorCode::Unavailable => GgCallFailure::Unavailable,
        ErrorCode::LimitExceeded => GgCallFailure::LimitExceeded,
        ErrorCode::IoError => GgCallFailure::IoError,
        ErrorCode::Other => GgCallFailure::Other,
    }
}

/// A tool's own failure classification as the membrane's `error-code`, which is also how the
/// contract publishes it on an [`ApiResult`](test_cabinet_core::gg::GgTelemetryKind::ApiResult).
///
/// The two enums are one-to-one, and the conversion is written out by hand rather than derived: the
/// WIT enum is the guest's vocabulary and the contract's is a published wire value, and a `From`
/// that made them interchangeable would let a change to either travel silently to the other. It is
/// taken from the `ApiError` the program was actually thrown, rather than from the outcome behind
/// it, so a refusal — which has no outcome at all — is classified by the same function as everything
/// else.
///
/// An **unclassified** failure becomes `other`, which is honest: it is raised outside a tool
/// implementation (the loop's own refusals and degradation paths), where there is no tool
/// vocabulary to draw a class from, and inventing one would tell a program something untrue.
fn error_code(failure: Option<ToolFailure>) -> ErrorCode {
    match failure {
        Some(ToolFailure::InvalidArgument) => ErrorCode::InvalidArgument,
        Some(ToolFailure::NotFound) => ErrorCode::NotFound,
        Some(ToolFailure::Conflict) => ErrorCode::Conflict,
        Some(ToolFailure::Refused) => ErrorCode::Refused,
        Some(ToolFailure::Unavailable) => ErrorCode::Unavailable,
        Some(ToolFailure::LimitExceeded) => ErrorCode::LimitExceeded,
        Some(ToolFailure::IoError) => ErrorCode::IoError,
        None => ErrorCode::Other,
    }
}

/// The name of a sidecar's variant, for [`MembraneState::missing_data`]'s diagnostic.
///
/// Exhaustive on purpose: a new [`ApiData`] variant has to be named here, which is a two-second
/// edit that keeps the one message a developer will read while debugging drift accurate.
fn data_kind(data: &ApiData) -> &'static str {
    match data {
        ApiData::Shell(_) => "shell",
        ApiData::FileText(_) => "fileText",
        ApiData::FileImage(_) => "fileImage",
        ApiData::BytesWritten(_) => "bytesWritten",
        ApiData::DirEntries(_) => "dirEntries",
        ApiData::SearchMatches(_) => "searchMatches",
        ApiData::MemoryUsage(_) => "memoryUsage",
        ApiData::MemoryHits(_) => "memoryHits",
        ApiData::TaskUsage(_) => "taskUsage",
        ApiData::BoardUsage(_) => "boardUsage",
        ApiData::BoardNode(_) => "boardNode",
        ApiData::Reclaim(_) => "reclaim",
        ApiData::ArchiveSearch(_) => "archiveSearch",
        ApiData::SubagentSpawned(_) => "subagentSpawned",
        ApiData::SubagentResults(_) => "subagentResults",
    }
}

/// The empty trait the shared `types` interface generates. It declares no functions — it exists so
/// that one `api-error` crosses the whole membrane rather than one per family — but the world
/// still requires an implementation.
impl<A: OperationApi> types::Host for MembraneState<A> {}

#[cfg(test)]
#[path = "membrane.test.rs"]
mod tests;

#[cfg(test)]
#[path = "membrane.stderr.test.rs"]
mod stderr_tests;
