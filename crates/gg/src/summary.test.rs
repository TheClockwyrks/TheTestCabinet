//! Unit tests for the [`SessionSummaryTracker`]: fed a synthetic telemetry stream, its
//! finalized [`GgSessionSummary`] counts each aggregatable figure exactly as the stream
//! carried it. The end-to-end "summary matches a scripted run's stream" coverage lives in
//! `agent.test.rs`, driving the real emitter.

use std::collections::BTreeMap;

use super::*;
// `GgTurnOutcome` is the one contract type these tests construct that the module under test never
// names: the fold keys on the error *kind*, which is what keeps `errors` the sum of its parts.
use test_cabinet_core::gg::{
    GgBoardIssue, GgCapabilitySet, GgContextSourceUsage, GgLimitKind, GgToolFailure,
    GgTurnErrorType, GgTurnOutcome,
};
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// A board issue with the given id and status (the scope/description fields are irrelevant to
/// the summary, which keys only on id and status).
fn issue(id: &str, status: GgIssueStatus) -> GgBoardIssue {
    GgBoardIssue {
        id: id.to_string(),
        title: id.to_string(),
        description: None,
        in_scope: String::new(),
        out_of_scope: String::new(),
        completion_criteria: String::new(),
        status,
        blocked_by: Vec::new(),
        epic_id: None,
        agent: String::new(),
        reviewers: Vec::new(),
        assigned_agent_id: None,
        retries: 0,
    }
}

/// A `ContextBreakdown` reporting the given fullness (the per-source bands are irrelevant to
/// the summary, which reads only the fullness figure).
fn breakdown(fullness: f64) -> GgTelemetryKind {
    GgTelemetryKind::ContextBreakdown {
        by_source: vec![GgContextSourceUsage {
            source: test_cabinet_core::gg::GgContextSource::History,
            tokens: 100,
        }],
        total_tokens: 100,
        window_limit: Some(100),
        fullness: Some(fullness),
    }
}

/// A `CodeExecution` event carrying `healing` — one code-shaped turn of a language that compiles
/// nothing, which is what TypeScript's type-strip is. The summary reads the healing record, the
/// compile figure and the event's existence, so every other field is the shape a turn that ran would
/// really carry.
fn code_turn(healing: GgResponseHealing) -> GgTelemetryKind {
    code_turn_compiling(healing, None)
}

/// The same turn, from a language whose prepare step invoked a compiler and reported what it cost.
fn code_turn_compiling(healing: GgResponseHealing, compile_ms: Option<u64>) -> GgTelemetryKind {
    GgTelemetryKind::CodeExecution {
        ok: true,
        tool_calls: 0,
        api_calls: 0,
        duration_ms: Some(0),
        error: None,
        finished: None,
        logs: Vec::new(),
        logs_suppressed: 0,
        compile_wait_ms: None,
        compile_ms,
        healing,
    }
}

/// A healing record for a response that was repaired by `strategies` and then ran.
fn healed(strategies: &[GgHealingStrategy]) -> GgResponseHealing {
    GgResponseHealing {
        strategies: strategies.to_vec(),
        ..GgResponseHealing::default()
    }
}

/// One recorded turn: how it ended, the agent's consecutive-error run after it, and how many
/// looping replies were discarded before it produced one.
///
/// `turns` is the agent's own running total, which the summary deliberately ignores — it counts the
/// events themselves, because the stream is run-wide and two agents' per-agent totals would be added
/// together into a figure that means nothing. Set to a distinctive number here so a rollup that
/// mistakenly read it would be caught.
fn turn(
    outcome: GgTurnOutcome,
    error_type: Option<GgTurnErrorType>,
    consecutive_errors: u64,
    loop_aborts: u64,
) -> GgTelemetryKind {
    GgTelemetryKind::TurnOutcome {
        outcome,
        // Derived from the type rather than passed in, exactly as gg emits it: the two halves of a
        // recorded error come from one value, so a fixture that could set them independently could
        // assert a shape gg cannot produce.
        error: error_type.map(GgTurnErrorType::kind),
        error_type,
        consecutive_errors,
        turns: 999,
        loop_aborts,
    }
}

/// A turn that carried out its declared work: no error, no streak, nothing discarded.
fn progressed() -> GgTelemetryKind {
    turn(GgTurnOutcome::Progressed, None, 0, 0)
}

