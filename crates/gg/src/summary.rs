//! The gg **session summary tracker**: accumulates the aggregatable, telemetry-derived
//! counts of a run as its telemetry is emitted, then finalizes them into a
//! [`GgSessionSummary`] the binary emits once, just before the session ends.
//!
//! gg's experiments are only analyzable in aggregate over fields we durably record (see the
//! [result aggregation](https://docs.testcabinet.ai/gg/result-aggregation/) design), so a run
//! must carry a compact summary of its own outcome rather than forcing every query to re-parse
//! the whole event stream. This tracker computes that summary **from the telemetry the run
//! actually emitted**: the [`Emitter`](crate::telemetry::Emitter) funnels every emitted event
//! through [`observe`](SessionSummaryTracker::observe) — the single choke point every agent's
//! stream passes through — so the counts derive from exactly the stream the run recorded,
//! across the root and every subagent, without threading counters through the orchestrator. At
//! session end the binary [`finalize`](SessionSummaryTracker::finalize)s the accumulated state
//! into a [`GgSessionSummary`] and emits it as the terminal
//! [`SessionSummary`](GgTelemetryKind::SessionSummary) event; `core` then lifts it onto the run
//! record. Because the summary is derived from the same events it summarizes, the two are
//! consistent by construction.
//!
//! # Folded figures and recorded facts
//!
//! Almost every figure is **folded** from the stream by [`observe`](SessionSummaryTracker::observe),
//! which is what keeps numerator and denominator on one mechanism: the run's [error
//! rollup](GgErrorSummary) is folded from the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event
//! — one per turn of every agent — so its errors and the turns they are a rate over are counted by
//! the same statement. The run's [discovery rollup](GgUndocumentedCalls) rides on the
//! [`CodeExecution`](GgTelemetryKind::CodeExecution) event
//! [`code_executions`](GgSessionSummary::code_executions) is counted from, for the same reason and
//! to the same effect.
//!
//! Four figures cannot be folded and are **recorded** instead, each by its own `record_*` method
//! that the binary calls once. Three of them —
//! [`effective_tools`](SessionSummaryTracker::record_effective_tools),
//! [`execution_mode`](SessionSummaryTracker::record_execution_mode) and
//! [`limits`](SessionSummaryTracker::record_limits) — are configuration facts no event carries. The
//! fourth, [`limit_hit`](SessionSummaryTracker::record_limit_hit), is recorded for a sharper reason:
//! a [`LimitExceeded`](GgTelemetryKind::LimitExceeded) event *is* on the stream, but this one tracker
//! is shared by every agent, and a subagent that stopped on its own error ceiling is not how the
//! **run** ended. Folding that event would report a child's ceiling as the run's outcome, so the
//! binary records the root loop's own breach and this module never looks at the event.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

