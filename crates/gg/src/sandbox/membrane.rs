//! The membrane: the trust boundary, generated from `crates/gg/wit/gg-sandbox.wit`, and the one
//! helper every host function on it goes through.
//!
//! [`bindgen!`](wasmtime::component::bindgen) turns the WIT into one `Host` trait per interface,
//! and this module (with its five submodules) implements every one of them for [`MembraneState`].
//! That is what makes the boundary typed end to end: a program calls `readFile(path, { limit })`,
//! the guest lowers it into a WIT call with typed parameters, and the host receives
//! `read_file(path: String, offset: Option<u32>, limit: Option<u32>)`. Nothing on the model-facing
//! side dispatches a tool by name with a bag of JSON — that shape exists only *below* this module,
//! between [`MembraneState::call`] and [`ToolRegistry::dispatch`](crate::tools::ToolRegistry), where
//! it costs the model nothing — and the compiler, not a test, is what guarantees a WIT function
//! cannot exist without a host implementation.
//!
//! # Two helpers, so the guarantees exist once
//!
//! **Every** host function on this membrane — all forty-eight of them, dispatching or not — opens
//! an API-call bracket with [`MembraneState::recorded`], which is what records the call the *model
//! wrote* under its own identity and is the only source of the [`Recording`](recording) token
//! without which a host function can reach neither the [api](ToolApi) nor the dispatch path. See
//! [`recording`] for why the API record and the tool record are separate things.
//!
//! Inside that bracket, every host function that dispatches anything funnels through
//! [`MembraneState::call`] (or its one sibling [`call_raw`](MembraneState::call_raw)) — all 29 bound
//! tools. That is where the run's wall-clock deadline is honoured, where a tool this run does not
//! offer is refused, where the ordered call record is kept, where pictures are collected, and where
//! a failed [`ToolOutcome`] becomes a typed `tool-error`. A host function itself is three lines:
//! build the JSON its tool's schema already declares, call, and convert the
//! [structured sidecar](crate::tools::ToolData) into its typed WIT result.
//!
//! A handful of functions dispatch nothing and so reach neither. The three
//! [session-ending calls](session) — the model-facing functions on this membrane that are not gg
//! tools — set this agent's ending flag through [`MembraneState::declare`], because ending a session
//! is the one thing a program may ask for that no capability governs and no spent budget may
//! withhold. The [documentation directory](docs), the [program library](programs) and four of the
//! five [view calls](views) go straight to the [api](ToolApi) for the same reason: both of
//! `dispatch`'s guards are wrong for a call that is not a tool, and a program that cannot show
//! itself what it computed has nothing to report at all. The fifth view call, `open-file-view`,
//! **is** a bridged `read_file` and goes through `dispatch` like any other read — while still being
//! recorded as `view.open_file`, because that is what the model wrote.
//!
//! # The state is the agent's, not the program's
//!
//! [`MembraneState`] is where a program's calls are aimed: it carries the invoker that reaches *this
//! agent's* loop, the tools *this run* offers, and the flag that says whether *this agent* has
//! declared itself done. Nothing about ending a run lives in the guest, which is why `finish` needs
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

use std::collections::{BTreeSet, VecDeque};
use std::time::{Duration, Instant};

use test_cabinet_core::gg::GgToolFailure;
use wasmtime::component::ResourceTable;
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

use super::invoker::{SandboxRefusal, SandboxToolCall, SandboxViewOpened, ToolApi};
use super::language::{
    HARNESS_FINISH, ProgramLanguage, REVIEW_APPROVE, REVIEW_REQUEST_CHANGES, SurfaceCall, spell,
};
use super::limits::{MemoryLimiter, SandboxLimits};
use super::{ProgramCompletion, ProgramError, ProgramErrorKind, ProgramScope};
use crate::ending::{Ending, EndingRole};
use crate::tools::{ToolData, ToolFailure, ToolOutcome};

mod capture;
mod context;
mod delegation;
mod docs;
mod knowledge;
mod programs;
mod recording;
mod session;
mod views;
mod workspace;

use docs::DOCS_OBJECT;
use recording::{GuardedApi, Recording};

wasmtime::component::bindgen!({ world: "sandbox", path: "wit" });