/// An error turn of `error_type`, arriving `consecutive_errors` deep into that agent's streak.
fn errored(error_type: GgTurnErrorType, consecutive_errors: u64) -> GgTelemetryKind {
    turn(
        GgTurnOutcome::Error,
        Some(error_type),
        consecutive_errors,
        0,
    )
}

/// One dispatched tool call's result, as the call-failure rollup reads it.
fn tool_result(ok: bool, failure: Option<GgToolFailure>) -> GgTelemetryKind {
    GgTelemetryKind::ToolResult {
        name: "read_file".to_string(),
        ok,
        summary: None,
        failure,
    }
}

/// A breach of `limit`, attributed to `agent_id`. The figures are the shape a real breach carries
/// (threshold, what was observed, and how many turns that agent had taken); the summary carries the
/// record verbatim and reads none of them.
fn breach(limit: GgLimitKind, agent_id: &str) -> GgLimitBreach {
    GgLimitBreach {
        limit,
        threshold: 3.0,
        observed: 3.0,
        turns: 7,
        agent_id: agent_id.to_string(),
        window: None,
    }
}

/// An empty tracker finalizes to a single-agent, nothing-happened summary carrying only the
/// terminal status.
#[test]
fn empty_tracker_finalizes_to_a_zeroed_summary() {
    let summary = SessionSummaryTracker::new().finalize("completed");
    assert_eq!(summary.terminal_status, "completed");
    assert_eq!(summary.agents_spawned, 0);
    assert_eq!(summary.subagent_count, 0);
    assert_eq!(summary.max_subagent_depth, 0);
    assert_eq!(summary.compactions, 0);
    assert!(!summary.ran_out_of_context);
    assert_eq!(summary.context_overflow_count, 0);
    assert_eq!(summary.final_fullness, None);
    assert_eq!(summary.issue_reviews, 0);
    assert_eq!(summary.review_cycles, 0);
    assert_eq!(summary.issues_reopened, 0);
    assert_eq!(summary.issues_created, 0);
    assert_eq!(summary.issues_completed, 0);
    assert!(summary.slot_costs.is_empty());
    // The effective toolset is empty until the binary records it off the assembled registry.
    assert!(summary.effective_tools.is_empty());
    // Nothing was healed because nothing was ever sent to heal.
    assert_eq!(summary.code_executions, 0);
    assert_eq!(summary.healing, GgHealingSummary::default());
    // Nothing errored because no turn was ever recorded — and a zeroed rollup with a zero
    // denominator is the honest answer, not "an error rate of nothing".
    assert_eq!(summary.errors, GgErrorSummary::default());
    // The ceilings and the breach are recorded facts, so an unrecorded run reports "none declared"
    // and "none hit" rather than leaving either unanswerable.
    assert_eq!(summary.limits, GgRunLimits::default());
    assert_eq!(summary.limit_hit, None);
}

/// The effective toolset is recorded directly (not folded in from the stream), so it survives on
/// the finalized summary in the exact order the registry offered it — the durable, slice-by
/// ablation variable a query reads.
#[test]
fn records_the_effective_toolset_verbatim() {
    let tracker = SessionSummaryTracker::new();
    // A stray telemetry event flows through the same tracker; it must not disturb the recorded
    // toolset.
    tracker.observe(&GgTelemetryKind::AgentSpawned {
        slot: "primary".to_string(),
        model_id: "mock/echo".to_string(),
        depth: 0,
        brief: None,
        worktree: None,
        cwd: String::new(),
    });
    tracker.record_effective_tools(vec![
        "shell".to_string(),
        "read_file".to_string(),
        "write_file".to_string(),
    ]);

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.effective_tools,
        vec![
            "shell".to_string(),
            "read_file".to_string(),
            "write_file".to_string()
        ]
    );
    // Recording the toolset does not disturb the telemetry-derived counts.
    assert_eq!(summary.agents_spawned, 1);
}