use test_cabinet_core::gg::{
    GgCallFailure, GgErrorSummary, GgIssueReviewPhase, GgIssueStatus, GgLimitBreach,
    GgProgramLanguage, GgProviderStat, GgRejectedResponses, GgRunLimits, GgSessionSummary,
    GgSlotCost, GgTelemetryKind, GgTurnErrorKind, GgTurnErrorType, GgTurnOutcome,
    GgUndocumentedCalls, GgUsageFigure,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// Accumulates a running session's aggregatable outcome from the telemetry stream it
/// [observes](Self::observe), so the binary can [finalize](Self::finalize) it into a
/// [`GgSessionSummary`] at session end.
///
/// Held behind an [`Arc`](std::sync::Arc) shared by every [`Emitter`](crate::telemetry::Emitter)
/// derived over a run (the base emitter and every agent-scoped child), so an agent's task on any
/// thread can fold its events in. Interior mutability (a [`Mutex`]) keeps the shared handle
/// `&self`, matching the emitter's `&self` emit path.
#[derive(Default)]
pub struct SessionSummaryTracker {
    inner: Mutex<SummaryState>,
}

/// The mutable accumulator behind a [`SessionSummaryTracker`]. Issue ids are held as sets so a
/// [`BoardState`](GgTelemetryKind::BoardState) re-emitted every mutation contributes each issue
/// once (created) and each completed issue once (even if it was reopened and re-completed).
#[derive(Default)]
struct SummaryState {
    /// One per [`AgentSpawned`](GgTelemetryKind::AgentSpawned) — the root plus every subagent.
    agents_spawned: u64,
    /// The deepest [`AgentSpawned`](GgTelemetryKind::AgentSpawned) depth seen (`0` for the root).
    max_subagent_depth: u64,
    /// One per [`Compaction`](GgTelemetryKind::Compaction) boundary.
    compactions: u64,
    /// How many [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) turns reported fullness at
    /// or above the ceiling (`>= 1.0`).
    context_overflow_count: u64,
    /// The fullness of the most recent [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) that
    /// carried one.
    final_fullness: Option<f64>,
    /// One per issue-review [`Requested`](GgIssueReviewPhase::Requested) phase.
    issue_reviews: u64,
    /// One per issue-review verdict — a [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) or
    /// an [`Approved`](GgIssueReviewPhase::Approved) phase.
    review_cycles: u64,
    /// One per [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase (an issue reopened
    /// for fixes).
    issues_reopened: u64,
    /// One per [`CodeExecution`](GgTelemetryKind::CodeExecution) event (a code-shaped turn).
    code_executions: u64,
    /// The milliseconds those same [`CodeExecution`](GgTelemetryKind::CodeExecution) events
    /// reported spending in their language's compiler, summed — so
    /// [`code_executions`](Self::code_executions) is the exact denominator for the per-program
    /// compile cost. A program whose language compiles nothing carries no figure and adds nothing.
    compile_ms: u64,
    /// The run's [error rollup](GgErrorSummary), folded from the
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome) event every agent emits once per turn — so the
    /// numerator (errors) and the denominator ([`turns`](GgErrorSummary::turns)) come off the same
    /// statement, and neither can drift from the number of model calls the run made.
    ///
    /// Run-wide across the root and every subagent, because that is the stream this one tracker
    /// observes. The per-agent breakdown is not lost: each event rides on its own agent's id, so a
    /// reader of the stream can split what this rollup totals.
    ///
    /// The contract type doubles as the accumulator — it is
    /// [`Default`] and every field is a `u64` counter — so there is nothing to convert at
    /// [finalize](SessionSummaryTracker::finalize) time and no second shape that could disagree
    /// with the one the run records.
    errors: GgErrorSummary,
    /// The run's [rejected-reply rollup](GgRejectedResponses), folded from the
    /// [`ResponseRejected`](GgTelemetryKind::ResponseRejected) events — the place a rejected
    /// call's spend is answerable *as a rejection*. Its price is in the run's
    /// [total cost](GgSessionSummary::cost) through the same call's `Usage` delta, and out of
    /// the work cost, which is over turns that produced something.
    rejected: GgRejectedResponses,
    /// The longest reply of any turn the provider did not cut off at its output cap, in
    /// characters — the model's raw text plus the `program` string of every `submit_program` call
    /// the turn made. A maximum over the [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events'
    /// `response_chars`, folded whatever the turn's outcome, so it is the datum a later output
    /// ceiling is judged against.
    max_response_chars: u64,
    /// The same maximum in the provider's own unit: completion tokens (output plus reasoning).
    max_response_output_tokens: u64,
    /// The run's [discovery rollup](GgUndocumentedCalls) — how many calls its models wrote without
    /// ever having read what they do, and which — folded from the same
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) event
    /// [`code_executions`](Self::code_executions) is counted from, so the finding and the turns it
    /// is a rate over come off one statement.
    ///
    /// Like [`errors`](Self::errors), the contract type doubles as
    /// the accumulator: it is [`Default`], it merges into itself, and there is no second shape here
    /// that could disagree with the one the run records.
    ///
    /// All zeroes for a tool-calling run, which emits no such event, and for the well-behaved code
    /// run — which is the answer worth being able to state rather than infer.
    undocumented: GgUndocumentedCalls,
    /// The run's [execution mode](GgSessionSummary::execution_mode) — `"responses_as_code"` or
    /// `"tool_calling"`. Like [`effective_tools`](Self::effective_tools) this is **not**
    /// telemetry-derived (no event carries the configured mode); the binary records it once via
    /// [`record_execution_mode`](SessionSummaryTracker::record_execution_mode). Defaults to
    /// tool-calling until set.
    execution_mode: Option<String>,
    /// The run's [program language](GgSessionSummary::program_language), recorded on exactly the
    /// terms [`execution_mode`](Self::execution_mode) is: no event carries it, so the binary sets it
    /// once off the run's configuration. `None` for a tool-calling run, which writes no programs.
    program_language: Option<GgProgramLanguage>,
    /// Every distinct issue id observed on the board.
    issues_created: BTreeSet<String>,
    /// Every distinct issue id observed at [`Done`](GgIssueStatus::Done) on the board.
    issues_completed: BTreeSet<String>,
    /// One entry per [`SlotUsage`](GgTelemetryKind::SlotUsage) rollup, captured in emission order.
    /// Each entry's `work_cost` is joined on at [finalize](SessionSummaryTracker::finalize) from
    /// the same run's [`Usage`](GgTelemetryKind::Usage) deltas — the only events that carry the
    /// figure mark — keyed by the entry's own `(profile, model)`, since a `SlotUsage` rollup
    /// predates nothing and reports the totals either way.
    slot_costs: Vec<GgSlotCost>,
    /// The run's **work cost** per `(profile, model)`, folded from the
    /// [`Usage`](GgTelemetryKind::Usage) deltas marked [`work`](GgUsageFigure::Work) — the turns
    /// that produced a program or a tool call gg ran. Joined onto
    /// [`slot_costs`](Self::slot_costs) at finalize, where a total-marked delta never comes: the
    /// run's faults belong in the [total](GgSessionSummary::cost) alone. Opened only by a
    /// **priced** work delta — a work turn that reported no price leaves the figure honestly
    /// `None` rather than opening an entry nothing can read a figure out of.
    slot_work: BTreeMap<(String, String), Cost>,
    /// The run's [provider-health rollup](GgProviderStat), keyed `(provider, model)` — a
    /// [`BTreeMap`] so [finalize](SessionSummaryTracker::finalize) emits the slices in a
    /// deterministic order (the providerless slice first, then lexicographic) without a sort of
    /// its own.
    ///
    /// Folded from three events, each attributed to the provider its own call named: a
    /// [`Usage`](GgTelemetryKind::Usage) delta contributes a call with its tokens and cost, a
    /// [`ResponseRejected`](GgTelemetryKind::ResponseRejected) a rejection, and a
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome) a turn — via the pending marker its agent's
    /// [attribution](AgentAttribution) holds, so a turn whose call named no provider (a model
    /// timeout named none at all) lands on the providerless slice rather than on a neighbour's.
    provider_stats: BTreeMap<(Option<String>, Option<String>), ProviderAcc>,
    /// What is currently known about each agent for provider attribution, keyed by the agent id
    /// the event rode in on. Events emitted with no agent id (the base emitter's) contribute to
    /// the slices directly but never to an attribution.
    attributions: BTreeMap<String, AgentAttribution>,
    /// Every dispatched tool call — one per [`ToolResult`](GgTelemetryKind::ToolResult), failed or
    /// not — the denominator [`GgErrorSummary::tool_failures`] is read against.
    tool_calls: u64,
    /// The [effective toolset](GgSessionSummary::effective_tools) — the exact tool names offered to
    /// the run's (root) agent, in the order presented to the model. Unlike every other field this is
    /// **not** telemetry-derived (no event carries the offered toolset); the binary records it once,
    /// off the assembled [`ToolRegistry`](crate::tools::ToolRegistry), via
    /// [`record_effective_tools`](SessionSummaryTracker::record_effective_tools).
    effective_tools: Vec<String>,
    /// The [execution ceilings](GgRunLimits) that were in force for the run — the configured set
    /// with gg's own turn default filled in. Like [`effective_tools`](Self::effective_tools) this
    /// is a resolved configuration fact no event carries, recorded once via
    /// [`record_limits`](SessionSummaryTracker::record_limits). Defaults to "no ceiling declared"
    /// until set, which is also what a run that never reached the resolver reports.
    limits: GgRunLimits,
    /// The ceiling that stopped the **run**, when one did — the root agent's own breach, recorded
    /// once via [`record_limit_hit`](SessionSummaryTracker::record_limit_hit) from the root loop's
    /// outcome.
    ///
    /// Deliberately **not** folded from [`LimitExceeded`](GgTelemetryKind::LimitExceeded), even
    /// though that event carries exactly this payload: every agent's stream passes through this one
    /// tracker, and a subagent that stopped on its own error ceiling reported back through the
    /// delegation channel while the run carried on. Folding the event would publish that child's
    /// ceiling as the run's outcome.
    limit_hit: Option<GgLimitBreach>,
}

