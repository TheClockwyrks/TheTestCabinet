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
//! Three of them are new; the turn ceiling and the wall-clock budget predate them and are folded in
//! **unchanged in behaviour**, so there is one home, one [resolver](resolve_run_limits), one
//! [breach record](test_cabinet_core::gg::GgLimitBreach) and one aggregation facet for every
//! ceiling gg has, rather than two vocabularies that drift.
//!
//! The defaults catch a run that is *failing* without capping one that is merely *long*. gg's host
//! (The Test Cabinet) already enforces a wall-clock cap on every run, so the turn ceiling is no
//! longer needed as the backstop it used to be — armed as one, it mostly cut productive runs short
//! — and is therefore **unbounded when unset** ([`RunLimits::max_turns`] is `None`). What is armed
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
//! # Per agent, or run-wide
//!
//! The two error ceilings are **per agent**, and that is a correctness property rather than a
//! preference: "consecutive" and "the last N turns" are only definable within one agent's turn
//! sequence. gg's agents run concurrently on the subagent scheduler, their turns interleave
//! nondeterministically, and a run-wide consecutive counter would be counting a sequence that never
//! happened, with a value depending on thread scheduling — not a knob, a race. It is also
//! substantively right: a subagent's failures are its own, a speculation fans out K attempts
//! precisely so that some may fail, and a thrashing fix agent must not take the run down with it.
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
use std::sync::Mutex;
use std::time::Duration;

use test_cabinet_core::gg::{GgCapabilitySet, GgLimitBreach, GgLimitKind, GgRunLimits};
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
    Error(TurnErrorKind),
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
}

/// Why a turn was an error — a failure attributable to the model's turn.
///
/// Carried for diagnosis and for the breach log line; the ceilings themselves count errors without
/// distinguishing kinds, because a run that alternates between five ways of failing is not
/// healthier than one that fails the same way five times.
///
/// Four of the six are [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)
/// shapes, and that asymmetry is largely real rather than an oversight: a tool-calling turn whose
/// requested calls are all dispatched and answered cannot declare work that is cut short. The one
/// tool-calling error shape besides [`ModelApi`](Self::ModelApi) is
/// [`MissingCompletion`](Self::MissingCompletion) — a turn under an
/// [explicit-call](test_cabinet_core::gg::COMPLETION_SIGNAL_EXPLICIT_CALL) completion signal that
/// ends without calling `finish` — which exists precisely so a model that loops emitting prose
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
    /// must stay the process's one non-zero exit. Making model-API errors survivable is a change to
    /// gg's model-error policy and would be designed as one.
    ModelApi,
    /// The reply was not a program: empty, prose, comments only, native tool calls with no text, no
    /// block gg reads as a program, or several candidate blocks. Responses-as-code only; the six
    /// reasons are [`NotAProgramReason`](crate::healing::NotAProgramReason).
    NotAProgram,
    /// The program did not type-strip — a syntax error, a module feature the
    /// [sandbox](crate::sandbox) has no implementation of, or a program past the size/nesting
    /// guards. Nothing ran.
    Transpile,
    /// The program ran and threw an uncaught fault, so every statement after the throw never ran
    /// and the model must re-declare the remainder.
    ProgramFault,
    /// The [sandbox](crate::sandbox) stopped the program at a ceiling — fuel or memory, or the
    /// guest trapped. The program ran and its landed calls stand, but the work it declared was cut
    /// short.
    ///
    /// This **is** an error, unlike under the counter it replaces, and the change is deliberate:
    /// the declared work did not complete and the model must re-declare it. Nothing is lost by
    /// dropping the old exemption, because the case that exemption protected — a program that is
    /// mostly working and occasionally too big — is exactly what [`error_rate`](RunLimits::error_rate)
    /// expresses and a consecutive counter cannot, which is *why* it needed an exemption at all.
    SandboxLimit,
    /// A tool-calling turn ended with no tool call under an
    /// [explicit-call](test_cabinet_core::gg::COMPLETION_SIGNAL_EXPLICIT_CALL) completion signal,
    /// where a text-only reply is not a completion but a failure to end the run the one way this
    /// run allows. Counted as an error so a model that keeps replying in prose instead of calling
    /// `finish` trips the run's [error ceilings](RunLimits) and stops early. The only tool-calling
    /// error shape besides [`ModelApi`](Self::ModelApi).
    MissingCompletion,
}