/// The agent-tree figures count every `AgentSpawned` (root included) and track the deepest
/// depth; `subagent_count` is the total minus the root.
#[test]
fn counts_agents_and_max_depth() {
    let tracker = SessionSummaryTracker::new();
    for depth in [0_u64, 1, 1, 2] {
        tracker.observe(&GgTelemetryKind::AgentSpawned {
            slot: "primary".to_string(),
            model_id: "mock/echo".to_string(),
            depth,
            brief: None,
            worktree: None,
            cwd: String::new(),
        });
    }
    let summary = tracker.finalize("completed");
    assert_eq!(summary.agents_spawned, 4);
    assert_eq!(summary.subagent_count, 3);
    assert_eq!(summary.max_subagent_depth, 2);
}

/// Compaction boundaries are counted, and window fullness at or above the ceiling flips the
/// out-of-context flag and is counted; the last breakdown's fullness is the final fullness.
#[test]
fn counts_compactions_and_context_overflow() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&breakdown(0.4));
    tracker.observe(&GgTelemetryKind::Compaction {
        strategy: "self-summarization".to_string(),
        trigger_fullness: 0.8,
        before_tokens: 1000,
        after_tokens: 200,
        summary_tokens: 120,
        retained: test_cabinet_core::gg::GgRetainedState {
            skills: 0,
            tasks: 0,
            memories: 0,
            issues: 0,
        },
        before_by_source: Vec::new(),
        after_by_source: Vec::new(),
        summary: "a summary".to_string(),
        summary_fallback: false,
    });
    tracker.observe(&breakdown(1.0));
    tracker.observe(&breakdown(1.2));
    tracker.observe(&breakdown(0.9));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.compactions, 1);
    // Two breakdowns at/above the ceiling (1.0 and 1.2); 0.9 does not count.
    assert_eq!(summary.context_overflow_count, 2);
    assert!(summary.ran_out_of_context);
    // The final fullness is the last breakdown's, even though it is below the ceiling.
    assert_eq!(summary.final_fullness, Some(0.9));
}

/// A breakdown with no fullness figure (no known window) leaves the fullness signals untouched.
#[test]
fn a_breakdown_without_fullness_does_not_flag_overflow() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&GgTelemetryKind::ContextBreakdown {
        by_source: Vec::new(),
        total_tokens: 100,
        window_limit: None,
        fullness: None,
    });
    let summary = tracker.finalize("completed");
    assert_eq!(summary.final_fullness, None);
    assert_eq!(summary.context_overflow_count, 0);
    assert!(!summary.ran_out_of_context);
}

/// Issue-review phases split into three figures: reviews triggered (`Requested`), verdicts
/// rendered (`ChangesRequested` + `Approved`), and issues reopened (`ChangesRequested`).
#[test]
fn counts_code_review_phases() {
    let tracker = SessionSummaryTracker::new();
    let phase = |p| GgTelemetryKind::IssueReview {
        phase: p,
        items: None,
        reviewer: None,
        approvals: None,
        baseline: None,
    };
    // One review that took one fix round: requested → changes → approved.
    tracker.observe(&phase(GgIssueReviewPhase::Requested));
    tracker.observe(&phase(GgIssueReviewPhase::ChangesRequested));
    tracker.observe(&phase(GgIssueReviewPhase::Approved));
    // A second review approved on the first pass: requested → approved.
    tracker.observe(&phase(GgIssueReviewPhase::Requested));
    tracker.observe(&phase(GgIssueReviewPhase::Approved));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.issue_reviews, 2);
    // Two approvals + one changes-requested = three verdicts.
    assert_eq!(summary.review_cycles, 3);
    assert_eq!(summary.issues_reopened, 1);
}

/// A board re-emitted every mutation contributes each issue once (created) and each completed
/// issue once, so an issue reopened and re-completed still counts a single completion.
#[test]
fn counts_distinct_issues_created_and_completed_across_board_snapshots() {
    let tracker = SessionSummaryTracker::new();
    // First snapshot: two open issues.
    tracker.observe(&GgTelemetryKind::BoardState {
        module_id: "board-0".to_string(),
        epics: Vec::new(),
        issues: vec![
            issue("a", GgIssueStatus::Open),
            issue("b", GgIssueStatus::InProgress),
        ],
    });
    // Later: `a` done, `b` still in progress, a new `c` open.
    tracker.observe(&GgTelemetryKind::BoardState {
        module_id: "board-0".to_string(),
        epics: Vec::new(),
        issues: vec![
            issue("a", GgIssueStatus::Done),
            issue("b", GgIssueStatus::InProgress),
            issue("c", GgIssueStatus::Open),
        ],
    });
    // Later still: `a` reopened, `b` done.
    tracker.observe(&GgTelemetryKind::BoardState {
        module_id: "board-0".to_string(),
        epics: Vec::new(),
        issues: vec![
            issue("a", GgIssueStatus::InProgress),
            issue("b", GgIssueStatus::Done),
            issue("c", GgIssueStatus::Open),
        ],
    });

    let summary = tracker.finalize("completed");
    assert_eq!(summary.issues_created, 3, "a, b, c each counted once");
    assert_eq!(
        summary.issues_completed, 2,
        "a and b each reached Done at some point"
    );
}

