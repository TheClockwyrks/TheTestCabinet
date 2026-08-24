//! Unit tests for the [`SessionSummaryTracker`]: fed a synthetic telemetry stream, its
//! finalized [`GgSessionSummary`] counts each aggregatable figure exactly as the stream
//! carried it. The end-to-end "summary matches a scripted run's stream" coverage lives in
//! `agent.test.rs`, driving the real emitter.

use std::collections::BTreeMap;

use super::*;
// `GgTurnOutcome` is the one contract type these tests construct that the module under test never
// names: the fold keys on the error *kind*, which is what keeps `errors` the sum of its parts.
use test_cabinet_core::gg::{
    GgBoardIssue, GgCallFailure, GgCapabilitySet, GgContextSourceUsage, GgLimitKind,
    GgTurnErrorType, GgTurnOutcome, ROOT_PROFILE_ID,
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
        agent_id: String::new(),
        reviewer_ids: Vec::new(),
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

/// A `CodeExecution` event — one program of a language that compiles nothing, which is what
/// TypeScript's type-strip is. The summary reads the compile figure and the event's existence, so
/// every other field is the shape a program that ran would really carry.
fn code_turn() -> GgTelemetryKind {
    code_turn_compiling(None)
}

/// The same program, from a language whose prepare step invoked a compiler and reported what it cost.
fn code_turn_compiling(compile_ms: Option<u64>) -> GgTelemetryKind {
    GgTelemetryKind::CodeExecution {
        ok: true,
        tool_calls: 0,
        api_calls: 0,
        undocumented_calls: GgUndocumentedCalls::default(),
        duration_ms: Some(0),
        error: None,
        finished: None,
        logs: Vec::new(),
        logs_suppressed: 0,
        compile_wait_ms: None,
        compile_ms,
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
        response_chars: 0,
        response_output_tokens: 0,
        // Derived from the type rather than passed in, exactly as gg emits it: the two halves of a
        // recorded error come from one value, so a fixture that could set them independently could
        // assert a shape gg cannot produce.
        error: error_type.map(GgTurnErrorType::kind),
        error_type,
        consecutive_errors,
        turns: 999,
        loop_aborts,
        // Two figures for one fact: gg publishes a size with every discarded attempt, so a fixture
        // that named a count with no size would be a shape gg cannot emit. Scaled off the count so
        // a rollup that summed the wrong field is caught by the figure it lands on.
        loop_abort_words: loop_aborts * 3_000,
        loop_abort_chars: loop_aborts * 19_000,
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
fn tool_result(ok: bool, failure: Option<GgCallFailure>) -> GgTelemetryKind {
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
    assert_eq!(summary.code_executions, 0);
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
/// configuration variable a query reads.
#[test]
fn records_the_effective_toolset_verbatim() {
    let tracker = SessionSummaryTracker::new();
    // A stray telemetry event flows through the same tracker; it must not disturb the recorded
    // toolset.
    tracker.observe(
        None,
        &GgTelemetryKind::AgentSpawned {
            profile_id: ROOT_PROFILE_ID.to_string(),
            model_id: "mock/echo".to_string(),
            depth: 0,
            brief: None,
            worktree: None,
            cwd: String::new(),
        },
    );
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
        tracker.observe(
            None,
            &GgTelemetryKind::AgentSpawned {
                profile_id: ROOT_PROFILE_ID.to_string(),
                model_id: "mock/echo".to_string(),
                depth,
                brief: None,
                worktree: None,
                cwd: String::new(),
            },
        );
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
    tracker.observe(None, &breakdown(0.4));
    tracker.observe(
        None,
        &GgTelemetryKind::Compaction {
            strategy: "self-summarization".to_string(),
            trigger_fullness: 0.8,
            before_tokens: 1000,
            after_tokens: 200,
            summary_tokens: 120,
            retained: test_cabinet_core::gg::GgRetainedState {
                skills: 0,
                tasks: 0,
                memories: 0,
            },
            before_by_source: Vec::new(),
            after_by_source: Vec::new(),
            summary: "a summary".to_string(),
            summary_fallback: false,
        },
    );
    tracker.observe(None, &breakdown(1.0));
    tracker.observe(None, &breakdown(1.2));
    tracker.observe(None, &breakdown(0.9));

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
    tracker.observe(
        None,
        &GgTelemetryKind::ContextBreakdown {
            by_source: Vec::new(),
            total_tokens: 100,
            window_limit: None,
            fullness: None,
        },
    );
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
    tracker.observe(None, &phase(GgIssueReviewPhase::Requested));
    tracker.observe(None, &phase(GgIssueReviewPhase::ChangesRequested));
    tracker.observe(None, &phase(GgIssueReviewPhase::Approved));
    // A second review approved on the first pass: requested → approved.
    tracker.observe(None, &phase(GgIssueReviewPhase::Requested));
    tracker.observe(None, &phase(GgIssueReviewPhase::Approved));

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
    tracker.observe(
        None,
        &GgTelemetryKind::BoardState {
            module_id: "board-0".to_string(),
            epics: Vec::new(),
            issues: vec![
                issue("a", GgIssueStatus::Open),
                issue("b", GgIssueStatus::InProgress),
            ],
        },
    );
    // Later: `a` done, `b` still in progress, a new `c` open.
    tracker.observe(
        None,
        &GgTelemetryKind::BoardState {
            module_id: "board-0".to_string(),
            epics: Vec::new(),
            issues: vec![
                issue("a", GgIssueStatus::Done),
                issue("b", GgIssueStatus::InProgress),
                issue("c", GgIssueStatus::Open),
            ],
        },
    );
    // Later still: `a` reopened, `b` done.
    tracker.observe(
        None,
        &GgTelemetryKind::BoardState {
            module_id: "board-0".to_string(),
            epics: Vec::new(),
            issues: vec![
                issue("a", GgIssueStatus::InProgress),
                issue("b", GgIssueStatus::Done),
                issue("c", GgIssueStatus::Open),
            ],
        },
    );

    let summary = tracker.finalize("completed");
    assert_eq!(summary.issues_created, 3, "a, b, c each counted once");
    assert_eq!(
        summary.issues_completed, 2,
        "a and b each reached Done at some point"
    );
}

/// Each `SlotUsage` rollup is captured verbatim, in emission order, as one cost entry per
/// `(profile id, model)` the run touched.
#[test]
fn captures_per_slot_cost_rollups() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(
        None,
        &GgTelemetryKind::SlotUsage {
            profile_id: ROOT_PROFILE_ID.to_string(),
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
        },
    );
    tracker.observe(
        None,
        &GgTelemetryKind::SlotUsage {
            profile_id: "reviewer".to_string(),
            model_id: "mock/reviewer".to_string(),
            tokens: TokenCounts {
                uncached_input: Some(300),
                cached_input: None,
                output: Some(40),
                reasoning: None,
            },
            cost: None,
        },
    );

    let summary = tracker.finalize("model_error");
    assert_eq!(summary.terminal_status, "model_error");
    assert_eq!(summary.slot_costs.len(), 2);
    assert_eq!(summary.slot_costs[0].profile_id, ROOT_PROFILE_ID);
    assert_eq!(summary.slot_costs[0].model_id, "mock/primary");
    assert_eq!(summary.slot_costs[0].tokens.output, Some(200));
    assert_eq!(
        summary.slot_costs[0].cost.and_then(|c| c.actual),
        Some(0.05)
    );
    assert_eq!(summary.slot_costs[1].profile_id, "reviewer");
    assert_eq!(summary.slot_costs[1].cost, None);
}

/// The terminal `SessionSummary`/`SessionEnded` events (which flow through the same emitter,
/// so the tracker observes them too) contribute nothing — the summary excludes itself.
#[test]
fn observing_the_terminal_events_is_a_no_op() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(
        None,
        &GgTelemetryKind::SessionStarted {
            capability_set: Box::new(GgCapabilitySet::minimal("mock/echo")),
        },
    );
    tracker.observe(
        None,
        &GgTelemetryKind::SessionSummary {
            summary: Box::new(SessionSummaryTracker::new().finalize("completed")),
        },
    );
    tracker.observe(
        None,
        &GgTelemetryKind::SessionEnded {
            status: "completed".to_string(),
        },
    );
    let summary = tracker.finalize("completed");
    assert_eq!(summary.agents_spawned, 0);
    assert!(summary.slot_costs.is_empty());
}

/// A tool-calling run executes no programs, so its `codeExecutions` denominator and its compile
/// figure are both zero even over a busy stream.
#[test]
fn a_tool_calling_run_reports_no_code_executions() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(
        None,
        &GgTelemetryKind::AgentSpawned {
            profile_id: ROOT_PROFILE_ID.to_string(),
            model_id: "mock/echo".to_string(),
            depth: 0,
            brief: None,
            worktree: None,
            cwd: String::new(),
        },
    );
    tracker.observe(
        None,
        &GgTelemetryKind::AssistantMessage {
            text: "calling a tool".to_string(),
        },
    );
    tracker.observe(
        None,
        &GgTelemetryKind::ToolCall {
            name: "write_file".to_string(),
            args: serde_json::json!({ "path": "index.html" }),
        },
    );
    tracker.record_execution_mode("tool_calling");

    let summary = tracker.finalize("completed");
    assert_eq!(summary.execution_mode, "tool_calling");
    assert_eq!(summary.code_executions, 0);
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

    tracker.observe(None, &code_turn_compiling(Some(1_400)));
    tracker.observe(None, &code_turn_compiling(Some(1_100)));
    // The program the compiler rejected: it cost real seconds and is exactly the one whose cost
    // would otherwise vanish, because nothing else about it is non-zero.
    tracker.observe(None, &code_turn_compiling(Some(3_900)));
    // A program that reported no figure at all — the shape every TypeScript program has.
    tracker.observe(None, &code_turn());

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
    tracker.observe(None, &code_turn());
    tracker.observe(None, &code_turn());

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
    tracker.observe(
        None,
        &GgTelemetryKind::LimitExceeded {
            breach: breach(GgLimitKind::ConsecutiveErrors, "agent-1"),
        },
    );
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
    tracker.observe(
        None,
        &GgTelemetryKind::LimitExceeded {
            breach: breach(GgLimitKind::ErrorRate, "agent-1"),
        },
    );
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
    tracker.observe(None, &progressed());
    tracker.observe(None, &errored(GgTurnErrorType::TranspileSyntax, 1));
    tracker.observe(None, &errored(GgTurnErrorType::ProgramApiError, 2));
    tracker.observe(None, &progressed());
    tracker.observe(None, &errored(GgTurnErrorType::SandboxTimeout, 1));
    tracker.observe(None, &turn(GgTurnOutcome::Fatal, None, 1, 0));
    tracker.observe(None, &turn(GgTurnOutcome::Finished, None, 0, 0));

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
            missing_completion: 0,
            loop_aborts: 0,
            loop_abort_words: 0,
            loop_abort_chars: 0,
            by_type: BTreeMap::from([
                ("transpile_syntax".to_string(), 1),
                ("program_api_error".to_string(), 1),
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
    tracker.observe(None, &errored(GgTurnErrorType::ModelRejected, 1));
    tracker.observe(None, &errored(GgTurnErrorType::ModelResponseLoop, 2));
    tracker.observe(None, &errored(GgTurnErrorType::ProgramApiError, 3));
    tracker.observe(None, &errored(GgTurnErrorType::ProgramApiError, 4));
    tracker.observe(None, &errored(GgTurnErrorType::ProgramUnknownName, 5));
    tracker.observe(None, &progressed());

    let errors = tracker.finalize("completed").errors;
    assert_eq!(
        errors.by_type,
        BTreeMap::from([
            ("model_rejected".to_string(), 1),
            ("model_response_loop".to_string(), 1),
            ("program_api_error".to_string(), 2),
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
    tracker.observe(None, &tool_result(true, None));
    tracker.observe(None, &tool_result(false, Some(GgCallFailure::NotFound)));
    tracker.observe(None, &tool_result(false, Some(GgCallFailure::NotFound)));
    tracker.observe(
        None,
        &tool_result(false, Some(GgCallFailure::InvalidArgument)),
    );
    // A failure raised outside a tool implementation, which has no class of its own.
    tracker.observe(None, &tool_result(false, Some(GgCallFailure::Other)));
    tracker.observe(None, &progressed());

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
        tracker.observe(
            None,
            &errored(GgTurnErrorType::ModelRetryExhausted, consecutive),
        );
    }
    // ...and a later recovery must not lower the peak already observed.
    tracker.observe(None, &progressed());

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
    tracker.observe(None, &turn(GgTurnOutcome::Progressed, None, 0, 2));
    // A later turn looped once more and then failed for an unrelated reason.
    tracker.observe(
        None,
        &turn(
            GgTurnOutcome::Error,
            Some(GgTurnErrorType::TranspileSyntax),
            1,
            1,
        ),
    );

    let summary = tracker.finalize("completed");
    assert_eq!(summary.errors.loop_aborts, 3, "a plain sum over the turns");
    assert_eq!(
        (
            summary.errors.loop_abort_words,
            summary.errors.loop_abort_chars
        ),
        (9_000, 57_000),
        "and so is the size of what those attempts generated, which is the half that says how much"
    );
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
    tracker.observe(None, &progressed());
    tracker.observe(None, &errored(GgTurnErrorType::MissingCompletionNoCall, 1));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.errors.loop_aborts, 0);
    assert_eq!(summary.errors.loop_abort_words, 0);
    assert_eq!(summary.errors.loop_abort_chars, 0);
    assert_eq!(summary.errors.missing_completion, 1);

    let json = serde_json::to_value(&summary).expect("summary serializes");
    assert_eq!(
        json.pointer("/errors/loopAborts"),
        Some(&serde_json::json!(0)),
        "the rollup itself always carries every counter, zero or not"
    );
}

/// A tool-calling run has an error rollup too. It is the one figure in this summary that is
/// deliberately **mode-agnostic**: `codeExecutions` is zero for such a run by
/// construction, but "how often did this configuration fail a turn?" is exactly as meaningful when
/// the turns were tool calls.
#[test]
fn a_tool_calling_run_still_reports_its_error_rate() {
    let tracker = SessionSummaryTracker::new();
    tracker.record_execution_mode("tool_calling");
    tracker.observe(None, &progressed());
    tracker.observe(None, &errored(GgTurnErrorType::MissingCompletionNoCall, 1));
    tracker.observe(None, &errored(GgTurnErrorType::MissingCompletionNoCall, 2));
    tracker.observe(None, &turn(GgTurnOutcome::Finished, None, 0, 0));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.code_executions, 0, "nothing code-shaped ran");
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
    tracker.observe(None, &breakdown(0.5));
    tracker.observe(None, &code_turn());
    tracker.observe(
        None,
        &GgTelemetryKind::AssistantMessage {
            text: "working on it".to_string(),
        },
    );
    tracker.observe(
        None,
        &GgTelemetryKind::LimitExceeded {
            breach: breach(GgLimitKind::ConsecutiveErrors, "agent-1"),
        },
    );

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.errors,
        GgErrorSummary::default(),
        "no turn was recorded, so the run made no model calls this rollup knows of"
    );
    assert_eq!(summary.code_executions, 1, "the other rollups still folded");
}

/// The rejected-reply rollup and the response maxima, folded together because they are two halves
/// of one ruling: a length-capped reply's spend reaches the summary **only** through the rejected
/// bucket, and the maxima — the data an output ceiling would later be chosen from — fold only
/// over the turns that worked, so the degenerate reply that motivated the ceiling can never be
/// the figure that sets it.
#[test]
fn rejected_replies_and_response_maxima_fold_into_the_summary() {
    let tracker = SessionSummaryTracker::new();
    let rejected = |output: u64, cost: f64| GgTelemetryKind::ResponseRejected {
        reason: "length".to_string(),
        chars: output * 4,
        tokens: TokenCounts {
            uncached_input: Some(1_000),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        },
        cost: Some(Cost {
            comparable: Some(cost),
            actual: Some(cost),
        }),
        provider: Some("cap-provider".to_string()),
    };
    let sized_turn = |outcome: GgTurnOutcome,
                      error_type: Option<GgTurnErrorType>,
                      chars: u64,
                      output_tokens: u64| {
        match turn(outcome, error_type, u64::from(error_type.is_some()), 0) {
            GgTelemetryKind::TurnOutcome {
                outcome,
                error,
                error_type,
                consecutive_errors,
                turns,
                loop_aborts,
                loop_abort_words,
                loop_abort_chars,
                ..
            } => GgTelemetryKind::TurnOutcome {
                outcome,
                error,
                error_type,
                consecutive_errors,
                turns,
                loop_aborts,
                loop_abort_words,
                loop_abort_chars,
                response_chars: chars,
                response_output_tokens: output_tokens,
            },
            other => panic!("not a turn outcome: {other:?}"),
        }
    };

    tracker.observe(None, &rejected(65_000, 1.25));
    // The rejected call's error turn: its (large) reply size must not reach the maxima.
    tracker.observe(
        None,
        &sized_turn(
            GgTurnOutcome::Error,
            Some(GgTurnErrorType::ModelLengthCapped),
            260_000,
            65_000,
        ),
    );
    tracker.observe(None, &rejected(65_000, 1.30));
    tracker.observe(
        None,
        &sized_turn(
            GgTurnOutcome::Error,
            Some(GgTurnErrorType::ModelLengthCapped),
            260_000,
            65_000,
        ),
    );
    // The turns that worked: a progressed one and the finishing one set the maxima.
    tracker.observe(
        None,
        &sized_turn(GgTurnOutcome::Progressed, None, 4_200, 900),
    );
    tracker.observe(
        None,
        &sized_turn(GgTurnOutcome::Finished, None, 6_400, 1_500),
    );

    let summary = tracker.finalize("completed");
    assert_eq!(summary.rejected_responses.count, 2);
    assert_eq!(summary.rejected_responses.tokens.output, Some(130_000));
    assert_eq!(
        summary.rejected_responses.tokens.uncached_input,
        Some(2_000)
    );
    assert_eq!(
        summary.rejected_responses.cost.and_then(|cost| cost.actual),
        Some(1.25 + 1.30)
    );
    assert_eq!(summary.errors.by_type.get("model_length_capped"), Some(&2));
    assert_eq!(
        summary.max_response_chars, 6_400,
        "the maxima fold only over the turns that worked"
    );
    assert_eq!(summary.max_response_output_tokens, 1_500);
}

/// A usage delta as an agent's model call reports it: the model it ran on, the provider that
/// served it, and a small spend. The profile id is irrelevant to the provider rollup, which keys
/// on `(provider, model)`.
fn usage(model: &str, provider: Option<&str>) -> GgTelemetryKind {
    GgTelemetryKind::Usage {
        profile_id: ROOT_PROFILE_ID.to_string(),
        model_id: model.to_string(),
        tokens: TokenCounts {
            uncached_input: Some(100),
            cached_input: None,
            output: Some(40),
            reasoning: None,
        },
        cost: Some(Cost {
            comparable: Some(0.01),
            actual: Some(0.01),
        }),
        provider: provider.map(str::to_string),
    }
}

/// The slice for `(provider, model)`, or a panic naming what the summary actually holds — the
/// assertion failure a misattributed fold should produce.
fn slice<'a>(
    summary: &'a GgSessionSummary,
    provider: Option<&str>,
    model: Option<&str>,
) -> &'a GgProviderStat {
    summary
        .provider_stats
        .iter()
        .find(|slice| slice.provider.as_deref() == provider && slice.model_id.as_deref() == model)
        .unwrap_or_else(|| {
            panic!(
                "no ({provider:?}, {model:?}) slice in {:?}",
                summary.provider_stats
            )
        })
}

