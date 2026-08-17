//! **Execution limits** — the five ceilings a gg run is bounded by, the single definition of a
//! failed turn that every one of them counts, and the run-wide spend the cost ceiling is measured
//! against.
//!
//! # The rule
//!
//! > **A turn is an error when the work the turn declared could not be carried out as declared.**
//! > A failure *inside* a turn that was reported back to the model, and that left the rest of the
//! > turn's work intact, is not a turn error.
//!
//! That sentence is deliberately about the turn's *declared work* rather than "did anything go
//! wrong", because the entire premise of
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) is that a program
//! *expects* individual calls to fail and handles them: a tool call that failed inside a program
//! which carried on is the typed surface working, and counting it would make the one capability
//! that expects failures the one capability that cannot survive them. [`TurnOutcome`] is that rule
//! as a type, and [`TurnOutcome::is_error`] is the one place in this codebase that answers "was
//! that turn an error?" — there is no second, narrower notion of a failed turn anywhere.
//!
//! # The five ceilings
//!
//! | Ceiling | Accounted | Effect on breach | Terminal status |
//! | --- | --- | --- | --- |
//! | [`max_turns`](RunLimits::max_turns) | per agent | ends **that agent** | `exhausted` |
//! | [`max_runtime`](RunLimits::max_runtime) | run-wide (one shared instant) | ends **every agent** at its next boundary | `timed_out` |
//! | [`max_consecutive_errors`](RunLimits::max_consecutive_errors) | per agent | ends **that agent** | `limit_exceeded` |
//! | [`error_rate`](RunLimits::error_rate) | per agent | ends **that agent** | `limit_exceeded` |
//! | [`max_cost`](RunLimits::max_cost) | **run-wide** ([`RunSpend`]) | ends **every agent** at its next boundary | `limit_exceeded` |
//!
//! [`RunLimits`] carries one further ceiling that is **not** in that table and never ends a run:
//! [`replay_max_bytes`](RunLimits::replay_max_bytes) bounds the
//! [capture journal](crate::capture) that observes the run. It is resolved here because there is
//! one resolver for everything an operator can declare under `capabilitySet.limits`, not because
//! it is an execution ceiling.
//!
//! Every ceiling, the turn ceiling and the wall-clock budget included, has one home, one
//! [resolver](resolve_run_limits), one [breach record](test_cabinet_core::gg::GgLimitBreach) and
//! one aggregation facet, rather than two vocabularies that drift.
//!
//! The defaults catch a run that is *failing* without capping one that is merely *long*. gg's host
//! (The Test Cabinet) already enforces a wall-clock cap on every run, so the turn ceiling would
//! mostly just cut productive runs short and is **unbounded when unset**
//! ([`RunLimits::max_turns`] is `None`). What is armed
//! by default instead are the two error ceilings that end a run whose model has stopped making
//! progress: [`DEFAULT_MAX_CONSECUTIVE_ERRORS`] in a row, and an error rate above
//! [`DEFAULT_MAX_ERROR_RATE`] over the last [`DEFAULT_ERROR_RATE_WINDOW`] turns. Runtime and cost
//! stay off — the host owns the clock, and gg will not invent a spend ceiling nobody asked for. A
//! run whose model never recovers therefore still terminates, on an error ceiling rather than by
//! burning turns, while a run that keeps progressing is bounded only by the host's clock. What
//! makes the defaults honest rather than hidden is that the run records the ceilings that were
//! actually **in force** ([`GgSessionSummary::limits`](test_cabinet_core::gg::GgSessionSummary))
//! beside the breach, so "what ceiling was this run under?" is answerable for every run — including
//! one that declared nothing and ran under the defaults.
//!
//! # This module decides; the loop acts
//!
//! Nothing here ends a session, emits an event, writes a log line, or knows what an agent is beyond
//! its id. [`AgentLimits::record`] folds one turn's outcome in and hands back the breach it caused;
//! [`RunLimits::check_cost`] compares the shared [spend](RunSpend) against the ceiling. Acting on
//! either — the `warn` line, the `LimitExceeded` event, the `limit_exceeded` loop ending — belongs
//! to the turn loop, at its own turn boundary, where the turn's own state transitions have already
//! completed. That split is what makes every rule in here a microsecond-scale unit test with no
//! loop, no model, no wasm engine and no clock behind it.
//!
//! [`TurnOutcome::wire`] does not break that rule: it *names* this judgement in the contract's
//! published vocabulary, so the loop's one recording seam can put the same judgement the ceilings
//! act on onto the telemetry stream. Nothing here emits it; the mapping is a pure function, and it
//! is written out by hand precisely so that a rename on either side cannot travel silently to the
//! other.
//!
//! # Per agent, or run-wide
//!
//! The two error ceilings are **per agent**, and that is a correctness property rather than a
//! preference: "consecutive" and "the last N turns" are only definable within one agent's turn
//! sequence. gg's agents run concurrently on the subagent scheduler, their turns interleave
//! nondeterministically, and a run-wide consecutive counter would be counting a sequence that never
//! happened, with a value depending on thread scheduling — not a knob, a race. It is also
//! substantively right: a subagent's failures are its own, an issue may be dispatched to several
//! agents precisely so that some may fail, and a thrashing fix agent must not take the run down
//! with it.
//! [`AgentLimits`] is therefore owned outright by the agent whose turns it counts (`&mut self`, no
//! sharing, nothing to synchronise), and a breaching subagent ends *itself* while the run carries
//! on.
//!
//! [Cost](RunSpend) is **run-wide**, because every agent bills the same run and a per-agent cost
//! ceiling would be defeated by delegating. One [`RunSpend`] is shared by every agent: each adds its
//! turn's cost exactly once, at the same site it folds its own running total, and reads the shared
//! figure at its own turn boundary. Propagating a breach needs no cancellation machinery — N
//! independent readers of one value, each stopping itself, exactly as the run deadline already
//! works. The wind-down bound is one turn per agent, which is deliberate: a turn is the loop's
//! atomic unit, and interrupting one would leave a half-applied tool batch behind and, on an
//! OpenAI-shaped provider, an assistant `tool_calls` message with no `tool` message answering it.

use std::collections::VecDeque;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;

use test_cabinet_core::gg::{
    GgCapabilitySet, GgLimitBreach, GgLimitKind, GgRunLimits, GgTurnErrorKind, GgTurnErrorType,
    GgTurnOutcome,
};
use test_cabinet_core::metrics::Cost;

// ---------------------------------------------------------------------------------------------
// The turn-outcome taxonomy
// ---------------------------------------------------------------------------------------------

