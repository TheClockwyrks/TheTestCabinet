//! Unit tests for the [`SessionSummaryTracker`]: fed a synthetic telemetry stream, its
//! finalized [`GgSessionSummary`] counts each aggregatable figure exactly as the stream
//! carried it. The end-to-end "summary matches a scripted run's stream" coverage lives in
//! `agent.test.rs`, driving the real emitter.

use super::*;
use test_cabinet_core::gg::{GgBoardIssue, GgContextSourceUsage};
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
    assert_eq!(summary.code_reviews, 0);
    assert_eq!(summary.review_cycles, 0);
    assert_eq!(summary.issues_reopened, 0);
    assert_eq!(summary.speculations, 0);
    assert_eq!(summary.issues_created, 0);
    assert_eq!(summary.issues_completed, 0);
    assert!(summary.slot_costs.is_empty());
    // The effective toolset is empty until the binary records it off the assembled registry.
    assert!(summary.effective_tools.is_empty());
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

/// Code Review phases split into three figures: reviews triggered (`Requested`), verdicts
/// rendered (`ChangesRequested` + `Approved`), and issues reopened (`ChangesRequested`).
#[test]
fn counts_code_review_phases() {
    let tracker = SessionSummaryTracker::new();
    let phase = |p| GgTelemetryKind::CodeReview {
        phase: p,
        items: None,
        baseline: None,
    };
    // One review that took one fix round: requested → changes → approved.
    tracker.observe(&phase(GgCodeReviewPhase::Requested));
    tracker.observe(&phase(GgCodeReviewPhase::ChangesRequested));
    tracker.observe(&phase(GgCodeReviewPhase::Approved));
    // A second review approved on the first pass: requested → approved.
    tracker.observe(&phase(GgCodeReviewPhase::Requested));
    tracker.observe(&phase(GgCodeReviewPhase::Approved));

    let summary = tracker.finalize("completed");
    assert_eq!(summary.code_reviews, 2);
    // Two approvals + one changes-requested = three verdicts.
    assert_eq!(summary.review_cycles, 3);
    assert_eq!(summary.issues_reopened, 1);
}

/// Only a speculation's `FannedOut` phase counts a best-of-K round, so the later `Judged`/
/// `Merged` phases of the same round are not double-counted.
#[test]
fn counts_speculations_once_per_round() {
    let tracker = SessionSummaryTracker::new();
    let spec = |p| GgTelemetryKind::Speculation {
        attempts: 3,
        phase: p,
        winner: None,
        rationale: None,
    };
    tracker.observe(&spec(GgSpeculationPhase::FannedOut));
    tracker.observe(&spec(GgSpeculationPhase::Judged));
    tracker.observe(&spec(GgSpeculationPhase::Merged));
    tracker.observe(&spec(GgSpeculationPhase::FannedOut));

    assert_eq!(tracker.finalize("completed").speculations, 2);
}

/// A board re-emitted every mutation contributes each issue once (created) and each completed
/// issue once, so an issue reopened and re-completed still counts a single completion.
#[test]
fn counts_distinct_issues_created_and_completed_across_board_snapshots() {
    let tracker = SessionSummaryTracker::new();
    // First snapshot: two open issues.
    tracker.observe(&GgTelemetryKind::BoardState {
        epics: Vec::new(),
        issues: vec![
            issue("a", GgIssueStatus::Open),
            issue("b", GgIssueStatus::InProgress),
        ],
    });
    // Later: `a` done, `b` still in progress, a new `c` open.
    tracker.observe(&GgTelemetryKind::BoardState {
        epics: Vec::new(),
        issues: vec![
            issue("a", GgIssueStatus::Done),
            issue("b", GgIssueStatus::InProgress),
            issue("c", GgIssueStatus::Open),
        ],
    });
    // Later still: `a` reopened, `b` done.
    tracker.observe(&GgTelemetryKind::BoardState {
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
    tracker.observe(&GgTelemetryKind::SessionStarted {});
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