/// A failure of gg's own machinery, which ends the session rather than costing the model a turn.
///
/// Both are unreachable in a healthy released build, and both would recur identically on every
/// further turn, so the run ends loudly on the first occurrence instead of burning to its deadline
/// — and neither is ever counted against an [error ceiling](RunLimits), because attributing gg's
/// defect to the model would be the same misattribution the `auth_error` status exists to prevent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FatalFault {
    /// The committed sandbox component could not be compiled or instantiated — artifact drift
    /// between `crates/gg/wit/gg-sandbox.wit` and the committed `.wasm`.
    ArtifactDefect,
    /// gg's own plumbing failed: the wasm engine could not be configured or linked, or the
    /// sandbox's blocking task did not complete.
    HostFault,
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

    /// The one `info` line a run logs at launch, naming every ceiling actually in force.
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

/// The two capability params that used to carry a ceiling, and no longer do.
///
/// Both were read from **any** capability's params, and the console round-trips undeclared params
/// losslessly through its advanced-JSON field, so a configuration stored in the backend database
/// may still carry `{"maxTurns": 8}` on some capability — a ceiling the operator meant to set that
/// gg no longer reads there, so the run would run unbounded instead. Naming them here is what turns
/// a silent behaviour change into a loud one.
const LEGACY_CAPABILITY_PARAMS: [&str; 2] = ["maxTurns", "maxRuntimeSecs"];

/// Resolve the run's ceilings from [`set.limits`](GgCapabilitySet::limits), appending an
/// operator-facing warning for every declaration that cannot bound anything.
///
/// **Total**: an unset, zero, negative or nonsensical declaration becomes `None` (the ceiling is
/// off) plus a warning, never an error, so a sweep's one shared configuration document stays
/// interpretable by every arm — the same terms an unknown name in
/// [`disabled_tools`](GgCapabilitySet::disabled_tools) is read on. No warning ever fails a launch.
///
/// | Declaration | Resolves to | Warning |
/// | --- | --- | --- |
/// | `limits` absent | turns unbounded, the two error ceilings at their [defaults](self), runtime and cost off | — |
/// | `maxTurns: 0` or absent | **unbounded** (no turn ceiling) | — |
/// | `maxRuntimeSecs: 0` or absent | no budget | — |
/// | `maxConsecutiveErrors` absent | [`DEFAULT_MAX_CONSECUTIVE_ERRORS`] | — |
/// | `maxConsecutiveErrors: 0` | off | it would stop a run before its first turn |
/// | both error-rate halves absent | [`DEFAULT_MAX_ERROR_RATE`] over [`DEFAULT_ERROR_RATE_WINDOW`] | — |
/// | a rate with no window, or a window with no rate | off | neither half means anything alone |
/// | `maxErrorRate` outside `0.0..=1.0`, or not finite | off | it could never be exceeded |
/// | `errorRateWindow: 0` | off | it has no turns to measure |
/// | `errorRateWindow >= maxTurns` (when a turn ceiling is set) | **armed** | it can only ever fire on the run's last turn |
/// | `maxCost` ≤ 0, or not finite | off | it must be greater than zero |
/// | `maxTurns`/`maxRuntimeSecs` in any capability's params | ignored | move it to `capabilitySet.limits` |
///
/// The warnings are the caller's to emit: this function is pure, and the loop logs them on the
/// root's stream before the first turn, alongside the rest of gg's launch diagnostics.
pub fn resolve_run_limits(set: &GgCapabilitySet, warnings: &mut Vec<String>) -> RunLimits {
    let declared = set.limits;

    // Absent or zero is unbounded — the host caps the wall-clock, so gg imposes no turn backstop
    // unless a study asks for one. A declaration wider than this platform's `usize` is kept as the
    // widest ceiling it can hold (effectively unbounded either way) rather than wrapping small.
    let max_turns = declared
        .max_turns
        .filter(|&turns| turns > 0)
        .map(|turns| usize::try_from(turns).unwrap_or(usize::MAX));

    let max_runtime = declared
        .max_runtime_secs
        .filter(|&secs| secs > 0)
        .map(Duration::from_secs);

    let max_consecutive_errors = match declared.max_consecutive_errors {
        Some(0) => {
            warnings.push(
                "maxConsecutiveErrors: 0 cannot bound anything (it would stop a run before its \
                 first turn); the ceiling is off."
                    .to_string(),
            );
            None
        }
        // Saturating rather than wrapping: a count wider than a `u32` is a ceiling no run could
        // reach either way, and keeping the operator's intent ("effectively never") is better than
        // silently arming a small one.
        Some(max) => Some(u32::try_from(max).unwrap_or(u32::MAX)),
        // Absent arms gg's default — one of the two error ceilings that end a stuck run.
        None => Some(DEFAULT_MAX_CONSECUTIVE_ERRORS),
    };

    let error_rate = resolve_error_rate(&declared, max_turns, warnings);

    let max_cost = match declared.max_cost {
        Some(max) if max.is_finite() && max > 0.0 => Some(max),
        Some(_) => {
            warnings.push("maxCost must be greater than zero; the ceiling is off.".to_string());
            None
        }
        None => None,
    };

    warn_about_legacy_params(set, warnings);

    RunLimits {
        max_turns,
        max_runtime,
        max_consecutive_errors,
        error_rate,
        max_cost,
    }
}