/// Attribution is per agent: two agents' events interleave arbitrarily on the run-wide stream,
/// and each turn still lands on the provider **its own** call named, on the model its own usage
/// deltas reported.
#[test]
fn provider_attribution_follows_each_agents_own_stream() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(Some("root"), &usage("mock/alpha", Some("Alpha")));
    tracker.observe(Some("helper"), &usage("mock/beta", Some("Beta")));
    // The interleave: root's turn resolves against root's marker, not helper's.
    tracker.observe(Some("root"), &progressed());
    tracker.observe(
        Some("helper"),
        &errored(GgTurnErrorType::TranspileCompile, 1),
    );
    tracker.observe(Some("root"), &usage("mock/alpha", Some("Alpha")));
    tracker.observe(Some("root"), &turn(GgTurnOutcome::Finished, None, 0, 0));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.provider_stats.len(), 2);

    let alpha = slice(&summary, Some("Alpha"), Some("mock/alpha"));
    assert_eq!((alpha.calls, alpha.turns, alpha.working), (2, 2, 2));
    assert_eq!(alpha.tokens.uncached_input, Some(200));
    assert_eq!(alpha.cost.and_then(|cost| cost.actual), Some(0.02));
    assert!(alpha.errors.is_empty());

    let beta = slice(&summary, Some("Beta"), Some("mock/beta"));
    assert_eq!((beta.calls, beta.turns, beta.working), (1, 1, 0));
    assert_eq!(beta.errors.get("transpile_compile"), Some(&1));
}