/// What one turn of an agent's loop amounted to — the **single** definition of a turn error, used
/// by every [execution ceiling](RunLimits), in both execution modes.
///
/// A turn is an error when the work it *declared* could not be carried out as declared. A failure
/// **inside** a turn that was reported back to the model, and that left the rest of the turn's work
/// intact, is not one: a tool call that failed inside an otherwise successful program is the typed
/// surface working, not the turn failing, and counting it would make the one capability that
/// expects failures the one capability that cannot survive them.
///
/// Every turn of every agent records exactly one of these — including the turn that ends the
/// session and the turn that ends it fatally — so the accounting can never drift from the number of
/// model calls the run made, and `turns_recorded` can be pinned against the loop's own reported
/// turn count for a run ending any of the five ways.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnOutcome {
    /// The turn did what its protocol asks: a program that ran to a value (however its individual
    /// calls went), or a tool-calling turn whose requested calls were dispatched and answered.
    ///
    /// The **only** outcome that clears the [consecutive-error](RunLimits::max_consecutive_errors)
    /// count, because a turn is the unit of that ceiling and only a turn that carried out its
    /// declared work is evidence the agent recovered.
    Progressed,
    /// The turn ended the session — a program called `finish`, or a tool-calling turn requested no
    /// tools. Terminal, and never an error: a session that ends on purpose has not failed.
    Finished,
    /// The turn's declared work could not be carried out as declared.
    ///
    /// It carries the **specific** [type](TurnErrorType), not the base [kind](TurnErrorKind), and
    /// that is the whole enforcement mechanism behind "every error is attributable": the base is
    /// derived from the type ([`TurnErrorType::kind`]), so a site that records an error cannot omit
    /// the specific reason — there is no constructor that takes only the coarse one. Making the
    /// type an optional second argument instead would let every future error site quietly produce
    /// an untyped error, which is precisely the defect this taxonomy exists to fix.
    Error(TurnErrorType),
    /// gg's own machinery failed, so the session ends on the first occurrence.
    ///
    /// Recorded rather than skipped, so the accounting never drifts from the number of model calls
    /// the run made — and kept **apart** from [`Error`](Self::Error) so gg's defects are never
    /// charged to the model's error budget. No ceiling ever observes two of these, because the run
    /// ends on the first.
    Fatal(FatalFault),
}

impl TurnOutcome {
    /// Whether this outcome counts towards the [error ceilings](RunLimits). Exactly
    /// [`Error`](Self::Error) — the one place in the codebase that answers this question.
    pub fn is_error(self) -> bool {
        matches!(self, Self::Error(_))
    }

    /// Whether this outcome ends the session whatever the ceilings say — the two terminal
    /// outcomes, which are therefore recorded but never allowed to breach.
    ///
    /// Attributing a ceiling to a run that ended on purpose, or to one gg's own machinery ended,
    /// would be a lie in the one field a study reads to find out why runs stop.
    fn is_terminal(self) -> bool {
        matches!(self, Self::Finished | Self::Fatal(_))
    }

    /// This outcome as the contract publishes it: the
    /// [wire outcome](test_cabinet_core::gg::GgTurnOutcome) and, on an error, the
    /// [wire kind](test_cabinet_core::gg::GgTurnErrorKind) and the
    /// [wire type](test_cabinet_core::gg::GgTurnErrorType) that say how.
    ///
    /// Returned as one triple rather than three accessors so the pairing is unrepresentably wrong:
    /// the contract states that `error != null`, `errorType != null` and `outcome == "error"` are
    /// one statement, and that the type's base *is* the kind — a caller that could ask for the
    /// parts separately could publish an error with no kind, a kind on a turn that progressed, or a
    /// type whose base contradicts the kind beside it. All three come from one value here.
    ///
    /// Written out by hand rather than derived through a `From`, and deliberately so: gg's enum is
    /// the loop's internal vocabulary and the contract's is a **published** wire value read by the
    /// console, the query language and every stored run. A conversion that made them
    /// interchangeable would let a rename on either side travel silently to the other; this way,
    /// adding an outcome here is a decision to publish it there. The same reasoning — and the same
    /// shape — as `wire_strategy` on the healing side.
    ///
    /// [`Fatal`](Self::Fatal)'s [fault](FatalFault) is deliberately dropped: the contract's
    /// `fatal` says the session ended on gg's own machinery, which is the fact a study slices on,
    /// and *which* piece of gg's machinery broke is a defect report the `error` log already carries
    /// in full sentences.
    pub fn wire(
        self,
    ) -> (
        GgTurnOutcome,
        Option<GgTurnErrorKind>,
        Option<GgTurnErrorType>,
    ) {
        match self {
            Self::Progressed => (GgTurnOutcome::Progressed, None, None),
            Self::Finished => (GgTurnOutcome::Finished, None, None),
            Self::Error(error) => (
                GgTurnOutcome::Error,
                Some(error.kind().wire()),
                Some(error.wire()),
            ),
            Self::Fatal(_) => (GgTurnOutcome::Fatal, None, None),
        }
    }
}

/// Why a turn was an error, at the **base** level — a failure attributable to the model's turn.
///
/// The coarse half of gg's two-level error taxonomy: *whose layer* failed. It is the ceilings' and
/// the breach log's vocabulary, and it is what [`TurnErrorType::kind`] derives — a
/// [`TurnOutcome::Error`] never carries one of these directly, so this type is only ever read, never
/// constructed at an error site.
///
/// Carried for diagnosis and for the breach log line; the ceilings themselves count errors without
/// distinguishing kinds, because a run that alternates between six ways of failing is not
/// healthier than one that fails the same way six times.
///
/// Three of the five — [`Transpile`](Self::Transpile), [`ProgramFault`](Self::ProgramFault) and
/// [`SandboxLimit`](Self::SandboxLimit) — are
/// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)
/// shapes, and that asymmetry is largely real rather than an oversight: a tool-calling turn whose
/// requested calls are all dispatched and answered cannot declare work that is cut short. The one
/// tool-calling error shape besides [`ModelApi`](Self::ModelApi) is
/// [`MissingCompletion`](Self::MissingCompletion) — a turn that ends without calling `finish`,
/// which every agent must, because [ending a session](crate::completion) is always an explicit
/// call and never configurable — which exists precisely so a model that loops emitting prose
/// trips the run's error ceilings instead of running to its turn budget. The counting machinery is
/// mode-agnostic; the error *shapes* are not, because the protocols are not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnErrorKind {
    /// The model call itself failed, after the [client](crate::client) had already exhausted its
    /// own retry/backoff budget. No turn happened at all.
    ///
    /// Named here so the definition of a turn error stays whole, **not** because a ceiling ever
    /// gets to observe two of them: a `ModelError` reaching the loop means the provider failed
    /// every attempt within one turn, the fatal kinds recur identically, and a rejected credential
    /// ends the agent that hit it — it is one of the two non-launch statuses (the other being a gg
    /// defect) that exit the process non-zero off the root's ending. Making model-API errors
    /// survivable is a change to gg's model-error policy and would be designed as one.
    ModelApi,
    /// The program could not be prepared for its guest — a syntax error, a module feature the
    /// [sandbox](crate::sandbox) has no implementation of, or a program past the size/nesting
    /// guards. Nothing ran. Named for the type-strip it once was, because the wire value is
    /// contract-visible; see [`GgTurnErrorKind::Transpile`].
    Transpile,
    /// The program ran and threw an uncaught fault, so every statement after the throw never ran
    /// and the model must re-declare the remainder.
    ProgramFault,
    /// The [sandbox](crate::sandbox) stopped the program at a ceiling — the execution timeout or
    /// memory, or the guest trapped. The program ran and its landed calls stand, but the work it
    /// declared was cut short.
    ///
    /// This **is** an error, unlike under the counter it replaces, and the change is deliberate:
    /// the declared work did not complete and the model must re-declare it. Nothing is lost by
    /// dropping the old exemption, because the case that exemption protected — a program that is
    /// mostly working and occasionally too big — is exactly what [`error_rate`](RunLimits::error_rate)
    /// expresses and a consecutive counter cannot, which is *why* it needed an exemption at all.
    SandboxLimit,
    /// A tool-calling turn ended with no tool call. [Ending a session](crate::completion) is always
    /// an explicit call, so a text-only reply is not a completion but a failure to end the run the
    /// one way gg allows. Counted as an error so a model that keeps replying in prose instead of calling
    /// `finish` trips the run's [error ceilings](RunLimits) and stops early. The only tool-calling
    /// error shape besides [`ModelApi`](Self::ModelApi).
    MissingCompletion,
}