/// The accumulator behind one `(provider, model)` slice of the
/// [provider rollup](SummaryState::provider_stats) — the counted fields of a [`GgProviderStat`],
/// without the key the map already holds.
#[derive(Default)]
struct ProviderAcc {
    /// [`Usage`](GgTelemetryKind::Usage) deltas folded in — calls that reported usage.
    calls: u64,
    /// The tokens those calls reported, summed on [`fold_counts`]'s terms.
    tokens: TokenCounts,
    /// Their cost, summed on [`fold_cost`]'s terms.
    cost: Option<Cost>,
    /// [`ResponseRejected`](GgTelemetryKind::ResponseRejected) events attributed here.
    rejected: u64,
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome) events attributed here.
    turns: u64,
    /// The turns among them that progressed or finished.
    working: u64,
    /// The errored turns among them, keyed by [`GgTurnErrorType::wire_id`] exactly as
    /// [`GgErrorSummary::by_type`] is.
    errors: BTreeMap<String, u64>,
}

/// What the tracker knows about one agent between its events — the state provider attribution
/// rides on, keyed per agent because the stream is run-wide and two agents' turns interleave
/// arbitrarily.
#[derive(Default)]
struct AgentAttribution {
    /// The model the agent's most recent [`Usage`](GgTelemetryKind::Usage) delta named. An
    /// agent's binding is fixed, so this is its model from the first delta on; before that it is
    /// honestly unknown.
    model: Option<String>,
    /// The provider marker the agent's current turn has set — `Some` once this turn's
    /// `Usage`/`Prompt`/`ResponseRejected` named its serving provider (the inner `None` is a call
    /// that named none), taken and cleared by the turn's own
    /// [`TurnOutcome`](GgTelemetryKind::TurnOutcome). A turn that set no marker — its call
    /// produced no reply at all — is attributed to the providerless slice.
    pending: Option<Option<String>>,
}

impl SummaryState {
    /// The `(provider, model)` slice accumulator, created zeroed on first touch.
    fn provider_slice(
        &mut self,
        provider: Option<String>,
        model: Option<String>,
    ) -> &mut ProviderAcc {
        self.provider_stats.entry((provider, model)).or_default()
    }

    /// The [attribution](AgentAttribution) for `agent_id`, created empty on first touch.
    fn attribution(&mut self, agent_id: &str) -> &mut AgentAttribution {
        self.attributions.entry(agent_id.to_string()).or_default()
    }

