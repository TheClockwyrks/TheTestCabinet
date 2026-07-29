//! The membrane: the trust boundary, generated from `crates/gg/wit/gg-sandbox.wit`, and the one
//! helper every host function on it goes through.
//!
//! [`bindgen!`](wasmtime::component::bindgen) turns the WIT into one `Host` trait per interface,
//! and this module (with its six submodules) implements every one of them for [`MembraneState`].
//! That is what makes the boundary typed end to end: a program calls `readFile(path, { limit })`,
//! the guest lowers it into a WIT call with typed parameters, and the host receives
//! `read_file(path: String, offset: Option<u32>, limit: Option<u32>)`. Nothing on the model-facing
//! side dispatches a tool by name with a bag of JSON — that shape exists only *below* this module,
//! between [`MembraneState::call`] and [`ToolRegistry::dispatch`](crate::tools::ToolRegistry), where
//! it costs the model nothing — and the compiler, not a test, is what guarantees a WIT function
//! cannot exist without a host implementation.
//!
//! # One helper, so the guarantees exist once
//!
//! Every host function that dispatches anything funnels through [`MembraneState::call`] (or its one
//! sibling [`call_raw`](MembraneState::call_raw)) — all 29 bound tools. That is where the run's
//! wall-clock deadline is honoured, where a tool this run does not offer is refused, where the
//! ordered call record is kept, where pictures are collected, and where a failed [`ToolOutcome`]
//! becomes a typed `tool-error`. A host function itself is three lines: build the JSON its tool's
//! schema already declares, call, and convert the [structured sidecar](crate::tools::ToolData) into
//! its typed WIT result.
//!
//! A handful of functions dispatch nothing and therefore bypass it. The three
//! [turn-level transitions](turns) are refused, because a mode change is not a value a program can
//! compose. And the four [session-ending calls](session) — the model-facing functions on this
//! membrane that are not gg tools — set this agent's ending flag through
//! [`MembraneState::declare`], because ending a session is the one thing a program may ask for that
//! no capability governs and no spent budget may withhold.
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

use std::collections::{HashSet, VecDeque};
use std::time::{Duration, Instant};

use super::invoker::{SandboxRefusal, SandboxToolCall, ToolApi};
use super::limits::{MemoryLimiter, SandboxLimits};
use super::{ProgramCompletion, ProgramError, ProgramErrorKind};
use crate::ending::{Ending, EndingRole};
use crate::model::ImageContent;
use crate::tools::{ToolData, ToolFailure, ToolOutcome};

mod capture;
mod context;
mod delegation;
mod docs;
mod knowledge;
mod session;
mod turns;
mod workspace;

wasmtime::component::bindgen!({ world: "sandbox", path: "wit" });

use test_cabinet::gg::feedback;
use test_cabinet::gg::types::{self, ErrorCode, ToolError};

/// The guest is handed the same [role](EndingRole) the host holds, so the ending calls bound into a
/// program's scope and the ones this membrane will accept are decided once, from one value.
///
/// The judge's attempt count does not cross: the guest has no use for it (its own check is only that
/// the number is a positive integer) and the range is the host's to enforce, at the call.
impl From<EndingRole> for EndingKind {
    fn from(role: EndingRole) -> Self {
        match role {
            EndingRole::Standard => Self::Standard,
            EndingRole::Review => Self::Review,
            EndingRole::Judge { .. } => Self::Judge,
        }
    }
}

/// The per-[`Store`](wasmtime::Store) host state: the tool bridge, the memory limiter, the run's
/// wall-clock deadline, and everything the program accumulated on its way to a result.
///
/// It owns its invoker (rather than borrowing one) so the store's data is `'static` with no
/// lifetime erasure and no `unsafe`, and it is reclaimed whole by
/// [`into_parts`](Self::into_parts) on **every** exit path — including a trap — because the calls a
/// program landed before it was stopped are exactly what the model needs to see next turn.
pub(crate) struct MembraneState<A: ToolApi> {
    /// The native, typed tool surface a bridged call is aimed at: the loop's own state in
    /// production ([`LoopToolApi`](crate::agent)), an in-memory fake under test.
    api: A,
    /// The gg tools this run offers. The guest binds only these into a program's scope, so this is
    /// a defensive backstop rather than the primary gate.
    enabled: HashSet<String>,
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
    /// The pictures to attach to this turn's feedback.
    images: Vec<ImageContent>,
    /// Pictures dropped because [`IMAGE_BUDGET`] was already spent.
    images_dropped: u32,
    /// The shim's note that the program deferred work which ran after it ended.
    deferred_note: Option<String>,
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
    /// The agent's [ending role](EndingRole) — which ending calls the guest was given, and (for a
    /// judge) how many attempts its pick is bounded by. The guest is handed the same role, so the
    /// only ending calls that can reach this host are the ones it bound.
    role: EndingRole,
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
    /// Every refused call the roster kept.
    pub refusals: Vec<SandboxRefusal>,
    /// How many refusals the cap discarded.
    pub refusals_suppressed: u64,
    /// The kept log lines — the last ones the program produced, in order.
    pub logs: Vec<String>,
    /// How many earlier log lines the caps evicted.
    pub logs_suppressed: u64,
    /// The pictures to attach to the turn.
    pub images: Vec<ImageContent>,
    /// How many pictures the budget dropped.
    pub images_dropped: u32,
    /// The deferred-work note, when the shim reported one.
    pub deferred_note: Option<String>,
    /// Whether the program ended by returning a value, which gg discarded.
    pub returned_value: bool,
    /// The ending the program declared, when it declared one and did not lose it.
    pub completion: Option<ProgramCompletion>,
    /// The ending the program lost by failing afterwards.
    pub revoked_completion: Option<Ending>,
    /// The program's uncaught throw, when the shim reported one.
    pub program_error: Option<ProgramError>,
}