impl TurnErrorKind {
    /// This kind as the contract publishes it — written out by hand, for the reason
    /// [`TurnOutcome::wire`] gives.
    ///
    /// The two base taxonomies are one-to-one today, and the contract carries no sixth kind for a
    /// reply abandoned by [loop detection](crate::loopguard): a discarded attempt is retried rather
    /// than counted, and a loop that survives every attempt reaches the turn loop as a model-client
    /// failure after that client exhausted its own retry budget, which is a
    /// [`ModelApi`](Self::ModelApi) failure at this level. It is *not* lost, though — it is
    /// published one level down, as
    /// [`ModelResponseLoop`](test_cabinet_core::gg::GgTurnErrorType::ModelResponseLoop). The
    /// attempts it discarded on the way are published in their own right besides, on the
    /// [`loop_aborts`](test_cabinet_core::gg::GgTelemetryKind::TurnOutcome) field of the same event.
    pub fn wire(self) -> GgTurnErrorKind {
        match self {
            Self::ModelApi => GgTurnErrorKind::ModelApi,
            Self::Transpile => GgTurnErrorKind::Transpile,
            Self::ProgramFault => GgTurnErrorKind::ProgramFault,
            Self::SandboxLimit => GgTurnErrorKind::SandboxLimit,
            Self::MissingCompletion => GgTurnErrorKind::MissingCompletion,
        }
    }
}

/// Why a turn was an error, **specifically** — the leaf of gg's two-level error taxonomy, and the
/// value every error site in the loop actually records.
///
/// Each variant is a distinction gg already has in hand at the moment it records the turn: which
/// `ModelError` the client returned, which `PrepareError` the language raised, which ceiling the
/// sandbox enforced, which class the guest typed an uncaught throw with, and which of the two "no
/// work declared" shapes the turn was. Nothing here needs new information to be computed.
///
/// One-to-one with the contract's [`GgTurnErrorType`], and converted by hand
/// ([`wire`](Self::wire)) for the reason [`TurnOutcome::wire`] gives: gg's vocabulary and the
/// published one must not become interchangeable, so adding a type here is a decision to publish it
/// there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnErrorType {
    /// The run's credential was refused — no key in the environment, or a `401`/`403`.
    ModelAuth,
    /// The provider rejected the request for another non-retryable reason.
    ModelRejected,
    /// The client retried a transient condition to its policy and every attempt failed.
    ModelRetryExhausted,
    /// Every attempt was a [generation loop](crate::loopguard) and was discarded.
    ModelResponseLoop,
    /// The model cannot accept an image the request carried, and there was nothing left to strip.
    ModelVisionUnsupported,
    /// A successful response could not be parsed into a reply.
    ModelParse,
    /// The program is not valid source in its language.
    TranspileSyntax,
    /// The language's compiler read the whole program and rejected it — a type error, a borrow
    /// error, a name that does not resolve.
    TranspileCompile,
    /// The program asks for something the sandbox will not run it with.
    TranspileUnsupported,
    /// The program's uncaught throw was a **failed call** — one the membrane serviced and the tool
    /// rejected, or refused for any reason other than the run not offering it.
    ProgramToolError,
    /// The program reached for something this run does not offer it: a name that was never in
    /// scope, or a call the membrane refused `unavailable`.
    ProgramUnknownName,
    /// The program threw for any other reason.
    ProgramThrow,
    /// The sandbox stopped the program at its execution timeout.
    SandboxTimeout,
    /// The guest's linear memory grew past its cap.
    SandboxOutOfMemory,
    /// The guest trapped for some other reason.
    SandboxTrap,
    /// A tool-calling turn ended with no call under an explicit-call completion signal.
    MissingCompletionNoCall,
    /// A turn replied with no call while a compaction was pending.
    MissingCompletionCompaction,
}

impl TurnErrorType {
    /// The [base kind](TurnErrorKind) this type falls under — the value the ceilings, the breach log
    /// and the run's per-kind counters read.
    ///
    /// Exhaustive and hand-written, so a type added here has to declare its base rather than
    /// defaulting into one.
    pub fn kind(self) -> TurnErrorKind {
        match self {
            Self::ModelAuth
            | Self::ModelRejected
            | Self::ModelRetryExhausted
            | Self::ModelResponseLoop
            | Self::ModelVisionUnsupported
            | Self::ModelParse => TurnErrorKind::ModelApi,
            Self::TranspileSyntax | Self::TranspileCompile | Self::TranspileUnsupported => {
                TurnErrorKind::Transpile
            }
            Self::ProgramToolError | Self::ProgramUnknownName | Self::ProgramThrow => {
                TurnErrorKind::ProgramFault
            }
            Self::SandboxTimeout | Self::SandboxOutOfMemory | Self::SandboxTrap => {
                TurnErrorKind::SandboxLimit
            }
            Self::MissingCompletionNoCall | Self::MissingCompletionCompaction => {
                TurnErrorKind::MissingCompletion
            }
        }
    }

    /// This type as the contract publishes it — written out by hand, for the reason
    /// [`TurnOutcome::wire`] gives.
    pub fn wire(self) -> GgTurnErrorType {
        match self {
            Self::ModelAuth => GgTurnErrorType::ModelAuth,
            Self::ModelRejected => GgTurnErrorType::ModelRejected,
            Self::ModelRetryExhausted => GgTurnErrorType::ModelRetryExhausted,
            Self::ModelResponseLoop => GgTurnErrorType::ModelResponseLoop,
            Self::ModelVisionUnsupported => GgTurnErrorType::ModelVisionUnsupported,
            Self::ModelParse => GgTurnErrorType::ModelParse,
            Self::TranspileSyntax => GgTurnErrorType::TranspileSyntax,
            Self::TranspileCompile => GgTurnErrorType::TranspileCompile,
            Self::TranspileUnsupported => GgTurnErrorType::TranspileUnsupported,
            Self::ProgramToolError => GgTurnErrorType::ProgramToolError,
            Self::ProgramUnknownName => GgTurnErrorType::ProgramUnknownName,
            Self::ProgramThrow => GgTurnErrorType::ProgramThrow,
            Self::SandboxTimeout => GgTurnErrorType::SandboxTimeout,
            Self::SandboxOutOfMemory => GgTurnErrorType::SandboxOutOfMemory,
            Self::SandboxTrap => GgTurnErrorType::SandboxTrap,
            Self::MissingCompletionNoCall => GgTurnErrorType::MissingCompletionNoCall,
            Self::MissingCompletionCompaction => GgTurnErrorType::MissingCompletionCompaction,
        }
    }