/// Each `SlotUsage` rollup is captured verbatim, in emission order, as a per-slot cost entry.
#[test]
fn captures_per_slot_cost_rollups() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&GgTelemetryKind::SlotUsage {
        slot: "primary".to_string(),
        model_id: "mock/primary".to_string(),
        tokens: TokenCounts {
            uncached_input: Some(1000),
            cached_input: None,
            output: Some(200),
            reasoning: None,
        },
        cost: Some(Cost {
            comparable: Some(0.05),
            actual: Some(0.05),
        }),
    });
    tracker.observe(&GgTelemetryKind::SlotUsage {
        slot: "reviewer".to_string(),
        model_id: "mock/reviewer".to_string(),
        tokens: TokenCounts {
            uncached_input: Some(300),
            cached_input: None,
            output: Some(40),
            reasoning: None,
        },
        cost: None,
    });

    let summary = tracker.finalize("model_error");
    assert_eq!(summary.terminal_status, "model_error");
    assert_eq!(summary.slot_costs.len(), 2);
    assert_eq!(summary.slot_costs[0].slot, "primary");
    assert_eq!(summary.slot_costs[0].model_id, "mock/primary");
    assert_eq!(summary.slot_costs[0].tokens.output, Some(200));
    assert_eq!(
        summary.slot_costs[0].cost.and_then(|c| c.actual),
        Some(0.05)
    );
    assert_eq!(summary.slot_costs[1].slot, "reviewer");
    assert_eq!(summary.slot_costs[1].cost, None);
}

/// The terminal `SessionSummary`/`SessionEnded` events (which flow through the same emitter,
/// so the tracker observes them too) contribute nothing — the summary excludes itself.
#[test]
fn observing_the_terminal_events_is_a_no_op() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&GgTelemetryKind::SessionStarted {
        capability_set: Box::new(GgCapabilitySet::minimal("mock/echo")),
    });
    tracker.observe(&GgTelemetryKind::SessionSummary {
        summary: Box::new(SessionSummaryTracker::new().finalize("completed")),
    });
    tracker.observe(&GgTelemetryKind::SessionEnded {
        status: "completed".to_string(),
    });
    let summary = tracker.finalize("completed");
    assert_eq!(summary.agents_spawned, 0);
    assert!(summary.slot_costs.is_empty());
}

/// The healing rollup is folded from the very events `code_executions` counts, so a mixed run —
/// clean turns, repaired turns, a turn repaired twice by one strategy, and one the pipeline could
/// not converge on — totals every counter exactly, and the denominator counts *turns* rather than
/// only the ones that needed something.
#[test]
fn the_healing_rollup_folds_every_code_execution() {
    let tracker = SessionSummaryTracker::new();

    // A clean program: nothing to repair, so it contributes only to the denominator.
    tracker.observe(&code_turn(GgResponseHealing::default()));
    // A fenced program padded with prose: two strategies, one heal.
    tracker.observe(&code_turn(healed(&[
        GgHealingStrategy::StripFences,
        GgHealingStrategy::StripProse,
    ])));
    // Nested fences: the same strategy twice on one response is two applications, one heal.
    tracker.observe(&code_turn(healed(&[
        GgHealingStrategy::StripFences,
        GgHealingStrategy::StripFences,
    ])));
    // The pipeline could not reach a fixpoint, so every repair was discarded and the response ran
    // exactly as sent — an unusual response that was nonetheless healed of nothing.
    tracker.observe(&code_turn(GgResponseHealing {
        did_not_converge: true,
        ..GgResponseHealing::default()
    }));

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.code_executions, 4,
        "every code-shaped turn counts, including the two that needed nothing"
    );
    assert_eq!(
        summary.healing,
        GgHealingSummary {
            healed: 2,
            applications: 4,
            strip_fences: 3,
            strip_prose: 1,
            drop_doubled_response: 0,
            // Nothing recorded an armed set on this tracker: `record_healing` is a launch-time
            // fact, and these events were folded on their own.
            enabled: Vec::new(),
        }
    );
    assert!(
        summary.healing.applications >= summary.healing.healed,
        "a heal is at least one application, since one reply may need several"
    );
}

