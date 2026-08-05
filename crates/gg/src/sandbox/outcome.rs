//! What a run yields — the shape of every answer the sandbox gives, and the taxonomy of the ways it
//! can decline to give one.
//!
//! These types are what the [loop](crate::agent) reads after a program has run, so they are written
//! to be read *there*: every field says what the turn's feedback and telemetry are meant to do with
//! it, and every failure variant says whose fault it is — the model's, the committed artifact's, or
//! gg's own — because that is the question the loop has to answer without matching on prose, and
//! because only one of those three answers may cost the model a turn.
//!
//! The one shape worth noting up front: [`SandboxOutcome`] is deliberately **not**
//! `Result<Report, Error>`. Everything a program accumulated on its way to a failure is exactly
//! what the model needs to see next turn, so it comes back on every path and only
//! [`result`](SandboxOutcome::result) splits.

use std::time::Duration;

use super::invoker::{SandboxRefusal, SandboxToolCall, SandboxViewOpened};
use super::language::{PrepareError, UnreachableTail};
use crate::ending::Ending;
use crate::limits::TurnErrorType;

/// Everything one program produced — its effects, its exhaust, and how it ended.
///
/// The tool calls, logs and elapsed time are populated on **every** path, including a trap,
/// for the reason the [module docs](self) open with. Only [`result`](Self::result) splits.
#[derive(Debug)]
pub struct SandboxOutcome {
    /// Every tool call the program made that reached the loop, in call order, up to the roster cap.
    /// Refusals are NOT here — see [`refusals`](Self::refusals).
    ///
    /// The number of `ToolCall`/`ToolResult` telemetry pairs and replay entries the turn produced
    /// is `tool_calls.len() + tool_calls_suppressed`, **not** the vector's length: a program can
    /// afford hundreds of thousands of calls within its execution timeout, and the roster is bounded
    /// because it is charged to the next turn's context window.
    pub tool_calls: Vec<SandboxToolCall>,
    /// How many serviced calls the roster cap discarded. They happened, and they streamed their
    /// telemetry — this is only how many of them the roster stopped describing.
    pub tool_calls_suppressed: u64,
    /// How many **model-facing API calls** the program made — one per `ApiCall`/`ApiResult` pair the
    /// turn streamed, whatever the roster caps did.
    ///
    /// A count rather than a roster, and a superset of the dispatched calls by two things: the
    /// carve-outs no gg tool backs (a view, an ending, a program-library call, an `object.list()`),
    /// and the calls the membrane refused. The model made those, so the API layer counts them; the
    /// tool layer does not, because nothing ran.
    pub api_calls: u64,
    /// Calls the membrane refused before they reached the loop: a turn-level transition, or a tool
    /// this run does not offer. They produce no telemetry and no replay entry, so they are counted
    /// apart from [`tool_calls`](Self::tool_calls) and only mentioned in the model's feedback.
    pub refusals: Vec<SandboxRefusal>,
    /// How many refusals the cap discarded — the shape being bounded is a program that swallows
    /// the throws and keeps calling after the run's budget is spent.
    pub refusals_suppressed: u64,
    /// Everything the program wrote with `console.*`, in order, subject to the capture caps.
    ///
    /// These go to the **operator**: the loop puts them on the turn's own
    /// [`CodeExecution`](test_cabinet_core::gg::GgTelemetryKind::CodeExecution) event, which is what
    /// carries them onto the run's stream, into the run record and into any analysis over it. The
    /// tail of them is also the spawner's one-line report. They are deliberately *not* shown to the
    /// model **in any form** — not the lines, and not a count of them. Their channel into their own
    /// window is a [view](crate::context::ViewKind), and a count would still be a channel: it says
    /// the output went somewhere, which is where the argument that it might come back begins. See
    /// [`CodeFeedback`](crate::agent).
    pub logs: Vec<String>,
    /// How many log lines the caps discarded — the figure that separates what the *program* printed
    /// from what gg's buffer kept, on the operator's record. Never reported to the model, for the
    /// reason [`logs`](Self::logs) is not.
    pub logs_suppressed: u64,
    /// The [views](crate::context::ViewKind) the program opened, in call order — what the turn's
    /// feedback reports back so the model can read its own accounting: which selector it showed,
    /// what that costs, and whether it *replaced* something rather than adding to it.
    pub views_opened: Vec<SandboxViewOpened>,
    /// The selectors the program closed, in call order. Only closes that actually closed something
    /// are here: `view.close` of a selector that is not open is a successful no-op by design.
    pub views_closed: Vec<String>,
    /// Every view call that was refused — a cap, an unusable selector, or a read that failed.
    ///
    /// A refused view is the one thing this feature must never let happen quietly: the material
    /// never reached the window, and a model that was not told would read the silence as evidence
    /// its program never ran.
    pub view_refusals: Vec<String>,
    /// How many view records the recording cap discarded, across all three lists.
    pub views_suppressed: u64,
    /// The shim's note that the program deferred work into a microtask which ran after it ended.
    /// `None` when it did not.
    pub deferred_note: Option<String>,
    /// Every code module that threw while it was being loaded, as `(binding key, message)`.
    ///
    /// Empty on the overwhelming majority of turns. When it is not, the turn's feedback says which
    /// skill or memory's code failed and why — never its source, which the model is not shown — so a
    /// program that found `lib.x` empty is told why rather than left to guess.
    pub module_errors: Vec<(String, String)>,
    /// Whether the program ended with a `return` that carried a value — which gg **discarded**.
    ///
    /// The value is not here because it is nowhere: a program's return value is not a channel, and
    /// the way to put a value in front of the model is to open a [text view](crate::context::ViewKind)
    /// of it. What the loop does with this is tell the model so, once, on the turn it happened,
    /// rather than leaving it to infer a rule from an absence.
    pub returned_value: bool,
    /// The ending the program declared, or `None` if it never did — or lost it. `Some` ends the
    /// session.
    ///
    /// It rides in the group populated on **every** path rather than inside
    /// [`result`](Self::result), because the flag lives in the agent's host-side context: it is set
    /// while the program runs and survives whatever happens to the program afterwards, including a
    /// trap that leaves no result at all.
    ///
    /// It is not, however, unconditional. A program that declared its session over and then
    /// **failed** — an uncaught throw, or a sandbox ceiling — loses the ending to
    /// [`revoked_completion`](Self::revoked_completion), because the declaration it made rests on
    /// checks the program never finished running.
    pub completion: Option<ProgramCompletion>,
    /// The ending a program declared and then lost by failing, so the turn's feedback can say the
    /// ending was cancelled and why. `None` on every other path.
    pub revoked_completion: Option<Ending>,
    /// The program this one handed gg to run in its place with
    /// [`programs.rerun`](crate::programs), when the
    /// [library](test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY) is bound and the program used
    /// it.
    ///
    /// It rides in the group populated on every path for the reason
    /// [`completion`](Self::completion) does — it is a flag in the agent's host-side state, not a
    /// value the program returned — and it is subject to the same revocation: a program that then
    /// failed loses it to [`revoked_rerun`](Self::revoked_rerun).
    pub rerun: Option<String>,
    /// Whether a hand-over was revoked because the program then failed. `false` on every path that
    /// had nothing to revoke.
    pub revoked_rerun: bool,
    /// The wall-clock time the program's **own execution** took — the guest's setup, the program,
    /// and every value marshalled across the membrane, but **not** time parked in a bridged tool
    /// call, so it is the same guest-only cost the [timeout](SandboxError::Timeout) is measured
    /// against. Reported on every path that reached the engine, including a trap or a timeout (where
    /// it is the time burned up to the stop). The efficiency signal that replaces the fuel figure
    /// the fuel-metered sandbox used to report.
    pub elapsed: Duration,
    /// Top-level statements the program wrote that could not run, when it wrote any — the fact that
    /// keeps a reply whose second half never executed from being reported as an unqualified
    /// success. See [`UnreachableTail`].
    ///
    /// `None` for a program its language could not prepare, because a program that did not
    /// compile has no statements at all.
    pub unreachable: Option<UnreachableTail>,
    /// How long **this program's own compilation** took — the whole of its language's
    /// [prepare step](super::ProgramLanguage::prepare_program), including any compiler that step
    /// shells out to — for a language that declares it
    /// [compiles](super::ProgramLanguage::prepare_compiles).
    ///
    /// `None` for a language whose prepare step is in-process and free (TypeScript's type-strip),
    /// where the figure would be a sub-millisecond zero on every turn and would say nothing.
    ///
    /// Reported on **every** path, including the one where the compiler rejected the program: a
    /// compile that failed after four seconds of `swiftc` is exactly the cost a compiled arm has to
    /// answer for, and it is the path that would otherwise report nothing at all.
    ///
    /// It is not [`compile_wait`](Self::compile_wait), which is the one shared *interpreter
    /// component* compile and belongs to the process rather than to this program. Without this
    /// field a compiled language's per-turn cost is invisible: the membrane's clock starts after
    /// the prepare step, so the time appears in neither [`elapsed`](Self::elapsed) nor
    /// `compile_wait` and is absorbed into the turn's response time alongside minutes of
    /// `system.shell` — which is to say a compiled arm and an interpreted one could not be compared
    /// on what compiling cost them.
    pub compile: Option<Duration>,
    /// How long this program spent obtaining the compiled interpreter component, when it was the
    /// program that had to compile it.
    ///
    /// `None` — the ordinary case — means the component was already compiled when the program
    /// asked, so nothing here is on the turn's critical path. `Some` means this turn beat the
    /// run's [warm-up](super::precompile) to it and paid the compile itself, which on a one- or
    /// two-core run container is seconds. Recorded because the alternative is what it cost to learn
    /// it the last time: reconstructing "did this program wait on the one shared compile?" from
    /// timestamps across sibling runs.
    pub compile_wait: Option<Duration>,
    /// The program's result, or why the sandbox could not run it to one.
    pub result: Result<ProgramResult, SandboxError>,
}