/// A turn whose call produced no reply — a model timeout — has no provider to name, so it lands
/// on the providerless slice for the agent's known model rather than inheriting the provider of
/// an earlier, unrelated call.
#[test]
fn a_turn_whose_call_produced_no_reply_lands_on_the_providerless_slice() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(Some("root"), &usage("mock/alpha", Some("Alpha")));
    tracker.observe(Some("root"), &progressed());
    // The timed-out call: no usage, no prompt, no marker — only the outcome.
    tracker.observe(Some("root"), &errored(GgTurnErrorType::ModelTimeout, 1));

    let summary = tracker.finalize("timed_out");
    let named = slice(&summary, Some("Alpha"), Some("mock/alpha"));
    assert_eq!((named.calls, named.turns, named.working), (1, 1, 1));
    let providerless = slice(&summary, None, Some("mock/alpha"));
    assert_eq!((providerless.calls, providerless.turns), (0, 1));
    assert_eq!(providerless.errors.get("model_timeout"), Some(&1));
}

/// A turn recorded before the agent's first usage delta has no model to attribute to, and says
/// so: the slice carries the provider its call named and no model at all.
#[test]
fn a_turn_before_any_usage_delta_carries_no_model() {
    let tracker = SessionSummaryTracker::new();
    // The call reported no usage (its delta was skipped), but its prompt still named who served
    // it — the marker that keeps the turn attributable.
    tracker.observe(
        Some("root"),
        &GgTelemetryKind::Prompt {
            request: Vec::new(),
            total_tokens: 1_200,
            response_id: None,
            finish_reason: "stop".to_string(),
            tokens: TokenCounts::default(),
            cost: None,
            duration_ms: Some(900),
            provider: Some("Alpha".to_string()),
        },
    );
    tracker.observe(Some("root"), &progressed());

    let summary = tracker.finalize("completed");
    let unmodeled = slice(&summary, Some("Alpha"), None);
    assert_eq!(
        (unmodeled.calls, unmodeled.turns, unmodeled.working),
        (0, 1, 1)
    );
}