    /// The phrase this type is named by in gg's own `error` log line.
    ///
    /// Derived from the published [label](GgTurnErrorType::label) rather than written a second time
    /// here, so the sentence an operator reads in the log and the row they read in the console
    /// cannot describe one failure two different ways — which is exactly what happened while the
    /// log line was the *only* place the distinction existed.
    pub fn phrase(self) -> &'static str {
        self.wire().label()
    }
}

/// A failure of gg's own machinery, which ends the **run** rather than costing the model a turn.
///
/// gg's defect is kept off the model in both of the places a run is read from: none of these is
/// ever counted against an [error ceiling](RunLimits), and the terminal status the loop ends on is
/// gg's own `internal_error` rather than `model_error`. Filing it as the model's would be the same
/// misattribution the `auth_error` status exists to prevent, and this one is worse for being
/// invisible: a run recorded as a model error is scored as one.
///
/// The **whole run** ends, and not only the agent the fault landed on — which matters here more
/// than at any other site, because a host fault strikes whichever agent happened to be taking a
/// turn and there are more subagents than roots. A run that carried on around one would hand back
/// a tree with work missing from it and no way to tell, which is the same misattribution one level
/// down. See [gg's fault latch](crate::fault).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FatalFault {
    /// The committed sandbox component could not be compiled or instantiated — artifact drift
    /// between `crates/gg/wit/gg-sandbox.wit` and the committed `.wasm`.
    ArtifactDefect,
    /// gg's own plumbing failed: the wasm engine could not be configured or linked, or the
    /// sandbox's blocking task did not complete.
    HostFault,
    /// gg could not prepare a program its language had already accepted: the transform over the
    /// parsed source failed, or the surface gg generated for the model to write against was itself
    /// rejected. See [`SandboxError::Lowering`](crate::sandbox::SandboxError::Lowering).
    ///
    /// The one fatal fault that arrives wearing a compiler's clothes, and the reason it is named
    /// here rather than folded into [`HostFault`](Self::HostFault): it was recorded as a
    /// `transpile_lowering` **turn error** until this taxonomy was taken at its word, which put gg's
    /// bug in the model's error record, counted it against the model's ceilings, and handed the
    /// model gg's diagnostic to rewrite a correct program against.
    Lowering,
    /// The [program language](crate::sandbox::ProgramLanguage)'s **compiler could not finish**: it
    /// crashed, its own timeout killed it, or the binary is not installed in the run's image. See
    /// [`SandboxError::Toolchain`](crate::sandbox::SandboxError::Toolchain).
    ///
    /// **The widest-reaching reading of "a defect of gg's is gg's", and the one to revisit first.**
    /// A compiler that fell over on one program may well compile the next, so this ends runs a
    /// retried turn would have rescued. It is gg's nonetheless: from the model's side a compiler
    /// gg's image never installed and a compiler it installed that then crashed are one event —
    /// the model answered and nothing read the answer. Feeding that back asks a model to fix an
    /// environment it cannot see, and counting it against the ceilings lets gg's own image end a
    /// run under `limit_exceeded` with the model's name on it.
    ///
    /// The same failure reaches gg through a second door, the code a [skill](crate::skills) or
    /// [memory](crate::memories) carries, and is fatal there for the same reason.
    Toolchain,
    /// gg had **already** broken when this turn's failure was judged: the run's
    /// [fault latch](crate::fault) was raised while the turn was in flight, so what the turn
    /// recorded is a consequence of a defect gg had already met rather than a fault of the model's.
    ///
    /// The other four name *what* broke; this one names *when*, and it exists because a gg defect
    /// does not only end a turn — it can also **fail** one. A call gg refuses because gg is broken
    /// throws into the program that made it, and an uncaught throw is a `program_fault` turn error
    /// unless the latch is read before the outcome is recorded. Every turn is judged against the
    /// latch at the single seam that records it, so no error site has to remember to do it.
    ///
    /// A turn that would have failed anyway is recorded under this too, when the two coincide. That
    /// is the right way round: a run gg broke in is not a measurement, so the fact that
    /// disqualifies it is the fact to record, and over-attributing on a run that is already
    /// discarded costs nothing while under-attributing puts gg's defect in the model's column.
    RunBroken,
}

// ---------------------------------------------------------------------------------------------
// The resolved ceilings
// ---------------------------------------------------------------------------------------------

/// The consecutive-error ceiling armed when a run declares none.
///
/// One of the two error ceilings gg arms by default (see the [module docs](self)): a run whose
/// model fails this many turns in a row has stopped making progress and is ended rather than left
/// to run to the host's clock. It is not a hidden default — the resolved value is recorded on the
/// run's session summary, so a run bounded by it says so.
pub const DEFAULT_MAX_CONSECUTIVE_ERRORS: u32 = 5;

/// The error rate armed when a run declares neither half of the error-rate ceiling.
///
/// Paired with [`DEFAULT_ERROR_RATE_WINDOW`]: a run whose recent turns are more than this fraction
/// errors has stopped making progress. Recorded on the session summary like every other default.
pub const DEFAULT_MAX_ERROR_RATE: f64 = 0.4;

/// The lookback the default [error rate](DEFAULT_MAX_ERROR_RATE) is measured over — and, as ever,
/// the minimum sample, so the default ceiling cannot fire before an agent's fiftieth turn.
pub const DEFAULT_ERROR_RATE_WINDOW: usize = 50;

/// The per-run ceiling on the [session capture journal](crate::capture) when a run declares none:
/// **256 MiB**.
///
/// Sized to be unreachable by any run that is behaving, and reachable by one that is not. A pooled
/// record of a 200-turn session projects to a few megabytes, so this is roughly two orders of
/// magnitude of headroom; what it actually bounds is the pathological case — a model that keeps
/// producing megabytes of distinct output — where the alternative is a journal that fills the run
/// container's disk and takes the run down with it. Capture is the thing that gives way, never the
/// run: crossing the ceiling stops capture and marks the record
/// [truncated](test_cabinet_core::gg_session_record::GgSessionTruncationReason::ByteCeiling).
pub const DEFAULT_REPLAY_MAX_BYTES: u64 = 256 * 1024 * 1024;