impl SandboxOutcome {
    /// The outcome of a program that never started: it did not compile, or the engine or the
    /// committed component could not be prepared. Nothing ran, so nothing was accumulated.
    ///
    /// `compile` is the exception to "nothing was accumulated", and the reason it is a parameter
    /// rather than a `None` written in here: the prepare step ran on every one of these paths, and
    /// on the first of them it is what failed. A compiler that spent four seconds rejecting the
    /// program spent them whether or not the program ever reached the engine.
    pub(super) fn before_start(error: SandboxError, compile: Option<Duration>) -> Self {
        Self {
            tool_calls: Vec::new(),
            tool_calls_suppressed: 0,
            api_calls: 0,
            refusals: Vec::new(),
            refusals_suppressed: 0,
            logs: Vec::new(),
            logs_suppressed: 0,
            views_opened: Vec::new(),
            views_closed: Vec::new(),
            view_refusals: Vec::new(),
            views_suppressed: 0,
            deferred_note: None,
            module_errors: Vec::new(),
            returned_value: false,
            completion: None,
            revoked_completion: None,
            rerun: None,
            revoked_rerun: false,
            elapsed: Duration::ZERO,
            unreachable: None,
            compile,
            compile_wait: None,
            result: Err(error),
        }
    }
}

/// A program's declaration that its session is over — the flag one of the
/// [ending calls](crate::ending::EndingRole) set in the agent's host-side context.
///
/// It is a record rather than a bare [`Ending`] because the earlier calls are a fact worth keeping.
/// An ending call does not stop a program, so making one more than once is an ordinary shape — two
/// branches that both run, a call inside a loop — and the **last** declaration is the one the session
/// ends on, made with the most of the program's work behind it. The loop mentions the replacements on
/// the operator's stream; nothing about them is a failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramCompletion {
    /// What the program last declared: the summary it finished with, the verdict it returned, or the
    /// attempt it picked.
    pub ending: Ending,
    /// How many EARLIER declarations this one replaced.
    pub superseded: u32,
}