impl<A: ToolApi> MembraneState<A> {
    /// The state for one program: bridged through `api`, offering `enabled`'s tools and `role`'s
    /// ending calls, bounded by `limits`, and stopping at `deadline`.
    pub(crate) fn new(
        api: A,
        enabled: &[String],
        role: EndingRole,
        limits: SandboxLimits,
        deadline: Option<Instant>,
    ) -> Self {
        Self {
            api,
            enabled: enabled.iter().cloned().collect(),
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
            images: Vec::new(),
            images_dropped: 0,
            deferred_note: None,
            returned_value: false,
            completion: None,
            revoked_completion: None,
            program_error: None,
            role,
        }
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
            refusals: self.refusals,
            refusals_suppressed: self.refusals_suppressed,
            logs: self.logs.into(),
            logs_suppressed: self.logs_suppressed,
            images: self.images,
            images_dropped: self.images_dropped,
            deferred_note: self.deferred_note,
            returned_value: self.returned_value,
            completion: self.completion,
            revoked_completion: self.revoked_completion,
            program_error: self.program_error,
        };
        (self.api, parts)
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
    }

    /// Bridge one typed membrane call to gg's real toolset, turning a failed outcome into the typed
    /// error the program sees thrown.
    ///
    /// This is what twenty-eight of the twenty-nine bound tools call. The twenty-ninth is `shell`,
    /// which needs a non-`ok` outcome as a value — see [`call_raw`](Self::call_raw). The three
    /// turn-level transitions reach neither: they are refused without a dispatch.
    fn call(
        &mut self,
        tool: &'static str,
        run: impl FnOnce(&mut A) -> ToolOutcome,
    ) -> Result<ToolOutcome, ToolError> {
        // For every tool but `shell`, the tool's own verdict and the call's are the same thing.
        let outcome = self.dispatch(tool, run, |outcome| outcome.ok)?;
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
        tool: &'static str,
        run: impl FnOnce(&mut A) -> ToolOutcome,
    ) -> Result<ToolOutcome, ToolError> {
        self.dispatch(tool, run, |outcome| {
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
        ending: Result<Ending, String>,
        call: &'static str,
    ) -> Result<(), ToolError> {
        let ending = ending.map_err(|message| ToolError {
            code: ErrorCode::InvalidArgument,
            tool: call.to_string(),
            message,
        })?;
        let superseded = match self.completion.take() {
            Some(previous) => previous.superseded.saturating_add(1),
            None => 0,
        };
        self.completion = Some(ProgramCompletion { ending, superseded });
        Ok(())
    }

    /// How many attempts a [judge](crate::ending::EndingRole::Judge) may pick between — the range
    /// `select-winner` is checked against. Zero for every other role, which has no such call bound.
    pub(crate) fn judged_attempts(&self) -> u32 {
        self.role.attempts()
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
        tool: &'static str,
        run: impl FnOnce(&mut A) -> ToolOutcome,
        completed: fn(&ToolOutcome) -> bool,
    ) -> Result<ToolOutcome, ToolError> {
        if self.deadline_spent() {
            return Err(self.refuse(
                tool,
                ErrorCode::LimitExceeded,
                "the run's wall-clock budget is spent; this call was refused so the program stops \
                 cleanly. Everything it already did stands.",
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
        let mut outcome = run(&mut self.api);
        self.charge_host_time(started.elapsed());
        self.collect_images(&mut outcome);
        let completed = completed(&outcome);
        self.record(tool, &outcome, completed);
        Ok(outcome)
    }

    /// The refusal a [turn-level transition](crate::tools::TURN_LEVEL_TOOLS) always gets.
    ///
    /// It never reaches the invoker: these three tools change the loop's *mode*, which is not a
    /// value a program can compose, so there is nothing to dispatch and nothing to wait for.
    ///
    /// The message deliberately stops at *why*, and does not tell the model to make the transition
    /// in a later turn: under responses-as-code there is no turn that can. Every turn of such a run
    /// is a program, and a program is where the refusal comes from — so "try again next turn" would
    /// send a model round a loop that has no exit. The honest instruction is to do the work
    /// directly, and the operator-facing warning about the combination is raised at startup by
    /// [`announce_configuration`](crate::agent) rather than discovered here.
    fn refuse_turn_level(&mut self, tool: &'static str, what: &str) -> ToolError {
        self.refuse(
            tool,
            ErrorCode::Refused,
            format!(
                "`{tool}` cannot be called from within a code program: {what} is a turn-level \
                 transition, not a composable value, and this run has no turn that is not a \
                 program. Do the work directly instead."
            ),
        )
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
        let message = format!(
            "`{tool}` produced no structured result{produced}; this is a gg defect, not a fault in \
             your program."
        );
        self.amend_last_call_as_failed(&message);
        ToolError {
            code: ErrorCode::IoError,
            tool: tool.to_string(),
            message,
        }
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
        ToolData::Workflow(_) => "workflow",
        ToolData::Speculation(_) => "speculation",
    }
}

/// The empty trait the shared `types` interface generates. It declares no functions — it exists so
/// that one `tool-error` crosses the whole membrane rather than one per family — but the world
/// still requires an implementation.
impl<A: ToolApi> types::Host for MembraneState<A> {}

#[cfg(test)]
#[path = "membrane.test.rs"]
mod tests;