/// A rejected reply is attributed to the provider that served it — on the agent's known model —
/// and marks the turn, so the error turn the rejection becomes lands on the same provider.
#[test]
fn a_rejected_reply_is_attributed_to_the_provider_that_served_it() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(Some("root"), &usage("mock/alpha", Some("Alpha")));
    tracker.observe(Some("root"), &progressed());
    tracker.observe(
        Some("root"),
        &GgTelemetryKind::ResponseRejected {
            reason: "length".to_string(),
            chars: 260_000,
            tokens: TokenCounts::default(),
            cost: None,
            provider: Some("Capper".to_string()),
        },
    );
    tracker.observe(
        Some("root"),
        &errored(GgTurnErrorType::ModelLengthCapped, 1),
    );

    let summary = tracker.finalize("completed");
    let capper = slice(&summary, Some("Capper"), Some("mock/alpha"));
    assert_eq!(capper.rejected, 1);
    assert_eq!(capper.turns, 1);
    assert_eq!(capper.errors.get("model_length_capped"), Some(&1));
}

/// The slices are a strict re-slicing of the run-wide rollup: their `turns` sum to
/// `errors.turns` whatever mix of agents, providers and outcomes the stream carried — the
/// invariant the contract promises.
#[test]
fn provider_slices_turns_sum_to_the_error_rollups_denominator() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(Some("root"), &usage("mock/alpha", Some("Alpha")));
    tracker.observe(Some("root"), &progressed());
    tracker.observe(Some("helper"), &progressed());
    tracker.observe(Some("root"), &errored(GgTurnErrorType::ModelTimeout, 1));
    tracker.observe(Some("root"), &usage("mock/alpha", None));
    tracker.observe(Some("root"), &turn(GgTurnOutcome::Fatal, None, 0, 0));

    let summary = tracker.finalize("internal_error");
    let attributed: u64 = summary.provider_stats.iter().map(|slice| slice.turns).sum();
    assert_eq!(attributed, summary.errors.turns);
    // And the fatal turn is visible as the slice arithmetic the contract documents.
    let providerless = slice(&summary, None, Some("mock/alpha"));
    let errored_turns: u64 = providerless.errors.values().sum();
    assert_eq!(
        providerless.turns - providerless.working - errored_turns,
        1,
        "the fatal turn is attributed and charged to nothing"
    );
}