/// The resolved [execution ceilings](test_cabinet_core::gg::GgRunLimits) one run is bounded by.
///
/// The turn ceiling and the two error ceilings carry gg's [defaults](self) when the run declared
/// nothing; runtime and cost are `None` when the run declared nothing usable, and `None` there
/// means the ceiling is **off**. `Copy`, because a resolved ceiling set is five scalars that every
/// agent enforces identically and none of them mutates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RunLimits {
    /// The per-agent turn ceiling, or `None` for **unbounded** — the default when the set declares
    /// none, because the host caps a run's wall-clock and a turn ceiling armed as a backstop mostly
    /// cuts productive runs short.
    pub max_turns: Option<usize>,
    /// The run's wall-clock budget, when configured. Run-wide: every agent measures it against the
    /// same session-start instant, so it ends the run rather than one agent.
    pub max_runtime: Option<Duration>,
    /// How many error turns in a row end an agent, when configured.
    pub max_consecutive_errors: Option<u32>,
    /// The recent-error-rate ceiling and the window it is measured over, when **both** are
    /// configured — either alone resolves to `None` and a startup warning.
    pub error_rate: Option<ErrorRateLimit>,
    /// The run's accumulated-cost ceiling, when configured. Measured against the run-wide
    /// [spend](RunSpend), never against one agent's share of it.
    pub max_cost: Option<f64>,
    /// The per-run byte ceiling on the [session capture journal](crate::capture), defaulting to
    /// [`DEFAULT_REPLAY_MAX_BYTES`]. `None` is *unbounded* capture, and no declaration produces it:
    /// there is no spelling of "no journal ceiling", because capture is on for every run and a run
    /// that wanted an unbounded journal is a run that wanted to fill its own disk. The `Option`
    /// stays for the [journal](crate::capture)'s own sake, which is written against one.
    ///
    /// Resolved here because there is one resolver and one declaration site for
    /// every ceiling gg reads — but it is deliberately **absent from
    /// [`armed_summary`](RunLimits::armed_summary)**, which names the ceilings that can end a run.
    /// This one ends only the recording of one.
    pub replay_max_bytes: Option<u64>,
}

/// A recent-error-rate ceiling and the lookback it is measured over.
///
/// One type because neither half is meaningful alone, so the loop cannot hold a half-configured
/// one: a rate with no window has nothing to measure over, and a window with no rate has no
/// threshold to be judged against.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ErrorRateLimit {
    /// The fraction of the window that may be errors, in `0.0..=1.0`. Breached only **strictly
    /// above** this value, matching "more than X%": at `0.5` over a window of ten, five errors is
    /// not a breach and six is. `0.0` is legal and means "any error at all, once the window is
    /// full".
    pub max_rate: f64,
    /// How many of an agent's most recent turns the rate is measured over — and, deliberately, the
    /// minimum sample: the ceiling cannot fire until the agent has recorded this many outcomes, so
    /// one number does both jobs and there is no second fudge factor.
    ///
    /// The property that follows is exactly this and no more: **the earliest turn this ceiling can
    /// stop a run on is turn `window`**. At `10` a run cannot die before its tenth turn; at `1` the
    /// declaration says "stop on any error", which is a legitimate thing to configure and behaves
    /// as written.
    pub window: usize,
}

impl RunLimits {
    /// Whether the run's accumulated [spend](RunSpend) has reached the cost ceiling, and the
    /// [breach](GgLimitBreach) to stop `agent_id` on if it has.
    ///
    /// Checked by each agent **at its own turn boundary, before the next model call**, on exactly
    /// the same terms as the run deadline — one rule, two run-wide ceilings. Three consequences,
    /// stated plainly because they are the whole content of the decision:
    ///
    /// 1. the turn that crosses the line **completes in full** (gg has already paid for that
    ///    response, and discarding it would waste the money *and* abandon work the model asked
    ///    for), so this is a ceiling on **starting new work**, not a hard cap on spend;
    /// 2. the run's final recorded cost therefore *exceeds* the threshold, by at most one turn's
    ///    cost per concurrently running agent — which is why [`observed`](GgLimitBreach::observed)
    ///    carries the spend already accumulated rather than the threshold; and
    /// 3. a run whose model reports no cost accumulates `None` and can **never** be cost-limited.
    ///    That is correct rather than a gap: gg will not invent a figure to stop a run with.
    ///
    /// Free of the loop entirely, so the before/after decision is unit-tested without a model.
    pub fn check_cost(
        &self,
        spend: &RunSpend,
        agent_id: &str,
        turns: u64,
    ) -> Option<GgLimitBreach> {
        let threshold = self.max_cost?;
        let observed = spend.charged()?;
        (observed >= threshold).then(|| GgLimitBreach {
            limit: GgLimitKind::Cost,
            threshold,
            observed,
            turns,
            agent_id: agent_id.to_string(),
            window: None,
        })
    }

    /// The one `info` line a run logs at launch, naming every **execution** ceiling actually in
    /// force — the ones that can end the run. The
    /// [journal ceiling](Self::replay_max_bytes) is deliberately not among them: it bounds the
    /// journal that observes the run, and reporting it here would tell an operator reading "why
    /// might this run stop early?" about something that cannot stop it.
    ///
    /// Emitted even when nothing is armed at all — a run bounded only by the host's clock is exactly
    /// as much a fact about the configuration as a list of ceilings is, and a study reading the
    /// operator log should not have to infer it from silence.
    pub fn armed_summary(&self) -> String {
        let mut armed = Vec::new();
        // The turn ceiling reads first when set; when unbounded (the default) it simply contributes
        // nothing, because the host's clock — not a turn count — is what bounds the run.
        if let Some(max) = self.max_turns {
            armed.push(format!("{max} turns"));
        }
        if let Some(runtime) = self.max_runtime {
            armed.push(format!("{}s of runtime", runtime.as_secs()));
        }
        if let Some(max) = self.max_consecutive_errors {
            armed.push(format!("{max} consecutive errors"));
        }
        if let Some(rate) = self.error_rate {
            armed.push(format!(
                "an error rate above {} over the last {} turns",
                rate.max_rate, rate.window
            ));
        }
        if let Some(max) = self.max_cost {
            armed.push(format!("${max} of cost"));
        }

        if armed.is_empty() {
            return "no execution ceiling is armed; the run is bounded only by the host's clock"
                .to_string();
        }
        format!("execution ceilings in force: {}", armed.join(", "))
    }
}

/// The `limits` key naming the [turn ceiling](RunLimits::max_turns).
pub(crate) const LIMIT_MAX_TURNS: &str = "maxTurns";

/// The `limits` key naming the [wall-clock budget](RunLimits::max_runtime).
pub(crate) const LIMIT_MAX_RUNTIME_SECS: &str = "maxRuntimeSecs";

/// The `limits` key naming the [consecutive-error ceiling](RunLimits::max_consecutive_errors).
pub(crate) const LIMIT_MAX_CONSECUTIVE_ERRORS: &str = "maxConsecutiveErrors";

/// The `limits` key naming the [error-rate ceiling](ErrorRateLimit::max_rate).
pub(crate) const LIMIT_MAX_ERROR_RATE: &str = "maxErrorRate";