    /// Attribute one turn's [outcome](GgTelemetryKind::TurnOutcome) to the provider its own call
    /// named — the pending marker `agent_id`'s attribution holds, taken so the next turn starts
    /// unmarked. A turn with no marker (its call produced no reply), and every turn of an event
    /// that rode in with no agent id, lands on the providerless slice.
    ///
    /// The error is keyed by [`GgTurnErrorType::wire_id`] only when the event carried the type,
    /// exactly as [`fold_turn_outcome`](Self::fold_turn_outcome)'s open breakdown is — so the
    /// slice's map stays a strict re-slicing of [`GgErrorSummary::by_type`] by provider.
    fn fold_turn_provider(
        &mut self,
        agent_id: Option<&str>,
        outcome: GgTurnOutcome,
        error_type: Option<GgTurnErrorType>,
    ) {
        let (provider, model) = match agent_id {
            Some(agent_id) => {
                let attribution = self.attribution(agent_id);
                (
                    attribution.pending.take().flatten(),
                    attribution.model.clone(),
                )
            }
            None => (None, None),
        };
        let slice = self.provider_slice(provider, model);
        slice.turns += 1;
        match outcome {
            GgTurnOutcome::Progressed | GgTurnOutcome::Finished => slice.working += 1,
            GgTurnOutcome::Error => {
                if let Some(error_type) = error_type {
                    *slice
                        .errors
                        .entry(error_type.wire_id().to_string())
                        .or_default() += 1;
                }
            }
            // A fatal turn is attributed (it advances the slice's `turns`) and charged to nothing,
            // exactly as the run-wide rollup treats it.
            GgTurnOutcome::Fatal => {}
        }
    }
    /// Fold one turn's [outcome](GgTelemetryKind::TurnOutcome) into the run's
    /// [error rollup](GgErrorSummary).
    ///
    /// Split out of [`observe`](SessionSummaryTracker::observe) because it is arithmetic
    /// with definitions in it, and those definitions are:
    ///
    /// * **every** recorded turn advances [`turns`](GgErrorSummary::turns), whatever its outcome,
    ///   including the one that finished the session and the one that ended it fatally. That is what
    ///   makes the denominator the count of model calls the run made rather than the count of turns
    ///   that could have failed;
    /// * [`max_consecutive`](GgErrorSummary::max_consecutive) is a **maximum over the per-turn
    ///   counts**, not a streak this tracker keeps. The count is per agent and this stream is
    ///   run-wide, so a streak folded here would be an artefact of how two agents' turns happened to
    ///   interleave;
    /// * a fatal turn advances `turns` and no other counter of the error rollup: gg's own
    ///   machinery failing is not charged to the model's error budget, exactly as no ceiling ever
    ///   observes one. Its reply still sets the response maxima, which measure how much the model
    ///   wrote rather than what the run made of it;
    /// * the response maxima fold over every turn but the one recorded
    ///   [`ModelLengthCapped`](GgTurnErrorType::ModelLengthCapped), whatever the outcome. A reply
    ///   the provider cut off at its own output cap is the reply an output ceiling exists to cut;
    ///   every other reply was generated whole and says how much the model writes, whether or not
    ///   gg could then use it;
    /// * [`loop_aborts`](GgErrorSummary::loop_aborts) is a plain sum, and is not an error count —
    ///   the discarded attempt was retried and this very turn is the retry's outcome. The two
    ///   sizes beside it are plain sums for the same reason, and are deliberately not folded into
    ///   the run's tokens or its cost: an abandoned stream reports no usage, so the only honest
    ///   units for it are the ones gg counted itself.
    ///
    /// The error is keyed on the [kind](GgTurnErrorKind) rather than on the outcome, which keeps
    /// [`errors`](GgErrorSummary::errors) exactly the sum of the per-kind counters the contract
    /// promises it to be. gg pairs the two by construction (`TurnOutcome::wire` returns them
    /// together), so the two readings only differ for a stream gg did not write — and for one of
    /// those, a total that still agrees with its own parts is the better answer.
    ///
    /// The per-kind `match` is exhaustive on purpose: a kind added to the contract is a compile
    /// error here rather than an error silently missing from every run's rollup. The per-**type**
    /// breakdown beside it is keyed by [`GgTurnErrorType::wire_id`] and is therefore additive
    /// instead: a type added to the contract joins it without an edit here, which is the property
    /// that lets a *"top error types"* ranking gain a row without a schema change. The type is
    /// preferred over the kind when both are present, and the kind is the fallback — so a stream
    /// gg did not write still lands in the named counters even if it carried no type at all, and
    /// `errors == by_type.values().sum()` holds for every stream gg *did* write.
    #[allow(clippy::too_many_arguments)]
    fn fold_turn_outcome(
        &mut self,
        error: Option<GgTurnErrorKind>,
        error_type: Option<GgTurnErrorType>,
        consecutive_errors: u64,
        loop_aborts: u64,
        loop_abort_words: u64,
        loop_abort_chars: u64,
        response_chars: u64,
        response_output_tokens: u64,
    ) {
        // The maxima are taken over every turn but one: the length-capped turn, whose reply the
        // provider cut off at its own output cap. That reply is exactly the thing an output
        // ceiling is meant to cut, so a ceiling chosen from it would be chosen from itself. Every
        // other reply was generated whole and is data about how much the model writes, whatever
        // gg then made of it — the outcome is a judgement on the *work*, and a program long enough
        // to matter here is more likely to fail than a short one, so gating on the outcome would
        // under-report exactly the arms that write the most.
        //
        // gg's own emitter already records a length-capped turn with no size at all, so this guard
        // is the rule stated rather than the rule relied upon: a stream gg did not write, or an
        // emitter later taught to carry the rejected reply's real size, lands on the same answer.
        //
        // The type is the only thing the guard can read, and one path drops it: an errored turn
        // taken on a run gg itself broke is attributed as fatal, and a fatal turn's wire form
        // carries no error type. A length-capped turn that met a gg fault therefore reaches here
        // untyped — and carries no size either, so the maxima are unmoved.
        if error_type != Some(GgTurnErrorType::ModelLengthCapped) {
            self.max_response_chars = self.max_response_chars.max(response_chars);
            self.max_response_output_tokens =
                self.max_response_output_tokens.max(response_output_tokens);
        }
        let rollup = &mut self.errors;
        rollup.turns += 1;
        rollup.max_consecutive = rollup.max_consecutive.max(consecutive_errors);
        rollup.loop_aborts += loop_aborts;
        rollup.loop_abort_words += loop_abort_words;
        rollup.loop_abort_chars += loop_abort_chars;

        let Some(kind) = error.or_else(|| error_type.map(GgTurnErrorType::kind)) else {
            return;
        };
        rollup.errors += 1;
        let count = match kind {
            GgTurnErrorKind::ModelApi => &mut rollup.model_api,
            GgTurnErrorKind::Transpile => &mut rollup.transpile,
            GgTurnErrorKind::ProgramFault => &mut rollup.program_fault,
            GgTurnErrorKind::SandboxLimit => &mut rollup.sandbox_limit,
            GgTurnErrorKind::MissingCompletion => &mut rollup.missing_completion,
        };
        *count += 1;
        if let Some(error_type) = error_type {
            *rollup
                .by_type
                .entry(error_type.wire_id().to_string())
                .or_default() += 1;
        }
    }