/// A program the sandbox ran to its end — whether or not the program itself succeeded.
///
/// One field, and deliberately still a struct: what a program "resulted in" is whether it ran out or
/// threw, and there is no value beside it because a return value is not a channel. Keeping the type
/// is what makes [`SandboxOutcome::result`] read as the one question it answers — did this program
/// run at all, and if so did it survive — rather than as a bare `Option` whose `None` means success.
#[derive(Debug)]
pub struct ProgramResult {
    /// The throw it did not catch. `None` when the program ran to its end.
    pub error: Option<ProgramError>,
}

/// A program that threw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramError {
    /// What class of failure it was, so the loop picks the right feedback without matching prose.
    pub kind: ProgramErrorKind,
    /// The rendered message, already naming the tool (or the identifiers this run offers).
    pub message: String,
    /// Where in the PROGRAM it happened (`line 5, column 12`), in the program's own coordinates —
    /// the guest remaps it out of the interpreter's. `None` when no usable frame was found.
    pub location: Option<String>,
}

/// The three classes a program's throw falls into, mirroring the membrane's `feedback.error-kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgramErrorKind {
    /// A tool call failed and the throw was not caught.
    ToolFailure,
    /// The program reached for something this run does not offer it: a name that is not in scope,
    /// or — where the language's SDK has no way to withhold a name — a call the membrane refused as
    /// `unavailable`. The two are the same fact and the same recovery, so they are one class; the
    /// membrane's `capture::classify` says why the host decides that rather than the guest.
    UnknownName,
    /// Anything else the program threw.
    Other,
}