/// The `limits` key naming the [lookback](ErrorRateLimit::window) the rate is measured over.
pub(crate) const LIMIT_ERROR_RATE_WINDOW: &str = "errorRateWindow";

/// The `limits` key naming the [cost ceiling](RunLimits::max_cost).
pub(crate) const LIMIT_MAX_COST: &str = "maxCost";

/// The `limits` key naming the [capture-journal ceiling](RunLimits::replay_max_bytes).
pub(crate) const LIMIT_REPLAY_MAX_BYTES: &str = "replayMaxBytes";

/// Where one run-level ceiling sits in the configuration document: `limits.maxTurns`.
fn locus(key: &str) -> String {
    format!("limits.{key}")
}

/// **A run-level ceiling gg cannot arm as written**, reported against the key that carries it.
///
/// One constructor rather than seven inline ones so every ceiling's refusal is worded the same way:
/// the value as declared, what it would have meant, and — always — that gg is not going to run
/// under a different ceiling instead. That last clause is the whole point of the refusal: an
/// operator who wrote a ceiling believes the run is bounded, and the one thing worse than a run
/// that stops too early is one that quietly never stops.
fn unarmable(
    key: &str,
    found: impl fmt::Display,
    consequence: impl fmt::Display,
) -> crate::validate::LaunchDefect {
    crate::validate::LaunchDefect::run_level(
        locus(key),
        found.to_string(),
        format!(
            "{consequence}, so gg cannot arm the ceiling `{key}` declares. Omit the key to take \
             gg's default, or give it a value it can be bounded by."
        ),
    )
}

/// Resolve the run's ceilings from [`set.limits`](GgCapabilitySet::limits).
///
/// **Total**, and refusing rather than falling back: an absent key takes gg's
/// [default](self) silently, and a key that is *present* and cannot bound anything is reported to
/// `report` — which refuses the launch — rather than disarmed with a warning. The value this
/// function then returns for it no longer decides anything (the run is about to be refused); it
/// keeps the signature total for the mid-run callers described in the
/// [resolver contract](crate::validate#the-resolver-contract).
///
/// The rule and its reason: a ceiling is the one configuration whose failure mode is **silence**.
/// An operator who wrote `maxTurns` believes the run is bounded, so a `maxTurns` gg quietly dropped
/// leaves a run that behaves exactly like one nobody bounded — and behaves that way while burning
/// money, which is why this is the resolver the refusal policy was written for.
///
/// | Declaration | Resolves to |
/// | --- | --- |
/// | `limits` absent | turns unbounded, the two error ceilings at their [defaults](self), runtime and cost off |
/// | `maxTurns` absent | **unbounded** (no turn ceiling) |
/// | `maxRuntimeSecs` absent | no budget |
/// | `maxConsecutiveErrors` absent | [`DEFAULT_MAX_CONSECUTIVE_ERRORS`] |
/// | either error-rate half absent | that half at its default ([`DEFAULT_MAX_ERROR_RATE`], [`DEFAULT_ERROR_RATE_WINDOW`]) |
/// | `maxErrorRate: 0.0` | armed: any error at all, once the window is full |
/// | `replayMaxBytes` absent | [`DEFAULT_REPLAY_MAX_BYTES`] |
/// | `errorRateWindow >= maxTurns` (when a turn ceiling is set) | **armed as declared**, plus a warning |
/// | any ceiling declared `0` | **refused** |
/// | `maxErrorRate` outside `0.0..=1.0`, or not finite; `maxCost` ≤ 0 or not finite | **refused** |
/// | a count past what gg holds it in | **refused** |
///
/// `warnings` is what remains of the advisory channel: the one row above gg **honours exactly as
/// written** and still says something about. It is the caller's to emit, because this function is
/// pure and the launch line belongs on the root agent's stream.
pub fn resolve_run_limits(
    set: &GgCapabilitySet,
    report: &mut crate::validate::LaunchReport,
    warnings: &mut Vec<String>,
) -> RunLimits {
    let declared = set.limits;

    // Absent is unbounded — the host caps the wall-clock, so gg imposes no turn backstop unless a
    // study asks for one. Zero is not a second spelling of that: it is a ceiling nothing could run
    // under, and reading it as "unbounded" is reading a ceiling as its own opposite.
    let max_turns = match declared.max_turns {
        Some(0) => {
            report.report(unarmable(
                LIMIT_MAX_TURNS,
                0,
                "a run in which no agent may take a turn has nothing to do",
            ));
            None
        }
        Some(turns) => Some(narrow_usize(LIMIT_MAX_TURNS, turns, "turns", report)),
        None => None,
    };

    let max_runtime = match declared.max_runtime_secs {
        Some(0) => {
            report.report(unarmable(
                LIMIT_MAX_RUNTIME_SECS,
                0,
                "a budget of no seconds is spent before the run starts",
            ));
            None
        }
        Some(secs) => Some(Duration::from_secs(secs)),
        None => None,
    };

    let max_consecutive_errors = match declared.max_consecutive_errors {
        Some(0) => {
            report.report(unarmable(
                LIMIT_MAX_CONSECUTIVE_ERRORS,
                0,
                "it would end an agent before its first turn",
            ));
            None
        }
        Some(max) => Some(u32::try_from(max).unwrap_or_else(|_| {
            report.report(unarmable(
                LIMIT_MAX_CONSECUTIVE_ERRORS,
                max,
                format!(
                    "gg counts an agent's consecutive errors in a 32-bit number, so it cannot hold \
                     a ceiling above {}",
                    u32::MAX
                ),
            ));
            DEFAULT_MAX_CONSECUTIVE_ERRORS
        })),
        // Absent arms gg's default — one of the two error ceilings that end a stuck run.
        None => Some(DEFAULT_MAX_CONSECUTIVE_ERRORS),
    };

    let error_rate = resolve_error_rate(&declared, max_turns, report, warnings);

    let max_cost = match declared.max_cost {
        Some(max) if max.is_finite() && max > 0.0 => Some(max),
        Some(max) => {
            report.report(unarmable(
                LIMIT_MAX_COST,
                max,
                "a spend ceiling must be a finite figure greater than zero",
            ));
            None
        }
        None => None,
    };

    // The one ceiling here that bounds the *observation* of a run rather than the run. `0` is
    // treated exactly as `maxConsecutiveErrors: 0` is — a declaration that cannot bound anything —
    // rather than as "capture nothing", because a ceiling read as its own opposite is the kind of
    // silent inversion this resolver exists to prevent. There is deliberately no spelling of "no
    // journal ceiling": capture is on for every run, and a run that wanted an unbounded one is a
    // run that wanted to fill its own disk.
    let replay_max_bytes = match declared.replay_max_bytes {
        Some(0) => {
            report.report(unarmable(
                LIMIT_REPLAY_MAX_BYTES,
                0,
                "it would stop session capture before its first line",
            ));
            Some(DEFAULT_REPLAY_MAX_BYTES)
        }
        Some(max) => Some(max),
        None => Some(DEFAULT_REPLAY_MAX_BYTES),
    };

    RunLimits {
        max_turns,
        max_runtime,
        max_consecutive_errors,
        error_rate,
        max_cost,
        replay_max_bytes,
    }
}