/// A tool-calling run never heals anything, because healing only exists on the responses-as-code
/// path — so its rollup and its denominator are both zero even over a busy stream.
#[test]
fn a_tool_calling_run_reports_a_zeroed_healing_rollup() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&GgTelemetryKind::AgentSpawned {
        slot: "primary".to_string(),
        model_id: "mock/echo".to_string(),
        depth: 0,
        brief: None,
        worktree: None,
        cwd: String::new(),
    });
    tracker.observe(&GgTelemetryKind::AssistantMessage {
        text: "calling a tool".to_string(),
    });
    tracker.observe(&GgTelemetryKind::ToolCall {
        name: "write_file".to_string(),
        args: serde_json::json!({ "path": "index.html" }),
    });
    tracker.record_execution_mode("tool_calling");

    let summary = tracker.finalize("completed");
    assert_eq!(summary.execution_mode, "tool_calling");
    assert_eq!(summary.code_executions, 0);
    assert_eq!(summary.healing, GgHealingSummary::default());
    assert_eq!(
        summary.compile_ms, 0,
        "a tool-calling run compiles nothing, and says so rather than saying nothing"
    );
}

/// **What compiling cost the run is folded from the very events `code_executions` counts**, which is
/// what makes the two an honest ratio: a cross-language study divides one by the other to ask what a
/// turn of arm A costs against a turn of arm B, and a numerator and denominator assembled from
/// different mechanisms could drift.
///
/// A turn whose language compiles nothing carries no figure and contributes nothing, while still
/// counting as a turn — so an arm that compiles on some turns and not others reports the compile
/// time it actually paid over the whole of its turns, not over a subset of them.
#[test]
fn the_compile_rollup_folds_every_code_execution_that_reported_one() {
    let tracker = SessionSummaryTracker::new();

    tracker.observe(&code_turn_compiling(
        GgResponseHealing::default(),
        Some(1_400),
    ));
    // A repaired reply compiles like any other, and its cost counts the same.
    tracker.observe(&code_turn_compiling(
        healed(&[GgHealingStrategy::StripFences]),
        Some(1_100),
    ));
    // The turn the compiler rejected: it cost real seconds and is exactly the turn whose cost would
    // otherwise vanish, because nothing else about it is non-zero.
    tracker.observe(&code_turn_compiling(
        GgResponseHealing::default(),
        Some(3_900),
    ));
    // A turn that reported no figure at all — the shape every TypeScript turn has.
    tracker.observe(&code_turn(GgResponseHealing::default()));

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.code_executions, 4,
        "the turn that reported no compile figure is still a turn"
    );
    assert_eq!(
        summary.compile_ms, 6_400,
        "every reported compile, including the one the compiler refused the program on"
    );
}

/// A whole run of a language that compiles nothing reports `0`, not an absence. The distinction the
/// per-turn event draws — `null` means "there is no compiler on this path" — is deliberately *not*
/// drawn at the run level: `0` is a measurement a query can average, and a missing field is a run a
/// query silently drops out of its denominator.
#[test]
fn a_run_that_compiled_nothing_reports_zero_rather_than_nothing() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&code_turn(GgResponseHealing::default()));
    tracker.observe(&code_turn(GgResponseHealing::default()));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.code_executions, 2);
    assert_eq!(summary.compile_ms, 0);

    let value = serde_json::to_value(&summary).expect("serialize");
    assert_eq!(
        value.get("compileMs").and_then(serde_json::Value::as_u64),
        Some(0),
        "the figure is on the wire, so a query can average it across arms"
    );
}