/// Resolve the [error-rate ceiling](ErrorRateLimit) from its two halves, warning about every way
/// they can fail to describe one.
///
/// When **neither** half is declared, the ceiling arms gg's [default](self)
/// ([`DEFAULT_MAX_ERROR_RATE`] over [`DEFAULT_ERROR_RATE_WINDOW`]) with no warning — the default is
/// a deliberate ceiling, not an unusable declaration. A **partial** declaration (one half without
/// the other) is not a default at all but a mistake the operator half-made, so it warns and arms
/// nothing rather than silently filling in the missing half. The rest of the halves are validated
/// in the order a reader would: that the rate is a fraction, then that the window has turns in it.
/// The first failure returns — the ceiling is off either way, and a second sentence about a window
/// that will never be consulted would only bury the one that matters.
fn resolve_error_rate(
    declared: &GgRunLimits,
    max_turns: Option<usize>,
    warnings: &mut Vec<String>,
) -> Option<ErrorRateLimit> {
    let (max_rate, window) = match (declared.max_error_rate, declared.error_rate_window) {
        (None, None) => {
            return Some(ErrorRateLimit {
                max_rate: DEFAULT_MAX_ERROR_RATE,
                window: DEFAULT_ERROR_RATE_WINDOW,
            });
        }
        (Some(_), None) => {
            warnings.push(
                "maxErrorRate is set but errorRateWindow is not; a rate needs a window to be \
                 measured over, so the ceiling is off."
                    .to_string(),
            );
            return None;
        }
        (None, Some(_)) => {
            warnings.push(
                "errorRateWindow is set but maxErrorRate is not; a window needs a rate to be \
                 judged against, so the ceiling is off."
                    .to_string(),
            );
            return None;
        }
        (Some(max_rate), Some(window)) => (max_rate, window),
    };

    if !max_rate.is_finite() || !(0.0..=1.0).contains(&max_rate) {
        warnings.push(format!(
            "maxErrorRate must be a fraction between 0.0 and 1.0; {max_rate} can never be \
             exceeded, so the ceiling is off."
        ));
        return None;
    }

    // A window wider than `usize` is kept as the widest one this platform can hold: it is a window
    // no run could ever fill, which the next check says out loud.
    let window = usize::try_from(window).unwrap_or(usize::MAX);
    if window == 0 {
        warnings
            .push("errorRateWindow: 0 has no turns to measure; the ceiling is off.".to_string());
        return None;
    }
    // Only warnable against a turn ceiling that exists: an unbounded run (the default) has no last
    // turn for the window to be pinned to, so an explicit window is always given room to fill.
    if let Some(max_turns) = max_turns
        && window >= max_turns
    {
        warnings.push(format!(
            "errorRateWindow ({window}) is not smaller than the turn ceiling ({max_turns}), so the \
             error-rate ceiling can only ever fire on the run's last turn."
        ));
    }

    Some(ErrorRateLimit { max_rate, window })
}

/// Warn about every capability still carrying a ceiling in its params.
///
/// Presence is the whole signal — the value is not read, and is not worth reading, because the
/// operator's mistake is having written the key somewhere gg no longer looks. Reported per
/// capability and per param, so a set that carries the same stale key on three capabilities gets
/// three lines naming three capabilities rather than one line naming none.
fn warn_about_legacy_params(set: &GgCapabilitySet, warnings: &mut Vec<String>) {
    for capability in set.agents.iter().flat_map(|agent| &agent.capabilities) {
        for param in LEGACY_CAPABILITY_PARAMS {
            if capability.params.get(param).is_some() {
                warnings.push(format!(
                    "capability `{}` carries a `{param}` param, which gg no longer reads; move it \
                     to `capabilitySet.limits`.",
                    capability.id
                ));
            }
        }
    }
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
    /// the run can fill — which [`resolve_run_limits`] warns about rather than rejecting — costs one
    /// bounded allocation instead of an unbounded one. On an unbounded run the window's own size is
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
    /// not by a plan submission, not by a subagent returning, not by an FSM move. A turn is the
    /// unit, and only a turn that carried out its declared work clears the count.
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