/// Every run-level ceiling, read for the [launch pass](crate::validate::validate_launch) alone.
///
/// The ceilings themselves are resolved again by the orchestrator; this call exists so the pass
/// runs the same resolver over the same document with a **collecting** sink. The advisory warning
/// the resolution can produce is dropped here — the orchestrator emits it, once, on the root's
/// stream — because a launch pass reports what cannot be honoured and nothing else.
pub fn check_launch(set: &GgCapabilitySet, report: &mut crate::validate::LaunchReport) {
    resolve_run_limits(set, report, &mut Vec::new());
}

/// Narrow a declared count to this platform's `usize`, refusing one it cannot hold.
///
/// On every host gg runs on a `usize` is 64 bits wide and this can never fire. It is written as a
/// refusal rather than a saturation because the alternative is the shape this whole policy exists
/// to delete: a run bounded by a number nobody wrote, on a platform nobody checked.
fn narrow_usize(
    key: &str,
    value: u64,
    unit: &str,
    report: &mut crate::validate::LaunchReport,
) -> usize {
    usize::try_from(value).unwrap_or_else(|_| {
        report.report(unarmable(
            key,
            value,
            format!("this host cannot count that many {unit}"),
        ));
        usize::MAX
    })
}

/// Resolve the [error-rate ceiling](ErrorRateLimit) from its two halves, refusing every way they
/// can fail to describe one.
///
/// Each half is read **on its own terms**: a declared one is armed exactly as written, and an absent
/// one takes gg's [default](self) ([`DEFAULT_MAX_ERROR_RATE`], [`DEFAULT_ERROR_RATE_WINDOW`]). So a
/// set declaring neither arms both defaults, and a set declaring one arms that one over the other's
/// default — the same rule every other ceiling follows, and the only reading under which the
/// declared half is honoured as written. Filling the missing half in is not a fallback: nothing was
/// written there to substitute for.
///
/// Both halves are then judged, and **both** are reported when both are wrong: an operator fixing a
/// document wants the whole list, and a rate and a window are edited in the same place.
fn resolve_error_rate(
    declared: &GgRunLimits,
    max_turns: Option<usize>,
    report: &mut crate::validate::LaunchReport,
    warnings: &mut Vec<String>,
) -> Option<ErrorRateLimit> {
    let max_rate = declared.max_error_rate.unwrap_or(DEFAULT_MAX_ERROR_RATE);
    let window = declared
        .error_rate_window
        .unwrap_or(DEFAULT_ERROR_RATE_WINDOW as u64);

    let rate_ok = max_rate.is_finite() && (0.0..=1.0).contains(&max_rate);
    if !rate_ok {
        report.report(unarmable(
            LIMIT_MAX_ERROR_RATE,
            max_rate,
            "an error rate is a fraction of the window between 0.0 and 1.0, and this one could \
             never be exceeded",
        ));
    }

    let window = narrow_usize(LIMIT_ERROR_RATE_WINDOW, window, "turns", report);
    if window == 0 {
        report.report(unarmable(
            LIMIT_ERROR_RATE_WINDOW,
            0,
            "a window of no turns has nothing to measure",
        ));
    }
    if !rate_ok || window == 0 {
        return None;
    }
    // Warnable only about a window the operator **wrote**, and only against a turn ceiling that
    // exists. gg's own default window is not a declaration and has nothing to say about somebody
    // else's turn ceiling; and an unbounded run (the default) has no last turn for a window to be
    // pinned to, so an explicit window is always given room to fill.
    if let (Some(max_turns), Some(_)) = (max_turns, declared.error_rate_window)
        && window >= max_turns
    {
        warnings.push(format!(
            "errorRateWindow ({window}) is not smaller than the turn ceiling ({max_turns}), so the \
             error-rate ceiling can only ever fire on the run's last turn."
        ));
    }

    Some(ErrorRateLimit { max_rate, window })
}

// ---------------------------------------------------------------------------------------------
// Per-agent error accounting
// ---------------------------------------------------------------------------------------------

/// One agent's error accounting against the run's [ceilings](RunLimits).
///
/// Owned by the agent whose turns it counts and never shared, because both ceilings it enforces are
/// statements about *one* turn sequence (see the [module docs](self)). It holds no clock, no
/// emitter and no agent beyond the id it stamps a breach with.
pub struct AgentLimits {
    /// The ceilings this agent is judged against, resolved once for the whole run.
    limits: RunLimits,
    /// Error turns since the last turn that carried out its declared work.
    consecutive: u32,
    /// The last [`ErrorRateLimit::window`] turn outcomes, oldest first, each recorded as "was it an
    /// error?". Empty when no rate ceiling is configured, so an unconfigured run allocates nothing.
    window: VecDeque<bool>,
    /// How many of [`window`](Self::window) are errors, kept alongside it so the rate check is O(1)
    /// rather than a scan of the whole window on every turn.
    errors_in_window: usize,
    /// Every turn outcome this agent has recorded — the `turns` a breach is stamped with, and the
    /// figure that pins the accounting against the loop's own turn count.
    turns_recorded: u64,
}

impl AgentLimits {
    /// A fresh accounting against `limits`, having recorded nothing.
    ///
    /// The window is reserved up front, but never wider than the turn ceiling when one is set: an
    /// agent cannot record more outcomes than it is allowed turns, so a window declared wider than
    /// the run can fill — which [`resolve_run_limits`] arms as declared, warning that it can then
    /// only fire on the last turn — costs one bounded allocation instead of an unbounded one. On an unbounded run the window's own size is
    /// the bound, which is why it is a size and not a rate.
    pub fn new(limits: RunLimits) -> Self {
        let capacity = limits.error_rate.map_or(0, |rate| {
            rate.window.min(limits.max_turns.unwrap_or(usize::MAX))
        });
        Self {
            limits,
            consecutive: 0,
            window: VecDeque::with_capacity(capacity),
            errors_in_window: 0,
            turns_recorded: 0,
        }
    }

