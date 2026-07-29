//! Unit tests for the [`SessionSummaryTracker`]: fed a synthetic telemetry stream, its
//! finalized [`GgSessionSummary`] counts each aggregatable figure exactly as the stream
//! carried it. The end-to-end "summary matches a scripted run's stream" coverage lives in
//! `agent.test.rs`, driving the real emitter.

use super::*;
use test_cabinet_core::gg::{GgBoardIssue, GgContextSourceUsage, GgLimitKind};
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

/// A `CodeExecution` event carrying `healing` — one code-shaped turn. `ok` is derived from the
/// record so the synthetic event is self-consistent (a reply that was not a program never ran, so
/// it cannot have returned normally); the summary reads only the healing record and the event's
/// existence, so every other field is the shape a turn of that kind would really carry.
fn code_turn(healing: GgResponseHealing) -> GgTelemetryKind {
    GgTelemetryKind::CodeExecution {
        ok: healing.not_a_program.is_none(),
        tool_calls: 0,
        // Absent exactly when there was no program to run at all — the rule the contract states.
        duration_ms: healing.not_a_program.is_none().then_some(0),
        error: None,
        finished: None,
        compile_wait_ms: None,
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
    assert_eq!(summary.speculations, 0);
    assert_eq!(summary.issues_created, 0);
    assert_eq!(summary.issues_completed, 0);
    assert!(summary.slot_costs.is_empty());
    // The effective toolset is empty until the binary records it off the assembled registry.
    assert!(summary.effective_tools.is_empty());
    // Nothing was healed because nothing was ever sent to heal.
    assert_eq!(summary.code_executions, 0);
    assert_eq!(summary.healing, GgHealingSummary::default());
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
        cwd: None,
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
            cwd: None,
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
        strategy: "model".to_string(),
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
    tracker.observe(&GgTelemetryKind::SessionStarted {
        capability_set: None,
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
/// clean turns, repaired turns, a turn repaired twice by one strategy, two turns that were not
/// programs, and one the pipeline could not converge on — totals every counter exactly, and the
/// denominator counts *turns* rather than only the ones that ran.
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
    // Several fenced candidate blocks: gg refused to guess, so nothing ran and nothing was healed.
    tracker.observe(&code_turn(GgResponseHealing {
        not_a_program: Some(GgNotAProgram::SeveralBlocks),
        blocks: Some(7),
        candidate_shape: Some(GgCandidateShape::Fenced),
        ..GgResponseHealing::default()
    }));
    // The same refusal in its other shape — two programs pasted together with no fence — which the
    // rollup must count apart from the fenced one, because they are two different mistakes.
    tracker.observe(&code_turn(GgResponseHealing {
        strategies: vec![GgHealingStrategy::DropDuplicateProgram],
        not_a_program: Some(GgNotAProgram::SeveralBlocks),
        blocks: Some(2),
        candidate_shape: Some(GgCandidateShape::Bare),
        ..GgResponseHealing::default()
    }));
    // Comments only: a classification, which is an application without being a heal.
    tracker.observe(&code_turn(GgResponseHealing {
        strategies: vec![GgHealingStrategy::StripCommentOnly],
        not_a_program: Some(GgNotAProgram::CommentOnly),
        ..GgResponseHealing::default()
    }));
    // An awaited wrapper around imported tools: two strategies, one heal.
    tracker.observe(&code_turn(healed(&[
        GgHealingStrategy::UnwrapAsync,
        GgHealingStrategy::DropImports,
    ])));
    // The pipeline could not reach a fixpoint, so every repair was discarded and the response ran
    // exactly as sent — an unusual response that was nonetheless healed of nothing.
    tracker.observe(&code_turn(GgResponseHealing {
        did_not_converge: true,
        ..GgResponseHealing::default()
    }));

    let summary = tracker.finalize("completed");
    assert_eq!(
        summary.code_executions, 8,
        "every code-shaped turn counts, including the three that were not programs"
    );
    assert_eq!(
        summary.healing,
        GgHealingSummary {
            healed: 3,
            applications: 8,
            strip_fences: 3,
            strip_prose: 1,
            drop_duplicate_program: 1,
            drop_imports: 1,
            unwrap_async: 1,
            strip_comment_only: 1,
            not_a_program: 3,
            several_blocks: 2,
            several_blocks_fenced: 1,
            several_blocks_bare: 1,
            // Nothing recorded an armed set on this tracker: `record_healing` is a launch-time
            // fact, and these events were folded on their own.
            enabled: Vec::new(),
        }
    );
    assert!(
        summary.healing.applications >= summary.healing.healed,
        "a heal is at least one application, and a classification is an application on its own"
    );
    assert!(
        summary.healing.several_blocks <= summary.healing.not_a_program,
        "the several-blocks count is a subset of the not-a-program count"
    );
    assert_eq!(
        summary.healing.several_blocks,
        summary.healing.several_blocks_fenced + summary.healing.several_blocks_bare,
        "every several-programs reply is counted under exactly one of its two shapes"
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
        cwd: None,
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