/// The resolved ceilings and the ceiling that stopped the run are recorded (not folded) and survive
/// verbatim onto the finalized summary — and a run that hit none omits `limitHit` from the wire
/// entirely, so "stopped by a ceiling" is a present key rather than a value a consumer must compare.
#[test]
fn finalize_carries_the_recorded_ceilings_and_the_breach_that_stopped_the_run() {
    let limits = GgRunLimits {
        max_turns: Some(50),
        max_consecutive_errors: Some(3),
        ..GgRunLimits::default()
    };

    // A run that ended on its own terms: the ceilings it ran under are still recorded, because a
    // default nobody records is a default nobody can control for.
    let quiet = SessionSummaryTracker::new();
    quiet.record_limits(limits);
    quiet.record_limit_hit(None);
    let summary = quiet.finalize("completed");
    assert_eq!(summary.limits, limits);
    assert_eq!(summary.limit_hit, None);
    let json = serde_json::to_value(&summary).expect("summary serializes");
    assert_eq!(json.get("limitHit"), None, "an absent breach omits the key");
    assert_eq!(
        json.pointer("/limits/maxConsecutiveErrors"),
        Some(&serde_json::json!(3)),
        "the ceilings in force are recorded on every run"
    );

    // A run the consecutive-error ceiling stopped: the breach rides through untouched.
    let stopped = SessionSummaryTracker::new();
    stopped.record_limits(limits);
    stopped.record_limit_hit(Some(breach(GgLimitKind::ConsecutiveErrors, "root")));
    let summary = stopped.finalize("limit_exceeded");
    assert_eq!(summary.terminal_status, "limit_exceeded");
    assert_eq!(
        summary.limit_hit,
        Some(breach(GgLimitKind::ConsecutiveErrors, "root"))
    );
    let json = serde_json::to_value(&summary).expect("summary serializes");
    assert_eq!(
        json.pointer("/limitHit/limit"),
        Some(&serde_json::json!("consecutive_errors"))
    );
}

/// Every agent's stream passes through the one tracker, so a subagent that stopped on its own error
/// ceiling emits a `LimitExceeded` the tracker observes — and the run must not report that child's
/// ceiling as its own outcome. The event is deliberately not folded; only the root loop's breach,
/// handed over explicitly, becomes `limit_hit`.
#[test]
fn a_subagents_breach_is_not_reported_as_the_runs_outcome() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&GgTelemetryKind::LimitExceeded {
        breach: breach(GgLimitKind::ConsecutiveErrors, "agent-1"),
    });
    // The run itself ended on its own terms.
    tracker.record_limit_hit(None);
    assert_eq!(
        tracker.finalize("completed").limit_hit,
        None,
        "a child's ceiling is the child's outcome, not the run's"
    );

    // And when the root *does* stop on a ceiling, its breach is the one recorded — not whichever
    // agent happened to emit an event first.
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&GgTelemetryKind::LimitExceeded {
        breach: breach(GgLimitKind::ErrorRate, "agent-1"),
    });
    tracker.record_limit_hit(Some(breach(GgLimitKind::Cost, "root")));
    let summary = tracker.finalize("limit_exceeded");
    assert_eq!(summary.limit_hit, Some(breach(GgLimitKind::Cost, "root")));
}

// ---------------------------------------------------------------------------
// The error rollup
// ---------------------------------------------------------------------------

/// Every recorded turn advances the denominator, every error advances its own kind, and the total
/// is exactly the sum of the kinds.
///
/// The stream here is the shape of a real code-mode run that struggled and recovered: a good turn,
/// a program that would not type-strip, a program that threw, a recovery, a sandbox ceiling, a turn
/// that finished the session — plus a fatal turn, which is counted in `turns` and charged to
/// nothing, because gg's own machinery failing is not the model's error.
#[test]
fn the_error_rollup_counts_every_turn_and_splits_the_errors_by_kind() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&progressed());
    tracker.observe(&errored(GgTurnErrorType::TranspileSyntax, 1));
    tracker.observe(&errored(GgTurnErrorType::ProgramToolError, 2));
    tracker.observe(&progressed());
    tracker.observe(&errored(GgTurnErrorType::SandboxTimeout, 1));
    tracker.observe(&turn(GgTurnOutcome::Fatal, None, 1, 0));
    tracker.observe(&turn(GgTurnOutcome::Finished, None, 0, 0));

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.errors,
        GgErrorSummary {
            turns: 7,
            errors: 3,
            max_consecutive: 2,
            model_api: 0,
            transpile: 1,
            program_fault: 1,
            sandbox_limit: 1,
            toolchain: 0,
            missing_completion: 0,
            loop_aborts: 0,
            by_type: BTreeMap::from([
                ("transpile_syntax".to_string(), 1),
                ("program_tool_error".to_string(), 1),
                ("sandbox_timeout".to_string(), 1),
            ]),
            tool_failures: BTreeMap::new(),
        }
    );
    assert_eq!(
        summary.errors.errors,
        summary.errors.model_api
            + summary.errors.transpile
            + summary.errors.program_fault
            + summary.errors.sandbox_limit
            + summary.errors.missing_completion,
        "the total is exactly the sum of its parts, which is why no percentage is stored"
    );
    assert!(
        summary.errors.errors < summary.errors.turns,
        "the fatal turn and the finished one are in the denominator and in no error bucket"
    );
}