impl ProgramErrorKind {
    /// The [turn error type](TurnErrorType) an uncaught throw of this class is recorded as.
    ///
    /// The class is settled at the membrane on every uncaught throw — by the host, from the failure
    /// code the guest hands up with the throw, so that one event is one class in every language;
    /// see the membrane's `capture::classify`. It is the whole difference between "the program
    /// faulted" and "the program was fighting a call it could not make". All three land under
    /// [`ProgramFault`](crate::limits::TurnErrorKind::ProgramFault) at the base level.
    ///
    /// **This is the class's only consumer.** The feedback the model reads is the throw's rendered
    /// message, not its class: nothing in the [loop](crate::agent) branches on the class to pick
    /// what to say, and a class that decided the wording would be a second, quieter answer to a
    /// question the message already answers.
    ///
    /// What the class does **not** carry is *which* [failure class](test_cabinet_core::gg::GgToolFailure)
    /// the failed call had: the guest renders that into the message's prose, and recovering it here
    /// would mean matching on prose, which this codebase does not do. The class is on the call's own
    /// [`ApiResult`](test_cabinet_core::gg::GgTelemetryKind::ApiResult) instead, where it was raised.
    pub fn turn_error_type(self) -> TurnErrorType {
        match self {
            Self::ToolFailure => TurnErrorType::ProgramToolError,
            Self::UnknownName => TurnErrorType::ProgramUnknownName,
            Self::Other => TurnErrorType::ProgramThrow,
        }
    }
}

/// Why the sandbox could not run a program to a result. An ordinary program fault — a throw — is
/// **not** here: it is carried in [`ProgramResult::error`].
///
/// The loop reads this taxonomy through the two predicates below rather than by matching variant by
/// variant, because the question it has to answer is not "which failure was it?" but "**whose**
/// failure was it?": gg's own machinery ([`is_host_fault`](Self::is_host_fault)), the committed
/// artifact ([`is_artifact_defect`](Self::is_artifact_defect)), or the model's program (everything
/// else). The first two end the session — every further turn would fail identically — and neither is
/// ever charged to the model's error budget. The rest are turn errors the model is told about and
/// can write its way out of.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// The program is not valid source in the run's [program language](super::ProgramLanguage), or
    /// used a feature the sandbox has no implementation of. **The model's to fix**, and the only
    /// variant that costs no engine work at all: it is detected before the component is touched, so
    /// nothing ran and no call landed.
    #[error("the program did not compile: {0}")]
    Prepare(#[from] PrepareError),
    /// The wasm engine could not be configured or linked.
    ///
    /// Its one producer is unreachable in this build and is kept because the failure it reports is a
    /// real one for a *different* configuration: linking fails on a duplicate import name, which a
    /// `bindgen!`-generated linker cannot produce. So there is no test that provokes it — only one
    /// that asserts what it says.
    #[error("failed to prepare the wasm engine: {0}")]
    Engine(String),
    /// The committed interpreter component failed to compile. A defect in the artifact, never a
    /// program fault; the tests compile it, so this cannot reach a release.
    #[error("the sandbox component failed to compile: {0}")]
    Compile(String),
    /// The component could not be instantiated — most often because it imports something the
    /// membrane does not provide, i.e. the committed artifact and the WIT have drifted apart.
    #[error("the sandbox component failed to instantiate: {0}")]
    Instantiate(String),
    /// The program ran past its execution timeout — its guest CPU exceeded the wall-clock ceiling,
    /// which in practice means a loop or recursion that does not terminate, because the ceiling is
    /// set far longer than any honest program's execution needs. Time parked in a bridged tool call
    /// is excluded from the measurement, so a program waiting on a long `shell` build is never
    /// stopped by it.
    #[error("the program ran longer than its {limit:?} execution timeout and was stopped")]
    Timeout {
        /// The timeout that was reached, so the feedback can name it.
        limit: Duration,
    },
    /// The guest's linear memory grew past the cap.
    #[error(
        "the program exceeded its {limit}-byte memory cap (the sandbox's JavaScript engine needs \
         about 10 MiB of heap before a program runs at all)"
    )]
    OutOfMemory {
        /// The cap that was exceeded, in bytes.
        limit: usize,
    },
    /// The guest trapped for some other reason.
    #[error("the sandbox trapped: {0}")]
    Trap(String),
    /// gg's own plumbing failed: the sandbox's blocking task did not complete (a panic inside it),
    /// so the store — and with it the roster, the logs and the elapsed reading — died with it.
    ///
    /// Kept apart from [`Trap`](Self::Trap) because a trap is something the *program* did and is
    /// answered with advice about writing smaller programs, while this is a defect in gg that must
    /// never be charged to the model's error budget. Laundering one as the other is how a model ends
    /// up rewriting a correct program to appease a bug in the harness.
    #[error("the code sandbox did not complete: {0}")]
    Host(String),
}