    /// Fold one [tool result](GgTelemetryKind::ToolResult) into the run's
    /// [call-failure rollup](GgErrorSummary::tool_failures).
    ///
    /// A **different population** from everything `fold_turn_outcome` counts, and deliberately kept
    /// out of `errors`: a call that failed inside a program the model then handled is the typed
    /// surface working, not a turn failing, and charging it to the error budget would make the one
    /// capability that expects failures the one that cannot survive them. It is counted here
    /// because it was previously counted nowhere at all — a model fighting the same `not-found`
    /// forty times produced forty telemetry events that said only "something went wrong".
    ///
    /// Folded from the **telemetry stream** rather than from the membrane's own roster of composed
    /// calls, and that matters: the roster is capped (it exists to be shown back to a model, not to
    /// be counted), while every dispatched call streams its result pair whatever the cap says. A
    /// count taken off the roster would silently undercount exactly the runaway programs worth
    /// counting.
    fn fold_tool_result(&mut self, failure: Option<GgCallFailure>) {
        let Some(failure) = failure else {
            return;
        };
        *self
            .errors
            .tool_failures
            .entry(failure.wire_id().to_string())
            .or_default() += 1;
    }
}

impl SessionSummaryTracker {
    /// A fresh, empty tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the run's [effective toolset](GgSessionSummary::effective_tools) — the exact set of
    /// tool names offered to the (root) agent, in the order they were presented to the model.
    ///
    /// One of the four summary figures that are recorded rather than folded in from the telemetry
    /// stream (no event carries the offered toolset), so the binary sets it once, off the root
    /// agent's assembled [`ToolRegistry`](crate::tools::ToolRegistry), before
    /// [finalizing](Self::finalize). Recording
    /// the *resolved* toolset — a capability's tools only when enabled, for the stateful ones only
    /// when their store is non-empty, and only the ones this agent's own
    /// [allowlist](test_cabinet_core::gg::GgAgentConfig::tools) grants — makes the toolset a
    /// first-class, sliceable fact rather than something a query must re-derive from the
    /// capability set.
    ///
    /// Empty for a responses-as-code root, which is offered no tools at all. That is a fact rather
    /// than a gap: what such a root was offered is its
    /// [`apis`](test_cabinet_core::gg::GgTelemetryKind::AgentSurface::apis), which is a per-instance
    /// record and not a summary figure.
    pub fn record_effective_tools(&self, tools: Vec<String>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.effective_tools = tools;
    }

    /// Record the run's [execution mode](GgSessionSummary::execution_mode) — `"responses_as_code"`
    /// when the [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) capability
    /// drove the run, else `"tool_calling"`.
    ///
    /// Like [`record_effective_tools`](Self::record_effective_tools) this is a configuration fact no
    /// event carries, so the binary sets it once (off the run's capability set) before
    /// [finalizing](Self::finalize). Recording the mode the run *actually* ran in makes "does a
    /// code-shaped response help?" a durable, sliceable outcome dimension alongside the
    /// [`cap.responses-as-code`](test_cabinet_core::gg_query) document field.
    pub fn record_execution_mode(&self, mode: impl Into<String>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.execution_mode = Some(mode.into());
    }

    /// Record the [program language](GgSessionSummary::program_language) the run's root agent wrote
    /// its programs in — or `None` for a tool-calling run, which wrote none.
    ///
    /// The fourth configuration fact no event carries, recorded on exactly the terms
    /// [`record_execution_mode`](Self::record_execution_mode) is and immediately beside it. It is
    /// the axis a cross-language study slices its arms on, and it is a **scalar**, which is what
    /// makes it queryable for free: the summary is flattened as `summary.*`, so it arrives as
    /// `summary.programLanguage` with no change to the query vocabulary at all.
    ///
    /// `None` and "TypeScript" are genuinely different answers here — the first is a run with no
    /// program language, the second is a run with that one — so it is recorded rather than left to
    /// default, and a reader can tell a tool-calling arm from a code arm without re-deriving the
    /// capability set.
    pub fn record_program_language(&self, language: Option<GgProgramLanguage>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.program_language = language;
    }

