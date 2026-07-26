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

use super::invoker::{SandboxRefusal, SandboxToolCall};
use super::transpile::{TranspileError, UnreachableTail};
use crate::model::ImageContent;

/// Everything one program produced — its effects, its exhaust, and how it ended.
///
/// The tool calls, logs, images and fuel are populated on **every** path, including a trap, for the
/// reason the [module docs](self) open with. Only [`result`](Self::result) splits.
#[derive(Debug)]
pub struct SandboxOutcome {
    /// Every tool call the program made that reached the loop, in call order, up to the roster cap.
    /// Refusals are NOT here — see [`refusals`](Self::refusals).
    ///
    /// The number of `ToolCall`/`ToolResult` telemetry pairs and replay entries the turn produced
    /// is `tool_calls.len() + tool_calls_suppressed`, **not** the vector's length: a program can
    /// afford hundreds of thousands of calls within its fuel ceiling, and the roster is bounded
    /// because it is charged to the next turn's context window.
    pub tool_calls: Vec<SandboxToolCall>,
    /// How many serviced calls the roster cap discarded. They happened, and they streamed their
    /// telemetry — this is only how many of them the roster stopped describing.
    pub tool_calls_suppressed: u64,
    /// Calls the membrane refused before they reached the loop: a turn-level transition, or a tool
    /// this run does not offer. They produce no telemetry and no replay entry, so they are counted
    /// apart from [`tool_calls`](Self::tool_calls) and only mentioned in the model's feedback.
    pub refusals: Vec<SandboxRefusal>,
    /// How many refusals the cap discarded — the shape being bounded is a program that swallows
    /// the throws and keeps calling after the run's budget is spent.
    pub refusals_suppressed: u64,
    /// Everything the program wrote with `console.*`, in order, subject to the capture caps.
    pub logs: Vec<String>,
    /// How many log lines the caps discarded, so the feedback can say so rather than lie.
    pub logs_suppressed: u64,
    /// Pictures a bridged `read_file` produced, for the loop to attach to the turn's feedback.
    pub images: Vec<ImageContent>,
    /// Pictures dropped because the per-program budget was already spent.
    pub images_dropped: u32,
    /// The shim's note that the program deferred work into a microtask which ran after it ended.
    /// `None` when it did not.
    pub deferred_note: Option<String>,
    /// Whether the program ended with a `return` that carried a value — which gg **discarded**.
    ///
    /// The value is not here because it is nowhere: a program's return value is not a channel, and
    /// the only way to show gg a value is to log it. What the loop does with this is tell the model
    /// so, once, on the turn it happened, rather than leaving it to infer a rule from an absence.
    pub returned_value: bool,
    /// The completion the program declared with `finish`, or `None` if it never did — or lost it.
    /// `Some` ends the session.
    ///
    /// It rides in the group populated on **every** path rather than inside
    /// [`result`](Self::result), because the flag lives in the agent's host-side context: it is set
    /// while the program runs and survives whatever happens to the program afterwards, including a
    /// trap that leaves no result at all.
    ///
    /// It is not, however, unconditional. A program that declared the run over and then **failed** —
    /// an uncaught throw, or a sandbox ceiling — loses the ending to
    /// [`revoked_completion`](Self::revoked_completion), because the summary it wrote describes
    /// checks the program never finished running.
    pub completion: Option<ProgramCompletion>,
    /// The summary of a completion the program declared and then lost by failing, so the turn's
    /// feedback can say the ending was cancelled and why. `None` on every other path.
    pub revoked_completion: Option<String>,
    /// The fuel the run consumed (`limits.fuel` minus what was left), reported even on a trap.
    pub fuel_consumed: u64,
    /// Top-level statements the program wrote that could not run, when it wrote any — the fact that
    /// keeps a reply whose second half never executed from being reported as an unqualified
    /// success. See [`UnreachableTail`].
    ///
    /// `None` for a program that never reached the type-strip, because a program that did not
    /// compile has no statements at all.
    pub unreachable: Option<UnreachableTail>,
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
    pub(super) fn before_start(error: SandboxError) -> Self {
        Self {
            tool_calls: Vec::new(),
            tool_calls_suppressed: 0,
            refusals: Vec::new(),
            refusals_suppressed: 0,
            logs: Vec::new(),
            logs_suppressed: 0,
            images: Vec::new(),
            images_dropped: 0,
            deferred_note: None,
            returned_value: false,
            completion: None,
            revoked_completion: None,
            fuel_consumed: 0,
            unreachable: None,
            compile_wait: None,
            result: Err(error),
        }
    }
}

/// A program's declaration that the run is complete — the flag `finish(summary)` set in the agent's
/// host-side context.
///
/// It is a record rather than a bare `String` because the earlier calls are a fact worth keeping.
/// `finish` does not stop a program, so calling it more than once is an ordinary shape — two branches
/// that both run, a call inside a loop — and the **last** summary is the one the run ends on, written
/// with the most of the program's work behind it. The loop mentions the replacements on the
/// operator's stream; nothing about them is a failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramCompletion {
    /// The summary the program last passed to `finish`, verbatim. Becomes the run's final text — for
    /// the root agent the session's last word, for a subagent its return value to its spawner.
    pub summary: String,
    /// How many EARLIER summaries this one replaced.
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
    /// The program referenced a name that is not in scope — most often a tool this run withheld.
    UnknownName,
    /// Anything else the program threw.
    Other,
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
    /// The program is not valid TypeScript, or used a module feature the sandbox has no
    /// implementation of. **The model's to fix**, and the only variant that costs no engine work at
    /// all: it is detected before the component is touched, so nothing ran and no call landed.
    #[error("the program did not compile: {0}")]
    Transpile(#[from] TranspileError),
    /// The wasm engine could not be configured or linked.
    ///
    /// Both of its producers are unreachable in this build and are kept because the failures they
    /// report are real ones for a *different* configuration: linking fails on a duplicate import
    /// name, which a `bindgen!`-generated linker cannot produce, and setting fuel fails when fuel
    /// consumption is off, which the fixed [`Config`](wasmtime::Config) turns on. So there is no
    /// test that provokes it — only one that asserts what it says.
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
    /// The program exhausted its fuel ceiling — a runaway loop, or simply too much work (most often
    /// too much OUTPUT: writing is the expensive direction of the membrane) for one program.
    #[error("the program exhausted its fuel ceiling of {limit}")]
    OutOfFuel {
        /// The ceiling that was exhausted, so the feedback can name it.
        limit: u64,
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
    /// so the store — and with it the roster, the logs and the fuel reading — died with it.
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
}
