use super::*;

use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet, GgSessionSummary,
};
use test_cabinet_core::gg_aggregate::{
    GgAggregation, GgFacet, GgMetric, GgMetricSpec, GgSummaryField,
};
use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::ValidationSummary;

use crate::db::Db;

/// A gg session summary at a baseline, so a test tweaks only the field it exercises.
fn summary() -> GgSessionSummary {
    GgSessionSummary {
        terminal_status: "completed".to_string(),
        agents_spawned: 1,
        subagent_count: 0,
        max_subagent_depth: 0,
        compactions: 0,
        ran_out_of_context: false,
        context_overflow_count: 0,
        final_fullness: None,
        issue_reviews: 0,
        review_cycles: 0,
        issues_reopened: 0,
        speculations: 0,
        execution_mode: "tool_calling".to_string(),
        code_executions: 0,
        healing: Default::default(),
        issues_created: 0,
        issues_completed: 0,
        slot_costs: Vec::new(),
        effective_tools: Vec::new(),
        limits: Default::default(),
        limit_hit: None,
    }
}

/// A gg run record: `compaction` explicitly on/off and a summary flag for whether it
/// ran out of context — the two axes the aggregate query slices and measures.
fn gg_record(
    id: &str,
    compaction_on: bool,
    ran_out: bool,
) -> test_cabinet_core::run_record::RunRecord {
    let mut set = GgCapabilitySet::minimal("mock/echo");
    set.agents[0].capabilities.push(if compaction_on {
        GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
    } else {
        GgCapabilityConfig::disabled(CAPABILITY_COMPACTION)
    });

    test_cabinet_core::run_record::RunRecord {
        id: id.to_string(),
        started_at: "2026-07-24T20:00:00Z".to_string(),
        finished_at: "2026-07-24T21:00:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_core::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Gg,
            harness_version: None,
            orchestrator_slug: "one-shot".to_string(),
            model_id: "mock/echo".to_string(),
            gg_capability_set: Some(set),
            gg_summary: Some(GgSessionSummary {
                ran_out_of_context: ran_out,
                context_overflow_count: u64::from(ran_out),
                ..summary()
            }),
        },
        tooling: RunTooling::default(),
        environment: RunEnvironment {
            os: "Debian".to_string(),
            container_image: "test-cabinet/gg:abcd".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: test_cabinet_core::AuthMode::ApiKey,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary {
            loaded: true,
            ..ValidationSummary::default()
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
    }
}

/// A non-gg run, to prove the aggregation loads only gg runs.
fn claude_record(id: &str) -> test_cabinet_core::run_record::RunRecord {
    let mut record = gg_record(id, true, false);
    record.subject.harness_slug = HarnessSlug::Claude;
    record.subject.model_id = "claude-sonnet-4-5".to_string();
    record.subject.gg_capability_set = None;
    record.subject.gg_summary = None;
    record
}

/// Inserting a spread of gg runs and grouping by whether compaction is enabled, the
/// per-bucket average of the ran-out-of-context flag (the overflow rate) differs
/// between the arms — the headline result-aggregation query, end to end through the
/// store.
#[tokio::test]
async fn group_by_compaction_enabled_context_overflow_rate_differs() {
    let db = Db::connect_in_memory().await.unwrap();

    // Compaction OFF: two runs, one of which ran out of context → rate 0.5.
    db.push(&gg_record("off-1", false, true), &RunLinks::default(), None)
        .await
        .unwrap();
    db.push(
        &gg_record("off-2", false, false),
        &RunLinks::default(),
        None,
    )
    .await
    .unwrap();
    // Compaction ON: two runs, neither overflowing → rate 0.0.
    db.push(&gg_record("on-1", true, false), &RunLinks::default(), None)
        .await
        .unwrap();
    db.push(&gg_record("on-2", true, false), &RunLinks::default(), None)
        .await
        .unwrap();
    // A conventional run that must not enter the gg aggregation.
    db.push(&claude_record("claude-1"), &RunLinks::default(), None)
        .await
        .unwrap();

    let runs = db.list_gg_runs(None).await.unwrap();
    assert_eq!(runs.len(), 4, "only the four gg runs are loaded");

    let query = GgAggregateQuery {
        test_case: None,
        facet_filters: Vec::new(),
        metric_filters: Vec::new(),
        group_by: vec![GgFacet::CapabilityEnabled {
            capability: CAPABILITY_COMPACTION.to_string(),
        }],
        metrics: vec![GgMetricSpec {
            metric: GgMetric::Summary {
                field: GgSummaryField::RanOutOfContext,
            },
            agg: GgAggregation::Avg,
        }],
    };

    // No reviews are inserted, so score resolves to None; this query needs none.
    let resp = aggregate_stored_gg_runs(&runs, &query, |_| None);
    assert_eq!(resp.total_runs, 4);
    assert_eq!(resp.buckets.len(), 2);

    let rate_for = |enabled: &str| -> f64 {
        let bucket = resp
            .buckets
            .iter()
            .find(|b| b.key[0].value.as_deref() == Some(enabled))
            .expect("a bucket for the compaction arm");
        assert_eq!(bucket.n, 2);
        bucket.metrics[0]
            .value
            .expect("an aggregated overflow rate")
    };

    assert_eq!(rate_for("false"), 0.5, "compaction-off overflow rate");
    assert_eq!(rate_for("true"), 0.0, "compaction-on overflow rate");
}

/// Grouping and filtering by whether a tool was offered slices the population by the effective
/// toolset recorded on each run — the toolset-ablation query, end to end through the store. Two
/// runs offered `edit_file`; one offered only `write_file`.
#[tokio::test]
async fn group_and_filter_by_tool_offered_slices_by_the_effective_toolset() {
    let db = Db::connect_in_memory().await.unwrap();

    let with_tools = |id: &str, tools: &[&str]| {
        let mut r = gg_record(id, true, false);
        r.subject.gg_summary = Some(GgSessionSummary {
            effective_tools: tools.iter().map(|s| s.to_string()).collect(),
            ..summary()
        });
        r
    };
    db.push(
        &with_tools("t1", &["shell", "edit_file"]),
        &RunLinks::default(),
        None,
    )
    .await
    .unwrap();
    db.push(
        &with_tools("t2", &["shell", "edit_file"]),
        &RunLinks::default(),
        None,
    )
    .await
    .unwrap();
    db.push(
        &with_tools("t3", &["shell", "write_file"]),
        &RunLinks::default(),
        None,
    )
    .await
    .unwrap();

    let runs = db.list_gg_runs(None).await.unwrap();

    // Group by whether `edit_file` was offered: two "true", one "false".
    let group = GgAggregateQuery {
        test_case: None,
        facet_filters: Vec::new(),
        metric_filters: Vec::new(),
        group_by: vec![GgFacet::ToolOffered {
            tool: "edit_file".to_string(),
        }],
        metrics: Vec::new(),
    };
    let resp = aggregate_stored_gg_runs(&runs, &group, |_| None);
    assert_eq!(resp.total_runs, 3);
    let n_for = |v: &str| {
        resp.buckets
            .iter()
            .find(|b| b.key[0].value.as_deref() == Some(v))
            .map(|b| b.n)
    };
    assert_eq!(n_for("true"), Some(2), "two runs offered edit_file");
    assert_eq!(n_for("false"), Some(1), "one run did not");

    // Filter to runs that did NOT offer `edit_file` (the "only write_file" arm).
    let filter = GgAggregateQuery {
        test_case: None,
        facet_filters: vec![test_cabinet_core::gg_aggregate::GgFacetFilter {
            facet: GgFacet::ToolOffered {
                tool: "edit_file".to_string(),
            },
            op: test_cabinet_core::gg_aggregate::GgFacetOp::Eq,
            value: Some("false".to_string()),
        }],
        metric_filters: Vec::new(),
        group_by: Vec::new(),
        metrics: Vec::new(),
    };
    let resp = aggregate_stored_gg_runs(&runs, &filter, |_| None);
    assert_eq!(
        resp.total_runs, 1,
        "only the no-edit_file run passes the filter"
    );
}

/// The `testCase` narrowing and a facet filter compose: filtering to the
/// compaction-off arm returns only those runs, each bucketed with its state.
#[tokio::test]
async fn test_case_and_facet_filter_narrow_the_population() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&gg_record("off-1", false, true), &RunLinks::default(), None)
        .await
        .unwrap();
    db.push(&gg_record("on-1", true, false), &RunLinks::default(), None)
        .await
        .unwrap();

    let runs = db.list_gg_runs(Some("pong")).await.unwrap();
    let query = GgAggregateQuery {
        test_case: Some("pong".to_string()),
        facet_filters: vec![test_cabinet_core::gg_aggregate::GgFacetFilter {
            facet: GgFacet::CapabilityEnabled {
                capability: CAPABILITY_COMPACTION.to_string(),
            },
            op: test_cabinet_core::gg_aggregate::GgFacetOp::Eq,
            value: Some("false".to_string()),
        }],
        metric_filters: Vec::new(),
        group_by: Vec::new(),
        metrics: Vec::new(),
    };

    let resp = aggregate_stored_gg_runs(&runs, &query, |_| None);
    assert_eq!(resp.total_runs, 1);
    assert_eq!(resp.buckets.len(), 1);
    assert_eq!(resp.buckets[0].n, 1);
    // The single bucket still reports its terminal-state distribution.
    assert_eq!(
        resp.buckets[0].state_distribution[0].state,
        RunState::Completed
    );
}