    /// Record the [execution ceilings](GgRunLimits) that were actually **in force** for this run —
    /// the configured set with gg's own turn default filled in, as the resolver produced it.
    ///
    /// A third configuration fact no event carries, so the binary sets it once, immediately after
    /// the orchestrator resolves it and long before any ceiling could be breached. Recording the
    /// *resolved* set rather than leaving a query to re-derive it from the
    /// [capability set](test_cabinet_core::gg::GgCapabilitySet) is what makes "what was this run
    /// bounded by?" answerable for every run, including one that declared nothing and inherited the
    /// default — an unrecorded default is an invisible one, and a study that cannot see it cannot
    /// control for it.
    pub fn record_limits(&self, limits: GgRunLimits) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.limits = limits;
    }

    /// Record the [ceiling](GgRunLimits) that stopped the **run**, or `None` for a run that ended on
    /// its own terms.
    ///
    /// Takes an [`Option`] so the binary can hand over the root loop's outcome unconditionally,
    /// right before [finalizing](Self::finalize): the caller has one line and no branch, and "the
    /// run hit no ceiling" is recorded as deliberately as "it hit this one".
    ///
    /// This is the one summary figure whose event *is* on the stream and is still recorded rather
    /// than [folded](Self::observe): every agent shares this tracker, and a subagent that stopped on
    /// its own error ceiling ended itself and reported back while the run carried on, so its breach
    /// is not the run's outcome. Only the root's is, and only the root's loop can hand it over.
    ///
    /// It is therefore **not** the figure the process exit code is raised on, and the two disagree
    /// on purpose. [`CeilingLatch`](crate::limits::CeilingLatch) answers *was a ceiling breached
    /// anywhere in the tree*, because a safeguard nobody expected to be hit is worth the host
    /// knowing about wherever it fired; this answers *how did the run end*. A run whose subagent
    /// spent a ceiling while the root went on to finish exits non-zero and records `None` here, and
    /// both statements are true. Each breach is on the stream as its own
    /// [`LimitExceeded`](GgTelemetryKind::LimitExceeded) event naming the agent it stopped.
    pub fn record_limit_hit(&self, breach: Option<GgLimitBreach>) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        state.limit_hit = breach;
    }

    /// Fold one emitted telemetry event into the running summary.
    ///
    /// Called by the [`Emitter`](crate::telemetry::Emitter) for **every** event it emits, so the
    /// accumulated counts always reflect exactly the stream the run recorded. Only the events that
    /// contribute an aggregatable figure are counted; the rest (session/turn lifecycle, assistant
    /// text, and the terminal
    /// [`SessionSummary`](GgTelemetryKind::SessionSummary)/[`SessionEnded`](GgTelemetryKind::SessionEnded)
    /// events this summary precedes) are observed and ignored.
    ///
    /// `agent_id` is the id the event rides in on — the emitting agent's, or `None` from the base
    /// emitter. The [provider rollup](GgProviderStat) needs it: attribution state (an agent's
    /// model, its current turn's provider marker) is per agent, because the stream is run-wide and
    /// two agents' turns interleave arbitrarily.
    pub fn observe(&self, agent_id: Option<&str>, kind: &GgTelemetryKind) {
        let mut state = self.inner.lock().expect("summary tracker lock");
        match kind {
            GgTelemetryKind::AgentSpawned { depth, .. } => {
                state.agents_spawned += 1;
                state.max_subagent_depth = state.max_subagent_depth.max(*depth);
            }
            GgTelemetryKind::Compaction { .. } => state.compactions += 1,
            GgTelemetryKind::ContextBreakdown {
                fullness: Some(fullness),
                ..
            } => {
                state.final_fullness = Some(*fullness);
                if *fullness >= 1.0 {
                    state.context_overflow_count += 1;
                }
            }
            GgTelemetryKind::IssueReview { phase, .. } => match phase {
                GgIssueReviewPhase::Requested => state.issue_reviews += 1,
                GgIssueReviewPhase::ChangesRequested => {
                    state.review_cycles += 1;
                    state.issues_reopened += 1;
                }
                GgIssueReviewPhase::Approved => state.review_cycles += 1,
            },
            // One event per submitted *program*, including one whose source did not compile — so
            // this count is the denominator every per-program rate is read against, and the two
            // are incremented by the same statement.
            GgTelemetryKind::CodeExecution {
                compile_ms,
                undocumented_calls,
                ..
            } => {
                state.code_executions += 1;
                // A plain merge rather than arithmetic of its own: the per-program record and the
                // run rollup are one type with one invariant, so there is nothing here to get
                // wrong that the type does not already hold.
                state.undocumented.merge(undocumented_calls);
                // Folded from the same statement as the count it is read against: a
                // compile-cost-per-program assembled from two mechanisms is a ratio whose halves
                // can drift.
                state.compile_ms = state.compile_ms.saturating_add(compile_ms.unwrap_or(0));
            }
            // One event per *turn* of every agent, code-shaped or not — the mode-agnostic judgement
            // the error ceilings are enforced on, folded here so the run records how error-prone it
            // was even when no ceiling ever stopped it.
            GgTelemetryKind::TurnOutcome {
                outcome,
                error,
                error_type,
                consecutive_errors,
                loop_aborts,
                loop_abort_words,
                loop_abort_chars,
                response_chars,
                response_output_tokens,
                ..
            } => {
                state.fold_turn_outcome(
                    *error,
                    *error_type,
                    *consecutive_errors,
                    *loop_aborts,
                    *loop_abort_words,
                    *loop_abort_chars,
                    *response_chars,
                    *response_output_tokens,
                );
                // The same judgement, re-sliced by the provider this turn's own call named — the
                // marker the agent's attribution holds, taken here so the two folds count the one
                // event and the slices' turns sum to the rollup's denominator by construction.
                state.fold_turn_provider(agent_id, *outcome, *error_type);
            }
            // One delta per model call that reported usage — the call-level half of the provider
            // rollup: which provider served the call, on which model, at what token spend. The
            // run-wide slot totals deliberately stay on the `SlotUsage` rollups (every delta's
            // spend is folded into its agent's totals when the delta is counted, so the two agree
            // by construction); this fold only re-slices the deltas by serving provider, and joins
            // the work figure onto the slot it names — a delta marked `work` is a turn that
            // produced a program or a tool call gg ran, and its cost is the slot's work cost.
            GgTelemetryKind::Usage {
                profile_id,
                model_id,
                tokens,
                cost,
                provider,
                figure,
                ..
            } => {
                let slice = state.provider_slice(provider.clone(), Some(model_id.clone()));
                slice.calls += 1;
                slice.tokens = fold_counts(slice.tokens, *tokens);
                slice.cost = fold_cost(slice.cost, *cost);
                if *figure == Some(GgUsageFigure::Work)
                    && let Some(price) = cost
                {
                    // Only a priced work delta opens (or adds to) a slot's work entry: a work
                    // turn that reported no price leaves the figure honestly `None`.
                    state
                        .slot_work
                        .entry((profile_id.clone(), model_id.clone()))
                        .and_modify(|slot| {
                            *slot = fold_cost(Some(*slot), Some(*price))
                                .expect("folding two reported costs reports a cost");
                        })
                        .or_insert(*price);
                }
                if let Some(agent_id) = agent_id {
                    let attribution = state.attribution(agent_id);
                    attribution.model = Some(model_id.clone());
                    attribution.pending = Some(provider.clone());
                }
            }
            // The turn's request/reply pointer list, read here only for the provider that served
            // the reply: it is emitted once per model call whether or not the call reported usage,
            // so it is the marker that keeps a turn attributable when its `Usage` delta was
            // skipped.
            GgTelemetryKind::Prompt { provider, .. } => {
                if let Some(agent_id) = agent_id {
                    state.attribution(agent_id).pending = Some(provider.clone());
                }
            }
            // A reply gg rejected whole (a length-capped one). The rejection's spend reaches the
            // durable record twice over, deliberately: on this rollup — the only place it appears
            // *as a rejection* — and on the `Usage` delta marked `total` that carries it into the
            // run's total cost (never its work cost). The provider that served it is re-sliced
            // onto the provider rollup, where "which provider caps out?" is answerable.
            GgTelemetryKind::ResponseRejected {
                tokens,
                cost,
                provider,
                ..
            } => {
                state.rejected.count += 1;
                state.rejected.tokens = fold_counts(state.rejected.tokens, *tokens);
                state.rejected.cost = fold_cost(state.rejected.cost, *cost);
                let model = agent_id.and_then(|agent_id| state.attribution(agent_id).model.clone());
                state.provider_slice(provider.clone(), model).rejected += 1;
                if let Some(agent_id) = agent_id {
                    state.attribution(agent_id).pending = Some(provider.clone());
                }
            }
            // One event per dispatched tool call, in either execution mode — the population the
            // call-failure rollup counts, which is calls rather than turns. The total is counted
            // beside the failures so the successful half is derivable from the record.
            GgTelemetryKind::ToolResult { failure, .. } => {
                state.tool_calls += 1;
                state.fold_tool_result(*failure);
            }
            GgTelemetryKind::BoardState { issues, .. } => {
                for issue in issues {
                    state.issues_created.insert(issue.id.clone());
                    if issue.status == GgIssueStatus::Done {
                        state.issues_completed.insert(issue.id.clone());
                    }
                }
            }
            GgTelemetryKind::SlotUsage {
                profile_id,
                model_id,
                tokens,
                cost,
            } => state.slot_costs.push(GgSlotCost {
                profile_id: profile_id.clone(),
                model_id: model_id.clone(),
                tokens: *tokens,
                cost: *cost,
                // Joined from the usage deltas' figure marks at finalize — see
                // [`SummaryState::slot_work`].
                work_cost: None,
            }),
            // Every other event carries no aggregatable figure of its own: session/turn
            // lifecycle, assistant text and tool calls (their results are counted above), the
            // knowledge-state snapshots (skills/memories/tasks), agent-status/worktree/
            // succession transitions, diagnostic logs, and the terminal summary/ended events
            // this summary itself precedes.
            //
            // `LimitExceeded` is here **deliberately** rather than by omission: it carries exactly
            // the payload `limit_hit` wants, but this tracker observes every agent's stream, and a
            // subagent that stopped on its own error ceiling is not how the run ended. The root
            // loop's breach is `record_limit_hit`'s to give.
            _ => {}
        }
    }

    /// Build the [`GgSessionSummary`] from the accumulated state, stamped with the run's
    /// `terminal_status` (the [`SessionEnded`](GgTelemetryKind::SessionEnded) status this summary
    /// precedes). Called once at session end; the tracker is not reset (a run computes one
    /// summary).
    ///
    /// Copies out both halves of the state — the counts folded from the stream and the four facts
    /// the binary [recorded](Self::record_limits) — so a figure the binary never recorded reports
    /// its own default (no ceilings declared, no ceiling hit) rather than being absent, which is
    /// exactly what a run that ended before the resolver ran should say.
    pub fn finalize(&self, terminal_status: &str) -> GgSessionSummary {
        let state = self.inner.lock().expect("summary tracker lock");
        // The per-slot rollup with its two figures joined: the totals each `SlotUsage` event
        // carried, plus the work figure folded from the run's `Usage` deltas — see
        // [`SummaryState::slot_work`]. Built ahead of the summary so the run-wide rollup below is
        // summed from exactly the entries the summary carries, and cannot diverge from them.
        let mut slot_costs = state.slot_costs.clone();
        let mut slot_work = state.slot_work.clone();
        for entry in &mut slot_costs {
            entry.work_cost = slot_work.remove(&(entry.profile_id.clone(), entry.model_id.clone()));
        }
        // A work-marked delta whose rollup event never arrived: keep the spend rather than drop
        // it — the delta is the evidence it happened, and a slot keyed differently is still a
        // slot the run spent on.
        for ((profile_id, model_id), work_cost) in slot_work {
            slot_costs.push(GgSlotCost {
                profile_id,
                model_id,
                tokens: TokenCounts::default(),
                cost: None,
                work_cost: Some(work_cost),
            });
        }
        // The run-wide rollup of the two figures: `cost` is the total over every request the run
        // made that reported a price — errored and rejected attempts included, because each one's
        // spend was folded into its agent's totals when its delta was counted — and `work_cost`
        // is the work over the turns that produced a program or a tool call gg ran. Each is the
        // sum of its figure across `slot_costs`, by construction rather than by agreement.
        let cost = slot_costs
            .iter()
            .fold(None, |acc, entry| fold_cost(acc, entry.cost));
        let work_cost = slot_costs
            .iter()
            .fold(None, |acc, entry| fold_cost(acc, entry.work_cost));
        GgSessionSummary {
            terminal_status: terminal_status.to_string(),
            agents_spawned: state.agents_spawned,
            // Every agent but the root is a subagent; a single-agent run reports `0`.
            subagent_count: state.agents_spawned.saturating_sub(1),
            max_subagent_depth: state.max_subagent_depth,
            compactions: state.compactions,
            ran_out_of_context: state.context_overflow_count > 0,
            context_overflow_count: state.context_overflow_count,
            final_fullness: state.final_fullness,
            issue_reviews: state.issue_reviews,
            review_cycles: state.review_cycles,
            issues_reopened: state.issues_reopened,
            execution_mode: state
                .execution_mode
                .clone()
                .unwrap_or_else(|| "tool_calling".to_string()),
            program_language: state.program_language,
            code_executions: state.code_executions,
            compile_ms: state.compile_ms,
            errors: state.errors.clone(),
            tool_calls: state.tool_calls,
            rejected_responses: state.rejected.clone(),
            max_response_chars: state.max_response_chars,
            max_response_output_tokens: state.max_response_output_tokens,
            undocumented_calls: state.undocumented.clone(),
            issues_created: state.issues_created.len() as u64,
            issues_completed: state.issues_completed.len() as u64,
            slot_costs,
            cost,
            work_cost,
            // The map key carries the identity and the accumulator the counts; the map's own
            // order (providerless first, then lexicographic) is the deterministic order the
            // contract promises, so this is a walk rather than a sort.
            provider_stats: state
                .provider_stats
                .iter()
                .map(|((provider, model_id), acc)| GgProviderStat {
                    provider: provider.clone(),
                    model_id: model_id.clone(),
                    calls: acc.calls,
                    tokens: acc.tokens,
                    cost: acc.cost,
                    rejected: acc.rejected,
                    turns: acc.turns,
                    working: acc.working,
                    errors: acc.errors.clone(),
                })
                .collect(),
            effective_tools: state.effective_tools.clone(),
            limits: state.limits,
            limit_hit: state.limit_hit.clone(),
        }
    }
}