/// The per-**type** breakdown rides alongside the per-kind counters and sums to the same total —
/// the invariant a *"top error types"* ranking is read against.
///
/// Per-kind counters alone would show five failures as `model_api: 2, program_fault: 3`, which says
/// nothing about a run whose model was rejected once, looped once, and spent three turns fighting a
/// call it could not make.
#[test]
fn the_error_rollup_breaks_the_same_errors_down_by_specific_type() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&errored(GgTurnErrorType::ModelRejected, 1));
    tracker.observe(&errored(GgTurnErrorType::ModelResponseLoop, 2));
    tracker.observe(&errored(GgTurnErrorType::ProgramToolError, 3));
    tracker.observe(&errored(GgTurnErrorType::ProgramToolError, 4));
    tracker.observe(&errored(GgTurnErrorType::ProgramUnknownName, 5));
    tracker.observe(&progressed());

    let errors = tracker.finalize("completed").errors;
    assert_eq!(
        errors.by_type,
        BTreeMap::from([
            ("model_rejected".to_string(), 1),
            ("model_response_loop".to_string(), 1),
            ("program_tool_error".to_string(), 2),
            ("program_unknown_name".to_string(), 1),
        ])
    );
    assert_eq!(
        errors.by_type.values().sum::<u64>(),
        errors.errors,
        "the breakdown sums to the total error count"
    );
    // ...and regrouping it by base gives the named counters back, so the two readings of one run
    // can never disagree.
    assert_eq!(errors.model_api, 2);
    assert_eq!(errors.program_fault, 3);
    assert_eq!(
        errors.transpile + errors.sandbox_limit + errors.missing_completion,
        0
    );
}

/// A **call** that failed is counted by class, and is deliberately kept out of the turn figures: a
/// program that caught a `not-found` and carried on did not fail its turn, and charging it would
/// make the one capability that expects failures the one that cannot survive them.
#[test]
fn failed_calls_are_counted_by_class_without_touching_the_turn_figures() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&tool_result(true, None));
    tracker.observe(&tool_result(false, Some(GgToolFailure::NotFound)));
    tracker.observe(&tool_result(false, Some(GgToolFailure::NotFound)));
    tracker.observe(&tool_result(false, Some(GgToolFailure::InvalidArgument)));
    // A failure raised outside a tool implementation, which has no class of its own.
    tracker.observe(&tool_result(false, Some(GgToolFailure::Other)));
    tracker.observe(&progressed());

    let errors = tracker.finalize("completed").errors;
    assert_eq!(
        errors.tool_failures,
        BTreeMap::from([
            ("not-found".to_string(), 2),
            ("invalid-argument".to_string(), 1),
            ("other".to_string(), 1),
        ])
    );
    assert_eq!(errors.turns, 1, "only the turn event is a turn");
    assert_eq!(errors.errors, 0, "no turn failed");
    assert!(errors.by_type.is_empty());
}

/// The longest streak is a **maximum over the per-turn counts**, not a streak the tracker keeps.
///
/// This is what makes the figure correct on a parallel run: two agents' turns interleave
/// arbitrarily on one stream, so the run-wide sequence here (`1, 1, 2, 1, 3`) never happened to
/// anybody — the peak any single agent actually reached is `3`, and it is carried on the event
/// rather than re-derived.
#[test]
fn the_longest_streak_is_the_peak_any_one_agent_reported() {
    let tracker = SessionSummaryTracker::new();
    // Read as two agents' turns arriving interleaved: one never gets past its second failure, the
    // other reaches three in a row.
    for consecutive in [1_u64, 1, 2, 1, 3] {
        tracker.observe(&errored(GgTurnErrorType::ModelRetryExhausted, consecutive));
    }
    // ...and a later recovery must not lower the peak already observed.
    tracker.observe(&progressed());

    let summary = tracker.finalize("completed");
    assert_eq!(summary.errors.max_consecutive, 3);
    assert_eq!(summary.errors.turns, 6);
    assert_eq!(summary.errors.errors, 5);
    assert_eq!(summary.errors.model_api, 5);
}

