//! What a run yields — the shape of every answer the sandbox gives, and the taxonomy of the ways it
//! can decline to give one.
//!
//! These types are what the [loop](crate::agent) reads after a program has run, so they are written
//! to be read *there*: every field says what the turn's feedback and telemetry are meant to do with
//! it, and every failure variant says whose fault it is — the model's, the embedded artifact's, or
//! gg's own — because that is the question the loop has to answer without matching on prose, and
//! because only one of those three answers may cost the model a turn.
//!
//! The one shape worth noting up front: [`SandboxOutcome`] is deliberately **not**
//! `Result<Report, Error>`. Everything a program accumulated on its way to a failure is exactly
//! what the model needs to see next turn, so it comes back on every path and only
//! [`result`](SandboxOutcome::result) splits.

use std::time::Duration;

use test_cabinet_core::gg::GgUndocumentedCalls;

use super::invoker::{SandboxRefusal, SandboxToolCall, SandboxViewOpened};
use super::language::{PrepareError, PrepareFailure};
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
    /// carve-outs no gg tool backs (a view, an ending, a program-library call, a documentation search),
    /// and the calls the membrane refused. The model made those, so the API layer counts them; the
    /// tool layer does not, because nothing ran.
    pub api_calls: u64,
    /// How many of those calls the model wrote **without having read the call's documentation**, by
    /// operation — the [discovery](crate::discovery) finding, counted at the same bracket
    /// [`api_calls`](Self::api_calls) is.
    ///
    /// A subset of that count and never an error: the program compiled, ran and did its work. Empty
    /// for a turn whose model looked everything up first, which is what a well-behaved run's every
    /// turn looks like.
    pub undocumented: GgUndocumentedCalls,
    /// Calls the membrane refused before they reached the loop: a turn-level transition, or a tool
    /// this run does not offer. They produce no telemetry and no session-record entry, so they are counted
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
    /// The wall-clock time the program's **own execution** took, from the call into the guest — the
    /// guest engine's own start-up, the program, and every value marshalled across the membrane, but
    /// **not** time parked in a bridged tool call, so it is the same guest-only cost the
    /// [timeout](SandboxError::Timeout) is measured against. Reported on every path that reached the engine, including a trap or a timeout (where
    /// it is the time burned up to the stop). The efficiency signal that replaces the fuel figure
    /// the fuel-metered sandbox used to report.
    pub elapsed: Duration,
    /// How long **compiling for this program** took — the whole of its language's
    /// [prepare step](super::ProgramLanguage::prepare_program), including any compiler that step
    /// shells out to — for a language that declares it
    /// [compiles](super::ProgramLanguage::prepare_compiles).
    ///
    /// `None` for a language that compiles nothing — one whose prepare step is in-process and free,
    /// where the figure would be a sub-millisecond zero on every turn and would say nothing. No
    /// registered language is one: TypeScript's prepare step type-checks with `tsc`, so it takes
    /// the `Some` branch on every turn, and the fixture language is the only subject left.
    ///
    /// Reported on **every** path, including the one where the compiler rejected the program: a
    /// compile that failed after four seconds of `swiftc` is exactly the cost a compiled arm has to
    /// answer for, and it is the path that would otherwise report nothing at all.
    ///
    /// # Everything a program made its language compile, not just its own source
    ///
    /// The sandbox sets this to what preparing the program's own source cost, which is the whole of
    /// it for the ordinary program. A program that reads a code
    /// [skill](crate::skills) or writes a code [memory](crate::memories) makes its language prepare
    /// *more* source mid-run, inside a membrane call — and an on-use script queued by such a read is
    /// a second program the turn runs. Both are charged here, by the
    /// [loop](crate::agent) folding them in with [`summed_compile`](Self::summed_compile), because
    /// otherwise a compiled arm's figure would be short by exactly the amount a skill-heavy run
    /// spends — silently, and in the direction that makes the arm look cheap.
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
    /// prebuilt component could not be prepared. Nothing ran, so nothing was accumulated.
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
            undocumented: GgUndocumentedCalls::default(),
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
            compile,
            compile_wait: None,
            result: Err(error),
        }
    }

    /// Two [compile](Self::compile) figures folded into the one a turn reports: **summed** when both
    /// are present, and the one that exists when only one is.
    ///
    /// Summed rather than replaced because every figure this folds is a *separate* trip through a
    /// compiler — the next link of a chained turn, an on-use script, the module a read prepared —
    /// and a turn that compiled four times must not report the cost of compiling once. It is the
    /// opposite rule to [`compile_wait`](Self::compile_wait)'s, where the shared interpreter
    /// component is compiled at most once however many programs a turn runs.
    ///
    /// `None` and `Some(Duration::ZERO)` are different claims — "this language does not compile"
    /// against "it compiled, instantly" — so a `None` never becomes a zero here. It exists as one
    /// function because the rule has four call sites and a fifth that gets it wrong is a number
    /// nobody can spot: too small, never absent.
    pub fn summed_compile(earlier: Option<Duration>, later: Option<Duration>) -> Option<Duration> {
        match (earlier, later) {
            (Some(earlier), Some(later)) => Some(earlier.saturating_add(later)),
            (earlier, later) => earlier.or(later),
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
    /// The program reached for something it does not have: a call the membrane refused as
    /// `unavailable`, or a name nothing bound at all. The two are the same fact and the same
    /// recovery, so they are one class; the membrane's `capture::classify` says why the host
    /// decides that rather than the guest.
    ///
    /// Since every arm's SDK became static, a *withheld capability* is always the first of the two
    /// and never the second — which is what makes this one class one measurement rather than a
    /// count that meant different things on different arms.
    UnknownName,
    /// Anything else the program threw.
    Other,
}

impl ProgramErrorKind {
    /// The [turn error type](TurnErrorType) an uncaught throw of this class is recorded as.
    ///
    /// The class is settled at the membrane — by the host, from the failure code the guest hands up
    /// with the throw; see the membrane's `capture::classify`. It is the whole difference between
    /// "the program faulted" and "the program was fighting a call it could not make", and all three
    /// land under [`ProgramFault`](crate::limits::TurnErrorKind::ProgramFault) at the base level.
    ///
    /// **It is reached only where a guest reports the throw**, which [the failure rule](https://docs.testcabinet.ai/gg/responses-as-code/invariants/#failures)
    /// requires of every guest whose runtime delivers an uncaught failure to its entry point: the
    /// interpreted arms,
    /// the ECMAScript arms, C++ and C# report, and an uncaught failed call is
    /// [`ProgramApiError`](TurnErrorType::ProgramApiError) on all of them. On an arm whose program
    /// dies the way its runtime kills it before anything can report — Rust, Swift and the JVM arms
    /// — nothing is handed up, the failure arrives as [`SandboxError::Trap`] and the turn is
    /// recorded as [`SandboxTrap`](TurnErrorType::SandboxTrap) whatever the program threw. A
    /// `Sandbox*` type is otherwise reserved for a ceiling gg imposed or a real trap, never for an
    /// API failure a program did not catch. Which arms are which is measured, per failure shape, by
    /// gate G8 (`sandbox/language/g8.rs`) and stated for a reader of the data at
    /// [turn outcomes](https://docs.testcabinet.ai/gg/telemetry/turn-outcomes/).
    ///
    /// **This is the class's only consumer.** The feedback the model reads is the throw's rendered
    /// message, not its class: nothing in the [loop](crate::agent) branches on the class to pick
    /// what to say, and a class that decided the wording would be a second, quieter answer to a
    /// question the message already answers.
    ///
    /// What the class does **not** carry is *which* [failure class](test_cabinet_core::gg::GgCallFailure)
    /// the failed call had: the guest renders that into the message's prose, and recovering it here
    /// would mean matching on prose, which this codebase does not do. The class is on the call's own
    /// [`ApiResult`](test_cabinet_core::gg::GgTelemetryKind::ApiResult) instead, where it was raised.
    pub fn turn_error_type(self) -> TurnErrorType {
        match self {
            Self::ToolFailure => TurnErrorType::ProgramApiError,
            Self::UnknownName => TurnErrorType::ProgramUnknownName,
            Self::Other => TurnErrorType::ProgramThrow,
        }
    }
}

/// Why the sandbox could not run a program to a result. An ordinary program fault — a throw — is
/// **not** here: it is carried in [`ProgramResult::error`].
///
/// The loop reads this taxonomy through the four predicates below rather than by matching variant
/// by variant, because the question it has to answer is not "which failure was it?" but "**whose**
/// failure was it?": gg's own machinery ([`is_host_fault`](Self::is_host_fault)), gg's own
/// preparation of the program ([`is_lowering_defect`](Self::is_lowering_defect)), the committed
/// artifact ([`is_artifact_defect`](Self::is_artifact_defect)), the language's compiler
/// ([`is_toolchain_defect`](Self::is_toolchain_defect)), or the run's own turn (everything else).
/// The first four end the run and none of them is ever charged to the model's error budget. The
/// rest are turn errors the run carries on from, and every one of them is the model's to write its
/// way out of.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    /// The program is not valid source in the run's [program language](super::ProgramLanguage), was
    /// rejected by that language's compiler, or used a feature the sandbox has no implementation of.
    /// **The model's to fix**, and — with [`Toolchain`](Self::Toolchain) — one of the two variants
    /// that cost no *engine* work at all: both are settled before the component is touched, so
    /// nothing ran and no call landed. For a language that compiles it still costs that compiler's
    /// time, which the outcome reports as [`compile`](SandboxOutcome::compile).
    #[error("the program did not compile: {0}")]
    Prepare(#[from] PrepareError),
    /// The language's **compiler could not finish**: it crashed, was killed by its own timeout, or
    /// is not installed in this image. The program was never judged, so there is nothing to show the
    /// model and nothing for it to fix.
    ///
    /// **gg's**, and it ends the run: it is fed back to nobody, charged to no ceiling, and recorded
    /// as [`FatalFault::Toolchain`](crate::limits::FatalFault::Toolchain). The variant's own two
    /// halves are why. A binary that is not in the image is a packaging defect that fails every
    /// turn identically, and a compiler that crashed once is no more the model's doing than one
    /// that was never installed — in both the model answered and nothing read the answer.
    ///
    /// The trade is stated where it can be revisited, on
    /// [`FatalFault::Toolchain`](crate::limits::FatalFault::Toolchain): a crash that would not have
    /// recurred now ends the run, which is the price of never asking a model to rewrite a program
    /// nothing rejected and never letting gg's image spend the model's error budget.
    #[error("the program's compiler could not finish: {0}")]
    Toolchain(String),
    /// **gg could not prepare a source it had already accepted**: the transform over a parsed and
    /// checked program failed, or the surface gg generated for the model to write against was
    /// rejected by the language's own checker.
    ///
    /// gg's defect, on the one path where it wears a compiler's clothes — which is why it is a
    /// variant of its own rather than a [`Prepare`](Self::Prepare) failure. The model's text was
    /// read and accepted; what failed after that is on gg's side of the seam, and reporting it as a
    /// compile error would tell a model to rewrite a program nothing was wrong with, charge gg's
    /// bug to the model's [error ceilings](crate::limits::RunLimits), and record it in the
    /// `transpile` bucket a study reads as "this model kept writing programs that did not compile".
    ///
    /// It ends the **run**, as [`Toolchain`](Self::Toolchain) beside it does, and is held apart
    /// from it because the two are fixed by different people: one is a bug in gg's pipeline, the
    /// other a fault in the image gg runs in. See [`PrepareFailure::Lowering`] and
    /// [gg's fault latch](crate::fault).
    #[error("the program was accepted and then could not be prepared: {0}")]
    Lowering(String),
    /// The wasm engine could not be configured or linked.
    ///
    /// Its one producer is unreachable in this build and is kept because the failure it reports is a
    /// real one for a *different* configuration: linking fails on a duplicate import name, which a
    /// `bindgen!`-generated linker cannot produce. So there is no test that provokes it — only one
    /// that asserts what it says.
    #[error("failed to prepare the wasm engine: {0}")]
    Engine(String),
    /// The embedded interpreter component failed to compile. A defect in the artifact, never a
    /// program fault; the tests compile it, so this cannot reach a release.
    #[error("the sandbox component failed to compile: {0}")]
    Compile(String),
    /// The component could not be instantiated — most often because it imports something the
    /// membrane does not provide, i.e. the embedded artifact and the WIT have drifted apart.
    #[error("the sandbox component failed to instantiate: {0}")]
    Instantiate(String),
    /// The program ran past its execution timeout — its guest CPU exceeded the wall-clock ceiling,
    /// which in practice means a loop or recursion that does not terminate, because the ceiling is
    /// set far longer than any honest program's execution needs. Time parked in a bridged tool call
    /// is excluded from the measurement, so a program waiting on a long `shell` build is never
    /// stopped by it.
    #[error("{}", with_guest_stderr(
        format!(
            "the program ran longer than its {}s execution timeout",
            limit.as_secs_f64()
        ),
        said,
    ))]
    Timeout {
        /// The timeout that was reached, so the feedback can name it.
        limit: Duration,
        /// What the guest wrote to standard error before it was stopped, empty when it wrote
        /// nothing. It is rendered in FRONT of the sentence above, for the reason the module's
        /// `with_guest_stderr` gives.
        said: String,
    },
    /// The guest's linear memory grew past the cap.
    ///
    /// The cap bounds the guest's **whole** linear memory — the language runtime the program runs
    /// in as well as the program's own data. That is documentation rather than an error, so it is
    /// stated here and in the [sandbox limits](super::limits) rather than in the message, which
    /// carries the cap and nothing else.
    #[error("{}", with_guest_stderr(
        format!("the program exceeded its {limit}-byte memory cap"),
        said,
    ))]
    OutOfMemory {
        /// The cap that was exceeded, in bytes.
        limit: usize,
        /// What the guest wrote to standard error before it was stopped, empty when it wrote
        /// nothing. It is rendered in FRONT of the sentence above, for the reason the module's
        /// `with_guest_stderr` gives.
        said: String,
    },
    /// The guest trapped for some other reason.
    ///
    /// On the arms with no exception mechanism reaching the host (Rust, Swift, Kotlin, Java) this
    /// is where an **ordinary uncaught throw** arrives, because the program died the way its
    /// runtime killed it and said what it had to say on standard error rather than over
    /// `feedback`. What the model reads is unaffected — it is the runtime's own words either way —
    /// but the turn is recorded as [`SandboxTrap`](TurnErrorType::SandboxTrap); see
    /// [`ProgramErrorKind::turn_error_type`]. A guest that CAN report a throw must, so on every
    /// other arm this is a real trap — an exit, a native fault the runtime never saw — and never an
    /// API failure a program did not catch.
    ///
    /// An explicit `exit` is one of them, and it is **named** rather than being left to a wasm
    /// backtrace — see the classifier's `exit_message`. It shares this variant rather than getting
    /// one of its own because a recordable variant is one-to-one with a
    /// [turn error type](Self::turn_error_type), and that is a type the run record **publishes**:
    /// minting `sandbox_exit` is a contract change, and it is made in the documentation first.
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