use test_cabinet::gg::feedback;
use test_cabinet::gg::types::{self, ErrorCode, ToolError};

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
    /// Whether `call` — an ending call's own name, `finish` / `approve` / `request_changes` — is one
    /// this program may make.
    fn permits(self, call: &str) -> bool {
        match self {
            Self::Role(role) => role.owns(call),
            Self::None => false,
        }
    }

    /// Why `call` is withheld, said in terms of what this program *was* dispatched to do.
    ///
    /// It names the endings the program does have rather than only the one it does not: an agent
    /// that reached for the wrong ending has a right one, and being told which is the difference
    /// between a turn it recovers from and a turn it spends guessing.
    ///
    /// Every call it names is [spelled](spell) in `language`, because naming one is an
    /// **instruction** — "call this instead" — and an instruction written in gg's own `snake_case`
    /// vocabulary would tell the model to make a call its SDK does not bind. gg's vocabulary and a
    /// language's spelling coincide today only because there is one language; they are guaranteed
    /// to diverge as soon as there is a second.
    fn withheld(self, language: &'static dyn ProgramLanguage, call: SurfaceCall) -> String {
        let call = spell(language, call);
        match self {
            Self::Role(EndingRole::Standard) => {
                let finish = spell(language, HARNESS_FINISH);
                format!(
                    "`{call}` is not available to you: you were dispatched to do work, not to \
                     review it. Report what you did with `{finish}` instead."
                )
            }
            Self::Role(EndingRole::Review) => {
                let approve = spell(language, REVIEW_APPROVE);
                let request_changes = spell(language, REVIEW_REQUEST_CHANGES);
                format!(
                    "`{call}` is not available to you: you were dispatched to review work, so your \
                     session ends with a verdict — `{approve}`, or `{request_changes}` naming every \
                     change the work needs."
                )
            }
            Self::None => format!(
                "`{call}` is not available here: this code is a skill or a memory being loaded \
                 rather than your own turn, so it cannot end your session."
            ),
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

/// The per-[`Store`](wasmtime::Store) host state: the tool bridge, the memory limiter, the run's
/// wall-clock deadline, and everything the program accumulated on its way to a result.
///
/// It owns its invoker (rather than borrowing one) so the store's data is `'static` with no
/// lifetime erasure and no `unsafe`, and it is reclaimed whole by
/// `into_parts` on **every** exit path — including a trap — because the calls a
/// program landed before it was stopped are exactly what the model needs to see next turn.
pub(crate) struct MembraneState<A: ToolApi> {
    /// The native, typed tool surface a bridged call is aimed at: the loop's own state in
    /// production ([`LoopToolApi`](crate::agent)), an in-memory fake under test.
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
    /// The gg tools this run offers. A guest that builds a scope binds only these into it, which
    /// makes the check below a backstop; a guest that links its SDK as an ordinary library binds
    /// every name it has, and there the check is the gate.
    enabled: BTreeSet<String>,
    /// Which [ending calls](RunEnding) this program may declare — the agent's own role, or none at
    /// all for an on-use script. Checked by [`declare`](Self::declare).
    ending: RunEnding,
    /// Whether this agent keeps a [program library](crate::programs), so the three
    /// [library calls](programs) are available to it. Checked by
    /// [`library_bound`](Self::library_bound).
    ///
    /// Held here and not only handed to the guest for the same reason [`ending`](Self::ending) is:
    /// scope construction is a capability model only for a guest that has a scope to construct.
    library: bool,
    /// Whether this agent holds [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE),
    /// so the two [documentation-close calls](docs) are available to it. Checked by
    /// [`docview_close_bound`](Self::docview_close_bound).
    ///
    /// Held **only** here, unlike [`library`](Self::library), which is also handed to the guest so a
    /// guest that builds its scope can leave the object out of it. There is nothing to hand over:
    /// the guest's `run` takes the flags a scope is built from, and adding one would mean rebuilding
    /// eleven committed guests to teach them a name none of their SDKs spells yet. So this gate is
    /// the whole gate, which is the shape every capability is moving toward regardless — a static
    /// SDK, and a call the host refuses at the boundary with a reason the program can catch.
    docview_close: bool,
    /// The linear-memory ceiling, and its record of having denied a growth.
    limiter: MemoryLimiter,
    /// The run's wall-clock budget, consulted before every bridged call. `None` for a run with no
    /// deadline at all.
    deadline: Option<Instant>,
    /// When this program began, so [`guest_elapsed`](Self::guest_elapsed) and the store's
    /// epoch-deadline callback can measure how long the guest has been executing.
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
/// would turn a chatty guest into a failed turn. This keeps the last [`STDERR_CAP`] bytes and drops
/// what came before, which is the right end to keep: the message that precedes a trap is the last
/// thing written.
#[derive(Clone, Default)]
pub(crate) struct GuestStderr(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

/// How much of a guest's stderr the host keeps — the tail.
///
/// A runtime's dying message is a line or two. This is large enough that a stack trace or a
/// compiler-style diagnostic survives whole, and small enough that a program looping on a write to
/// fd 2 cannot grow the host's memory.
const STDERR_CAP: usize = 8 * 1024;

impl GuestStderr {
    /// Append `bytes`, keeping only the last [`STDERR_CAP`] of everything written so far.
    fn append(&self, bytes: &[u8]) {
        let mut buffer = self
            .0
            .lock()
            .expect("the guest stderr buffer is never poisoned");
        buffer.extend_from_slice(bytes);
        if buffer.len() > STDERR_CAP {
            let excess = buffer.len() - STDERR_CAP;
            buffer.drain(..excess);
        }
    }

    /// What the guest wrote, as text, or the empty string when it wrote nothing.
    ///
    /// Lossy, because these are a runtime's own bytes and not something gg chose the encoding of —
    /// and a message a model could have read, dropped because one byte was not UTF-8, would be the
    /// worst possible trade here.
    pub(crate) fn tail(&self) -> String {
        let buffer = self
            .0
            .lock()
            .expect("the guest stderr buffer is never poisoned");
        String::from_utf8_lossy(&buffer).trim().to_string()
    }
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
    /// is [`STDERR_CAP`], which *drops* the oldest bytes rather than denying the newest — a guest
    /// told its stderr was full is a guest whose runtime may block, retry or trap on gg's
    /// bookkeeping.
    fn check_write(&mut self) -> wasmtime_wasi::p2::StreamResult<usize> {
        Ok(STDERR_CAP)
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
impl<A: ToolApi> WasiView for MembraneState<A> {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.wasi_table,
        }
    }
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
fn wasi_context(stderr: GuestStderr) -> WasiCtx {
    let mut builder = WasiCtxBuilder::new();
    builder
        .inherit_env()
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
/// toolchain. It is no longer only a unit test that reaches it: the committed Python guest imports
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

impl<A: ToolApi> MembraneState<A> {
    /// The state for one program: bridged through `api`, written in `language`, offering exactly
    /// what `scope` says this program was given, bounded by `limits`, and stopping at `deadline`.
    ///
    /// It takes the whole [`ProgramScope`] rather than the tool names alone because everything in it
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
            enabled: scope.enabled.iter().cloned().collect(),
            ending: scope.ending,
            library: scope.library,
            docview_close: scope.docview_close,
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
            wasi: wasi_context(stderr.clone()),
            wasi_table: ResourceTable::new(),
            stderr,
        }
    }

    /// What the guest wrote to **stderr**, or the empty string when it wrote nothing.
    ///
    /// Read by [`classify`](super::engine::classify) when a program failed, because on a guest
    /// without an exception mechanism this is the only account of the failure that exists. See
    /// [`GuestStderr`].
    pub(crate) fn stderr_tail(&self) -> String {
        self.stderr.tail()
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
    /// arm with an exception mechanism this is never consulted; a guest without one — a Rust program
    /// on `wasm32-unknown-unknown`, whose panic hook makes this call and whose panic then aborts —
    /// reaches the host with the failure recorded and the store trapped, and the recorded failure is
    /// the better of the two things gg could tell the model.
    pub(crate) fn reported_error(&self) -> bool {
        self.program_error.is_some()
    }

    /// Record that the guest outran its execution timeout, for [`classify`](super::engine::classify)
    /// to read after the resulting trap unwinds. Called from the store's epoch-deadline callback.
    pub(crate) fn mark_timed_out(&mut self) {
        self.timed_out = true;
    }

    /// The reclaimed [tool api](ToolApi) and everything the program accumulated, consuming the
    /// state. The api is handed back so the loop reclaims the per-turn state it moved in (the
    /// context window, the skills/docs runtimes, the delegation context).
    pub(crate) fn api_and_parts(self) -> (A, MembraneParts) {
        let parts = MembraneParts {
            calls: self.calls,
            calls_suppressed: self.calls_suppressed,
            api_calls: self.api_calls,
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
    /// This is what twenty-eight of the twenty-nine bound tools call. The twenty-ninth is `shell`,
    /// which needs a non-`ok` outcome as a value — see [`call_raw`](Self::call_raw).
    ///
    /// The [`Recording`] is the caller's proof that the API call it is servicing has already been
    /// recorded under its own identity — which is a different fact from the tool record this
    /// dispatch keeps, and is why one host function can be `view.open_file` here and `read_file`
    /// there.
    fn call(
        &mut self,
        recording: Recording,
        tool: &'static str,
        run: impl FnOnce(&mut A) -> ToolOutcome,
    ) -> Result<ToolOutcome, ToolError> {
        // For every tool but `shell`, the tool's own verdict and the call's are the same thing.
        let outcome = self.dispatch(recording, tool, run, |outcome| outcome.ok)?;
        if outcome.ok {
            Ok(outcome)
        } else {
            Err(self.tool_error(tool, &outcome))
        }
    }

    /// As [`call`](Self::call), but a non-`ok` outcome is returned as a **value** rather than as an
    /// error.
    ///
    /// `shell` is the only caller: a process that ran is a success of the call whatever it exited
    /// with, and throwing on a non-zero exit would make `shell("npm test")` unusable inside an
    /// expression — which is the single most common thing a program does. The presence of a
    /// [`ToolData::Shell`] sidecar is what distinguishes "it ran and exited non-zero" from "it
    /// could not be launched, or the timeout killed it", and it is therefore also what the roster
    /// records: a completed process is a **successful call**, summarised as `exited 1`, not a
    /// failure carrying the command's whole output as its message.
    fn call_raw(
        &mut self,
        recording: Recording,
        tool: &'static str,
        run: impl FnOnce(&mut A) -> ToolOutcome,
    ) -> Result<ToolOutcome, ToolError> {
        self.dispatch(recording, tool, run, |outcome| {
            matches!(outcome.data, Some(ToolData::Shell(_)))
        })
    }

    /// Set this agent's ending flag: the program's declaration that its session is over.
    ///
    /// It bypasses [`dispatch`](Self::dispatch) entirely, and both of that function's guards are
    /// wrong here: the enabled-set guard would refuse a call that is not a tool at all, and the
    /// deadline guard would withhold the exit at exactly the moment a run most needs it. Ending
    /// performs no work, so there is nothing for a spent budget to protect.
    ///
    /// # The one guard it does have, and why it is first
    ///
    /// **Which endings this program may declare is checked here**, against the
    /// [ending group](RunEnding) this agent was dispatched with. Scope construction is the
    /// capability model — a guest binds one group's names and no others — but it is a model only
    /// for a guest that builds a scope. A guest that links its SDK as an ordinary library has every
    /// name, and without this check a standard agent could call `approve` and hand back a verdict:
    /// the [loop](crate::agent) reads the declaration straight off the ending and never re-asks
    /// whose it was.
    ///
    /// The check runs **before** the declaration is inspected for shape, so a reviewer that called
    /// `finish` is told it is not the one to say the work is complete rather than told to write a
    /// better summary — and so a perfectly well-formed `approve` from an agent that may not approve
    /// is `unavailable` rather than accepted on its way past an `invalid-argument` that never fires.
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
        call: SurfaceCall,
    ) -> Result<(), ToolError> {
        if !self.ending.permits(call.key) {
            let message = self.ending.withheld(self.language, call);
            return Err(self.withhold(call, message));
        }
        let ending = ending.map_err(|message| ToolError {
            code: ErrorCode::InvalidArgument,
            tool: call.key.to_string(),
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
    /// free), then the capability backstop (so a withheld tool never reaches the loop), then the
    /// call, then the collection of whatever it produced.
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
        tool: &'static str,
        run: impl FnOnce(&mut A) -> ToolOutcome,
        completed: fn(&ToolOutcome) -> bool,
    ) -> Result<ToolOutcome, ToolError> {
        if self.deadline_spent() {
            return Err(self.refuse(
                tool,
                ErrorCode::LimitExceeded,
                "the run's wall-clock budget is spent",
            ));
        }
        if !self.enabled.contains(tool) {
            return Err(self.refuse(
                tool,
                ErrorCode::Unavailable,
                format!("unknown tool `{tool}`; it is not offered by this run's capability set"),
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
        self.record(tool, &outcome, completed);
        Ok(outcome)
    }

    /// How this program's [language](ProgramLanguage) spells `call` — the qualified name any
    /// sentence put in front of the model quotes back.
    fn spelled(&self, call: SurfaceCall) -> String {
        spell(self.language, call)
    }

    /// Refuse a [program-library](programs) call from an agent that keeps no library.
    ///
    /// One helper rather than three copies, called as the **first** statement inside each library
    /// call's [bracket](recording) — so the API call is still opened and still counted as a
    /// failure. That count is the point: "the model reached for something this run does not offer
    /// it" is precisely what a toolset ablation is run to measure, and a refusal that closed no
    /// bracket would be invisible to it.
    ///
    /// The call is [spelled](spell) in the program's own language for the same reason
    /// [`RunEnding::withheld`]'s replacements are: the sentence is put in front of a model, and a
    /// model reads a name it could write.
    fn library_bound(&mut self, call: SurfaceCall) -> Result<(), ToolError> {
        if self.library {
            return Ok(());
        }
        let message = format!(
            "`{}` is not available to you: this agent keeps no library of the programs it has run.",
            self.spelled(call)
        );
        Err(self.withhold(call, message))
    }

    /// Refuse a [documentation-close](docs) call from an agent that was not given the capability.
    ///
    /// The counterpart of [`library_bound`](Self::library_bound), and refused on the same terms —
    /// inside the call's own [bracket](recording), so the reach is counted as a failed API call
    /// rather than vanishing. What differs is the identity it is filed under: there is no
    /// [`SurfaceCall`] for it, because no arm's committed catalogue spells it yet, so the refusal
    /// names it in gg's own vocabulary rather than in a spelling that would resolve to nothing.
    fn docview_close_bound(&mut self, function: &str) -> Result<(), ToolError> {
        if self.docview_close {
            return Ok(());
        }
        let message = format!(
            "`{DOCS_OBJECT}.{function}` is not available to you: this agent may open documentation \
             but not close it."
        );
        self.record_refusal(&format!("{DOCS_OBJECT}.{function}"), &message);
        Err(ToolError {
            code: ErrorCode::Unavailable,
            tool: function.to_string(),
            message,
        })
    }

    /// Refuse a model-facing call this agent was never offered, record it, and render it as the
    /// error the program will see thrown.
    ///
    /// Separate from [`refuse`](Self::refuse) because the thing refused is not a gg tool: the error
    /// names the *call* the model wrote, and the roster entry carries its whole `object.key`
    /// identity rather than a tool name that would answer to nothing. It is [`Unavailable`] in every
    /// case, which is the same class — and the same recovery — a guest that could withhold the name
    /// would have produced by leaving it out of scope.
    ///
    /// # Why `tool` is gg's name and the message is the language's
    ///
    /// [`ToolError::tool`] is an **identity**: the thing that failed, in gg's own vocabulary, so a
    /// catch site can report it without parsing prose — exactly as it carries `read_file` for the
    /// twenty-nine bound tools whose SDK spelling is `fs.readFile`. The `message` is an
    /// **instruction**, and an instruction naming a call has to name it the way this program would
    /// write it, so its caller [spells](spell) every call it quotes. The two fields differ on
    /// purpose; they are not two attempts at the same thing.
    ///
    /// [`Unavailable`]: ErrorCode::Unavailable
    fn withhold(&mut self, call: SurfaceCall, message: String) -> ToolError {
        self.record_refusal(&format!("{}.{}", call.object, call.key), &message);
        ToolError {
            code: ErrorCode::Unavailable,
            tool: call.key.to_string(),
            message,
        }
    }

    /// Record a refusal and render it as the error the program will see thrown.
    fn refuse(
        &mut self,
        tool: &'static str,
        code: ErrorCode,
        message: impl Into<String>,
    ) -> ToolError {
        let message = message.into();
        self.record_refusal(tool, &message);
        ToolError {
            code,
            tool: tool.to_string(),
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

    /// The typed error a failed outcome becomes, classified by the tool that raised it rather than
    /// by matching on its prose.
    fn tool_error(&self, tool: &str, outcome: &ToolOutcome) -> ToolError {
        ToolError {
            code: error_code(outcome.failure),
            tool: tool.to_string(),
            // The model-facing text, which for a failure is both the outcome's `output` and its
            // telemetry summary — the same sentence the native tool-calling path would show.
            message: outcome.output.clone(),
        }
    }

    /// The error a successful call with no [structured sidecar](ToolData) becomes, with the call's
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
    fn missing_data(&mut self, tool: &str, produced: Option<&ToolData>) -> ToolError {
        let produced = match produced {
            Some(data) => format!(" (it produced a `{}` payload instead)", data_kind(data)),
            None => String::new(),
        };
        let message =
            format!("`{tool}` produced no structured result{produced}; this is a gg defect");
        self.amend_last_call_as_failed(&message);
        ToolError {
            code: ErrorCode::IoError,
            tool: tool.to_string(),
            message,
        }
    }
}

/// The membrane's `error-code` as the contract publishes it on an
/// [`ApiResult`](test_cabinet_core::gg::GgTelemetryKind::ApiResult).
///
/// The two enums are one-to-one, and the conversion is written out by hand rather than derived: the
/// WIT enum is the guest's vocabulary and the contract's is a published wire value, and a `From`
/// that made them interchangeable would let a change to either travel silently to the other. It is
/// taken from the `ToolError` the program was actually thrown, rather than from the outcome behind
/// it, so a refusal — which has no outcome at all — is classified by the same function as everything
/// else.
pub(super) fn wire_failure(code: ErrorCode) -> GgToolFailure {
    match code {
        ErrorCode::InvalidArgument => GgToolFailure::InvalidArgument,
        ErrorCode::NotFound => GgToolFailure::NotFound,
        ErrorCode::Conflict => GgToolFailure::Conflict,
        ErrorCode::Refused => GgToolFailure::Refused,
        ErrorCode::Unavailable => GgToolFailure::Unavailable,
        ErrorCode::LimitExceeded => GgToolFailure::LimitExceeded,
        ErrorCode::IoError => GgToolFailure::IoError,
        ErrorCode::Other => GgToolFailure::Other,
    }
}

/// A tool's own failure classification as the membrane's `error-code`.
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
/// Exhaustive on purpose: a new [`ToolData`] variant has to be named here, which is a two-second
/// edit that keeps the one message a developer will read while debugging drift accurate.
fn data_kind(data: &ToolData) -> &'static str {
    match data {
        ToolData::Shell(_) => "shell",
        ToolData::FileText(_) => "fileText",
        ToolData::FileImage(_) => "fileImage",
        ToolData::BytesWritten(_) => "bytesWritten",
        ToolData::DirEntries(_) => "dirEntries",
        ToolData::MemoryUsage(_) => "memoryUsage",
        ToolData::MemoryHits(_) => "memoryHits",
        ToolData::TaskUsage(_) => "taskUsage",
        ToolData::BoardUsage(_) => "boardUsage",
        ToolData::BoardNode(_) => "boardNode",
        ToolData::Reclaim(_) => "reclaim",
        ToolData::ArchiveSearch(_) => "archiveSearch",
        ToolData::SubagentSpawned(_) => "subagentSpawned",
        ToolData::SubagentResults(_) => "subagentResults",
    }
}

/// The empty trait the shared `types` interface generates. It declares no functions — it exists so
/// that one `tool-error` crosses the whole membrane rather than one per family — but the world
/// still requires an implementation.
impl<A: ToolApi> types::Host for MembraneState<A> {}

#[cfg(test)]
#[path = "membrane.test.rs"]
mod tests;