/// A discarded looping reply is **not** an error turn — the attempt was thrown away and retried, and
/// the turn is judged on what the retry produced — but it is counted, because it is money spent on
/// nothing. Both facts are asserted on the same stream, so neither can be quietly folded into the
/// other.
#[test]
fn discarded_looping_replies_are_counted_without_being_charged_as_errors() {
    let tracker = SessionSummaryTracker::new();
    // Two attempts looped, the third produced a reply, and the turn it produced was perfectly fine.
    tracker.observe(&turn(GgTurnOutcome::Progressed, None, 0, 2));
    // A later turn looped once more and then failed for an unrelated reason.
    tracker.observe(&turn(
        GgTurnOutcome::Error,
        Some(GgTurnErrorType::TranspileSyntax),
        1,
        1,
    ));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.errors.loop_aborts, 3, "a plain sum over the turns");
    assert_eq!(
        summary.errors.turns, 2,
        "a discarded attempt is not a turn of its own"
    );
    assert_eq!(
        summary.errors.errors, 1,
        "only the transpile failure was an error turn"
    );
}

/// A run that left loop detection disarmed — the default — reports a zero, and the field is omitted
/// from the wire entirely, so no console has to distinguish "never looped" from "never watched".
#[test]
fn a_run_that_never_armed_loop_detection_reports_no_aborts() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&progressed());
    tracker.observe(&errored(GgTurnErrorType::MissingCompletionNoCall, 1));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.errors.loop_aborts, 0);
    assert_eq!(summary.errors.missing_completion, 1);

    let json = serde_json::to_value(&summary).expect("summary serializes");
    assert_eq!(
        json.pointer("/errors/loopAborts"),
        Some(&serde_json::json!(0)),
        "the rollup itself always carries every counter, zero or not"
    );
}

/// A tool-calling run has an error rollup too. It is the one figure in this summary that is
/// deliberately **mode-agnostic**: healing and `codeExecutions` are zero for such a run by
/// construction, but "how often did this configuration fail a turn?" is exactly as meaningful when
/// the turns were tool calls.
#[test]
fn a_tool_calling_run_still_reports_its_error_rate() {
    let tracker = SessionSummaryTracker::new();
    tracker.record_execution_mode("tool_calling");
    tracker.observe(&progressed());
    tracker.observe(&errored(GgTurnErrorType::MissingCompletionNoCall, 1));
    tracker.observe(&errored(GgTurnErrorType::MissingCompletionNoCall, 2));
    tracker.observe(&turn(GgTurnOutcome::Finished, None, 0, 0));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.code_executions, 0, "nothing code-shaped ran");
    assert_eq!(summary.healing, GgHealingSummary::default());
    assert_eq!(summary.errors.turns, 4);
    assert_eq!(summary.errors.errors, 2);
    assert_eq!(summary.errors.missing_completion, 2);
}

/// The rollup is folded from exactly one event kind. A busy stream of everything else — the events
/// that carry their own figures and the ones that carry none — leaves it untouched, so a future
/// event cannot start contributing to the error rate by accident.
#[test]
fn only_the_turn_outcome_event_feeds_the_error_rollup() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(&breakdown(0.5));
    tracker.observe(&code_turn(healed(&[GgHealingStrategy::StripFences])));
    tracker.observe(&GgTelemetryKind::AssistantMessage {
        text: "working on it".to_string(),
    });
    tracker.observe(&GgTelemetryKind::LimitExceeded {
        breach: breach(GgLimitKind::ConsecutiveErrors, "agent-1"),
    });

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.errors,
        GgErrorSummary::default(),
        "no turn was recorded, so the run made no model calls this rollup knows of"
    );
    assert_eq!(summary.code_executions, 1, "the other rollups still folded");
}