/// What the guest said about itself, in front of gg's account of what happened to it.
///
/// The order is the point. On a guest with an exception mechanism gg's account is the whole story,
/// because a throw was caught, reported and never became a trap. On one without — the
/// [Swift](super::language::swift) arm, where an index out of range, a force-unwrapped `nil` and a
/// `fatalError` are all unrecoverable by design — the *only* description of the failure is the line
/// the runtime wrote to stderr on its way down, and burying it under a wasm backtrace, or under a
/// sentence about a ceiling, would be showing a model the machinery instead of the fault.
///
/// It lives here rather than beside the classifier because both renderers need it: the classifier
/// composes the message an unclassified failure carries, and the two ceilings above render their own
/// in [`Display`](std::fmt::Display), so a guest that spoke on its way down is heard on every path.
pub(super) fn with_guest_stderr(error: String, said: &str) -> String {
    match said.is_empty() {
        true => error,
        false => format!("{said}\n\n{error}"),
    }
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
    /// Disjoint from [`is_artifact_defect`](Self::is_artifact_defect),
    /// [`is_lowering_defect`](Self::is_lowering_defect) and
    /// [`is_toolchain_defect`](Self::is_toolchain_defect) by construction: the four answer "whose
    /// failure was it?" for different owners, and a variant that answered two of them would leave
    /// the loop's classification ambiguous.
    /// `every_sandbox_failure_maps_to_exactly_one_turn_disposition` is what keeps that true as
    /// variants are added.
    pub fn is_host_fault(&self) -> bool {
        matches!(self, Self::Engine(_) | Self::Host(_))
    }

    /// Whether this failure is gg's own **preparation** of the model's program —
    /// [`Lowering`](Self::Lowering), and nothing else.
    ///
    /// Held apart from [`is_host_fault`](Self::is_host_fault) although both are gg's and both end
    /// the run, because they are found in different places and read differently in a bug report: a
    /// host fault is the machinery *around* the guest (the engine, the blocking task), while this is
    /// the pipeline that turns a model's reply into something to run. Pooling them would say "gg
    /// broke" where the two halves of gg that can break are debugged by different people.
    pub fn is_lowering_defect(&self) -> bool {
        matches!(self, Self::Lowering(_))
    }

    /// Whether this failure is the language's **compiler** rather than anything the model did —
    /// [`Toolchain`](Self::Toolchain), and nothing else.
    ///
    /// Held apart from the three predicates above it although all four are gg's and all four end
    /// the run, because this is the only one an operator fixes without touching gg's source: it is
    /// the run's image that is wrong, so a bug report about it goes somewhere else entirely.
    pub fn is_toolchain_defect(&self) -> bool {
        matches!(self, Self::Toolchain(_))
    }

    /// The [turn error type](TurnErrorType) this failure is recorded as, for the variants the run
    /// carries on from — everything the four predicates above do not claim.
    ///
    /// `None` for [`Engine`](Self::Engine)/[`Host`](Self::Host),
    /// [`Compile`](Self::Compile)/[`Instantiate`](Self::Instantiate),
    /// [`Lowering`](Self::Lowering) and [`Toolchain`](Self::Toolchain), which end the run as fatal
    /// and are never charged to the model's error budget, so they have no turn error type at all.
    /// `Some` for the other four, and
    /// exhaustive rather than a catch-all: the turn loop used to reach the sandbox ceilings through
    /// an `Err(_)` arm that never looked at the variant, so a timeout, an out-of-memory and a trap
    /// were one indistinguishable bucket. Adding a variant now has to say which it is.
    ///
    /// `every_sandbox_failure_maps_to_exactly_one_turn_disposition` is what keeps this and the four
    /// predicates a partition.
    pub fn turn_error_type(&self) -> Option<TurnErrorType> {
        match self {
            Self::Prepare(prepare) => Some(prepare.turn_error_type()),
            Self::Timeout { .. } => Some(TurnErrorType::SandboxTimeout),
            Self::OutOfMemory { .. } => Some(TurnErrorType::SandboxOutOfMemory),
            Self::Trap(_) => Some(TurnErrorType::SandboxTrap),
            Self::Toolchain(_)
            | Self::Lowering(_)
            | Self::Engine(_)
            | Self::Host(_)
            | Self::Compile(_)
            | Self::Instantiate(_) => None,
        }
    }
}

impl From<PrepareFailure> for SandboxError {
    /// Split a [prepare failure](PrepareFailure) into the three sandbox failures it is: the model's
    /// program, the compiler that was supposed to read it, or gg's own preparation of it.
    ///
    /// The one conversion between the two taxonomies, so the split cannot be made differently at two
    /// call sites — and so the seam's own vocabulary (`Program`/`Toolchain`/`Lowering`, which is what
    /// a language implementer thinks in) stays separate from the loop's, which is what a turn is
    /// judged by.
    fn from(failure: PrepareFailure) -> Self {
        match failure {
            PrepareFailure::Program(error) => Self::Prepare(error),
            PrepareFailure::Toolchain(detail) => Self::Toolchain(detail),
            PrepareFailure::Lowering(detail) => Self::Lowering(detail),
        }
    }
}