    /// Record one turn's [outcome](TurnOutcome) and report the ceiling it breached, if any.
    ///
    /// Both error ceilings are evaluated after the outcome is folded in — including on a
    /// [`Progressed`](TurnOutcome::Progressed) turn, because a good turn can be the one that first
    /// *fills* the rate window, and a window that becomes judgeable at three errors in four must
    /// breach then rather than waiting for a fourth failure.
    /// [`Finished`](TurnOutcome::Finished) and [`Fatal`](TurnOutcome::Fatal) are recorded and never
    /// breach: the session is over either way, and attributing a ceiling to a run that ended on
    /// purpose — or to one gg's own machinery ended — would be a lie.
    ///
    /// The consecutive count is cleared by, and only by, a `Progressed` turn: not by a compaction,
    /// not by a subagent returning. A turn is the unit, and only a turn that carried out its
    /// declared work clears the count.
    pub fn record(&mut self, outcome: TurnOutcome, agent_id: &str) -> Option<GgLimitBreach> {
        self.turns_recorded += 1;

        let is_error = outcome.is_error();
        if is_error {
            self.consecutive += 1;
        } else if outcome == TurnOutcome::Progressed {
            self.consecutive = 0;
        }

        // Fed uniformly by every recorded outcome, terminal ones included, so "the last N turns"
        // means the last N turns and not "the last N turns of some kinds".
        if let Some(rate) = self.limits.error_rate {
            self.window.push_back(is_error);
            if is_error {
                self.errors_in_window += 1;
            }
            // The push above can put the window one over size, so the oldest outcome is dropped
            // here — and if it was an error, the running count drops with it. Written as one
            // condition because the eviction is what the length test is *for*.
            if self.window.len() > rate.window && self.window.pop_front() == Some(true) {
                self.errors_in_window -= 1;
            }
        }

        if outcome.is_terminal() {
            return None;
        }
        self.breach(agent_id)
    }

    /// How many turn outcomes this agent has recorded.
    pub fn turns_recorded(&self) -> u64 {
        self.turns_recorded
    }

    /// This agent's error turns since its last [`Progressed`](TurnOutcome::Progressed) one — the
    /// running count the [consecutive-error ceiling](RunLimits::max_consecutive_errors) is enforced
    /// on, read **after** a [`record`](Self::record) so the turn just folded in is included.
    ///
    /// Exposed because the count is *per agent* and gg's telemetry stream is run-wide: turns from
    /// concurrently running agents interleave arbitrarily, so a reader folding the stream could
    /// only ever reconstruct a run-wide streak — an artefact of thread scheduling rather than a fact
    /// about any agent. Publishing this figure on each turn's own event is what makes
    /// [`GgErrorSummary::max_consecutive`](test_cabinet_core::gg::GgErrorSummary::max_consecutive)
    /// a maximum over agents instead of a fiction.
    pub fn consecutive_errors(&self) -> u64 {
        u64::from(self.consecutive)
    }

    /// The ceiling the state just folded in has breached, if any.
    ///
    /// The consecutive count is checked first: it is the sharper instrument (a run failing five
    /// times in a row is failing now, where a rate is a statement about a window that may be mostly
    /// history), so when a turn breaches both, the breach recorded is the one that describes the
    /// present.
    fn breach(&self, agent_id: &str) -> Option<GgLimitBreach> {
        if let Some(threshold) = self.limits.max_consecutive_errors
            && self.consecutive >= threshold
        {
            return Some(GgLimitBreach {
                limit: GgLimitKind::ConsecutiveErrors,
                threshold: f64::from(threshold),
                observed: f64::from(self.consecutive),
                turns: self.turns_recorded,
                agent_id: agent_id.to_string(),
                window: None,
            });
        }

        let rate = self.limits.error_rate?;
        // The window is both the lookback and the minimum sample, so the earliest turn this ceiling
        // can stop a run on is turn `window`: with a window of ten, not before turn ten.
        if self.window.len() < rate.window {
            return None;
        }
        let observed = self.errors_in_window as f64 / rate.window as f64;
        // Strictly greater, matching "more than X%": at 0.5 over ten, five errors is not a breach.
        (observed > rate.max_rate).then(|| GgLimitBreach {
            limit: GgLimitKind::ErrorRate,
            threshold: rate.max_rate,
            observed,
            turns: self.turns_recorded,
            agent_id: agent_id.to_string(),
            window: Some(rate.window as u64),
        })
    }
}

// ---------------------------------------------------------------------------------------------
// The run's shared spend
// ---------------------------------------------------------------------------------------------

/// The **run-wide** accumulated model spend, shared by every agent and read at every turn boundary.
///
/// The existing per-slot accounting cannot serve this ceiling: it is folded only when an agent
/// *finishes*, so a subagent forty turns deep would contribute nothing to the total until it was
/// done — precisely the run a cost ceiling exists to stop. This is fed instead at each agent's
/// model-response site, so the figure is current to within one in-flight turn per agent.
///
/// A [`Mutex`] rather than an atomic because a [`Cost`] is two optional `f64`s and
/// "unreported is not zero" is not expressible as an atomic add. It is uncontended in practice —
/// locked once per model turn per agent, for the length of two additions — and it cannot deadlock a
/// scheduler, because both methods are synchronous and neither returns a guard, so a lock can never
/// be held across an `await`. Each is one critical section over the whole value, so however many
/// agents call them at once, no turn's cost is counted twice or lost and no read observes a
/// half-applied total.
#[derive(Debug, Default)]
pub struct RunSpend {
    /// Every reported turn cost so far, or `None` while no turn has reported one at all.
    total: Mutex<Option<Cost>>,
}

impl RunSpend {
    /// Add one turn's cost to the run's total, on the "unreported is not zero" terms the rest of
    /// gg's metrics use: an unreported side leaves the other unchanged, and a total stays `None`
    /// until some turn reports a figure.
    ///
    /// An unreported cost is not merely a no-op arithmetically — it does not even take the lock,
    /// because a run against a model with no listed prices would otherwise serialise every agent's
    /// turn boundary on a mutex that can never change anything.
    pub fn add(&self, delta: Option<Cost>) {
        let Some(delta) = delta else {
            return;
        };
        let mut total = self.total.lock().expect("run spend lock");
        *total = Some(match *total {
            Some(acc) => Cost {
                comparable: add_optional(acc.comparable, delta.comparable),
                actual: add_optional(acc.actual, delta.actual),
            },
            None => delta,
        });
    }

    /// The figure a [cost ceiling](RunLimits::max_cost) is measured against: the accumulated
    /// [`comparable`](Cost::comparable) cost, falling back to [`actual`](Cost::actual), and `None`
    /// when no turn has reported a cost at all.
    ///
    /// The same figure the run's closing summary prints and the same one that lands in the run's
    /// per-slot costs — a ceiling measuring something the run record does not show would be
    /// unauditable. The compaction summarizer's own model calls are deliberately outside gg's run
    /// totals, so this measures exactly what the run record reports and no more.
    pub fn charged(&self) -> Option<f64> {
        let total = *self.total.lock().expect("run spend lock");
        total.and_then(|cost| cost.comparable.or(cost.actual))
    }
}

/// Sum two optional cost figures, treating an unreported side as zero but staying `None` when both
/// are unreported.
///
/// A deliberate twin of the fold the turn loop keeps for its own per-agent total, which is private
/// to that module and would have to be widened for this one line. Widening it the other way round
/// is what would cost something real: this module depends on nothing but the contract types, which
/// is why every rule in it is a unit test with no loop behind it. The two are pinned to the same
/// behaviour by `run_spend_sums_costs_on_the_unreported_is_not_zero_terms`.
fn add_optional(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
    }
}

#[cfg(test)]
#[path = "limits.test.rs"]
mod tests;