/// Sum two [`TokenCounts`], keeping a class `None` only when it is unreported on both sides —
/// the metrics contract's "unreported is distinct from zero", applied to the rejected rollup.
fn fold_counts(acc: TokenCounts, delta: TokenCounts) -> TokenCounts {
    let add = |a: Option<u64>, b: Option<u64>| match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    };
    TokenCounts {
        uncached_input: add(acc.uncached_input, delta.uncached_input),
        cached_input: add(acc.cached_input, delta.cached_input),
        output: add(acc.output, delta.output),
        reasoning: add(acc.reasoning, delta.reasoning),
    }
}

/// Sum two optional [`Cost`]s on the same "unreported stays unreported" terms as [`fold_counts`].
fn fold_cost(acc: Option<Cost>, delta: Option<Cost>) -> Option<Cost> {
    let add = |a: Option<f64>, b: Option<f64>| match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
    };
    match (acc, delta) {
        (None, None) => None,
        (acc, delta) => {
            let acc = acc.unwrap_or_default();
            let delta = delta.unwrap_or_default();
            Some(Cost {
                comparable: add(acc.comparable, delta.comparable),
                actual: add(acc.actual, delta.actual),
            })
        }
    }
}

#[cfg(test)]
#[path = "summary.test.rs"]
mod tests;