impl SandboxError {
    /// Whether this failure is a defect in the COMMITTED ARTIFACT rather than anything the model
    /// did — [`Compile`](Self::Compile) or [`Instantiate`](Self::Instantiate). Every subsequent
    /// turn would fail identically, so the loop ends the session loudly instead of burning to the
    /// deadline.
    pub fn is_artifact_defect(&self) -> bool {
        matches!(self, Self::Compile(_) | Self::Instantiate(_))
    }

    /// Whether this failure is gg's own machinery rather than anything the model did —
    /// [`Engine`](Self::Engine) or [`Host`](Self::Host). Both would recur identically, so the loop
    /// ends the session as a host fault instead of feeding the model advice about a program it
    /// wrote correctly.
    ///
    /// Disjoint from [`is_artifact_defect`](Self::is_artifact_defect) by construction: the two
    /// answer "whose failure was it?" for different owners, and a variant that answered both would
    /// leave the loop's classification ambiguous.
    /// `every_sandbox_failure_maps_to_exactly_one_turn_disposition` is what keeps that true as
    /// variants are added.
    pub fn is_host_fault(&self) -> bool {
        matches!(self, Self::Engine(_) | Self::Host(_))
    }

    /// The [turn error type](TurnErrorType) this failure is recorded as, for the variants that are
    /// the **model's** to fix — everything the two predicates above do not claim.
    ///
    /// `None` for [`Engine`](Self::Engine)/[`Host`](Self::Host) and
    /// [`Compile`](Self::Compile)/[`Instantiate`](Self::Instantiate), which end the session as
    /// fatal and are never charged to the model's error budget, so they have no turn error type at
    /// all. `Some` for the other four, and exhaustive rather than a catch-all: the turn loop used
    /// to reach the sandbox ceilings through an `Err(_)` arm that never looked at the variant, so
    /// a timeout, an out-of-memory and a trap were one indistinguishable bucket. Adding a variant
    /// now has to say which it is.
    ///
    /// `every_sandbox_failure_maps_to_exactly_one_turn_disposition` is what keeps this and the two
    /// predicates a partition.
    pub fn turn_error_type(&self) -> Option<TurnErrorType> {
        match self {
            Self::Prepare(prepare) => Some(prepare.turn_error_type()),
            Self::Timeout { .. } => Some(TurnErrorType::SandboxTimeout),
            Self::OutOfMemory { .. } => Some(TurnErrorType::SandboxOutOfMemory),
            Self::Trap(_) => Some(TurnErrorType::SandboxTrap),
            Self::Engine(_) | Self::Host(_) | Self::Compile(_) | Self::Instantiate(_) => None,
        }
    }
}