/// Every dispatched call advances the total, failed or not, so the successful half is derivable
/// from the record: `toolCalls` minus the classified failures.
#[test]
fn tool_calls_counts_every_dispatched_result() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(None, &tool_result(true, None));
    tracker.observe(None, &tool_result(true, None));
    tracker.observe(None, &tool_result(false, Some(GgCallFailure::NotFound)));
    tracker.observe(
        None,
        &tool_result(false, Some(GgCallFailure::InvalidArgument)),
    );
    tracker.observe(None, &tool_result(true, None));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.tool_calls, 5);
    let failures: u64 = summary.errors.tool_failures.values().sum();
    assert_eq!(summary.tool_calls - failures, 3);
}

/// A run that never named a provider, dispatched a tool or recorded a turn omits the new figures
/// from the wire entirely — the shape every record written before they existed already has, so
/// absence stays one statement rather than two.
#[test]
fn a_summary_with_no_provider_or_tool_activity_omits_the_new_fields() {
    let tracker = SessionSummaryTracker::new();
    tracker.observe(None, &breakdown(0.4));
    let summary = tracker.finalize("completed");
    let json = serde_json::to_value(&summary).expect("summary serializes");
    assert!(json.get("providerStats").is_none());
    assert!(json.get("toolCalls").is_none());
}
