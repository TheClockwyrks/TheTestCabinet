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

use super::invoker::{SandboxRefusal, SandboxToolCall, SandboxViewOpened, ToolApi};
use super::limits::{MemoryLimiter, SandboxLimits};
use super::{ProgramCompletion, ProgramError, ProgramErrorKind};
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

use recording::{GuardedApi, Recording};

wasmtime::component::bindgen!({ world: "sandbox", path: "wit" });

use test_cabinet::gg::feedback;
use test_cabinet::gg::types::{self, ErrorCode, ToolError};

/// Which ending calls one sandbox run binds.
///
/// Almost always an agent's own [role](EndingRole): the guest is handed the same value the host
/// holds, so the ending calls bound into a program's scope and the ones this membrane will accept
/// are decided once, from one value.
///
/// [`None`](Self::None) is the exception, and it exists for exactly one caller: an **on-use script**,
/// the code a [skill](crate::skills) or a [memory](crate::memories) runs when the agent first reads
/// it. That script is not the agent's turn — the model did not write it and is not answering for it
/// — so it must not be able to declare the session over. It is withheld the way every withheld call
/// is: the name is simply not in its scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnding {
    /// The agent's own role. A turn.
    Role(EndingRole),
    /// No ending group at all. An on-use script.
    None,
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
/// [`into_parts`](Self::into_parts) on **every** exit path — including a trap — because the calls a
/// program landed before it was stopped are exactly what the model needs to see next turn.
pub(crate) struct MembraneState<A: ToolApi> {
    /// The native, typed tool surface a bridged call is aimed at: the loop's own state in
    /// production ([`LoopToolApi`](crate::agent)), an in-memory fake under test.
    ///
    /// Behind a [guard](recording::GuardedApi) rather than in the open, so that no host function can
    /// reach it without first opening the API-call bracket that records what the model called.
    api: GuardedApi<A>,
    /// How many model-facing API calls this program has made — every host function, dispatching or
    /// not, refused or serviced. See [`recording`].
    api_calls: u64,
    /// The gg tools this run offers. The guest binds only these into a program's scope, so this is
    /// a defensive backstop rather than the primary gate.
    enabled: BTreeSet<String>,
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
    /// the carve-outs (a view, an ending, a program-library call, an `object.list()`) and by the
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
    /// The state for one program: bridged through `api`, offering `enabled`'s tools, bounded by
    /// `limits`, and stopping at `deadline`.
    ///
    /// Which ending calls the program may make is not a host-side check: the
    /// [ending group](RunEnding) is handed to the *guest*, which binds only that group's names, so
    /// an ending call outside it is not in scope to be made. The host therefore keeps no copy.
    pub(crate) fn new(
        api: A,
        enabled: &[String],
        limits: SandboxLimits,
        deadline: Option<Instant>,
    ) -> Self {
        Self {
            api: GuardedApi::new(api),
            api_calls: 0,
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
        capture::withhold_pictures(&mut outcome);
        let completed = completed(&outcome);
        self.record(tool, &outcome, completed);
        Ok(outcome)
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
