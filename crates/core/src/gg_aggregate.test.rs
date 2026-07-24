use super::*;

use crate::gg::{GgCapabilityConfig, GgSlotBinding, PRIMARY_SLOT};
use serde_json::json;

/// A summary with every count at a baseline, so a test tweaks only the fields it
/// exercises.
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
        code_reviews: 0,
        review_cycles: 0,
        issues_reopened: 0,
        speculations: 0,
        issues_created: 0,
        issues_completed: 0,
        slot_costs: Vec::new(),
    }
}

/// A minimal row: a `pong` run bound to a model, a default summary, no metrics.
fn row() -> GgAggregateRow {
    GgAggregateRow {
        test_case: "pong".to_string(),
        capability_set: Some(GgCapabilitySet::minimal("mock/echo")),
        summary: Some(summary()),
        run_time_seconds: 10.0,
        total_tokens: Some(1_000),
        cost_comparable: Some(0.10),
        run_state: RunState::Completed,
        score: Some(0.5),
    }
}

/// Build a capability set with `compaction` explicitly on or off (the canonical
/// ablation lever), keeping the default capabilities.
fn set_with_compaction(model: &str, on: bool) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal(model);
    set.capabilities.push(if on {
        GgCapabilityConfig::enabled(crate::gg::CAPABILITY_COMPACTION)
    } else {
        GgCapabilityConfig::disabled(crate::gg::CAPABILITY_COMPACTION)
    });
    set
}

#[test]
fn facets_extracts_enabled_impl_params_slots_and_preset() {
    // A hand-built set with a preset, a params-carrying capability, and a bound slot
    // exposes exactly the sliceable facets a study picks from.
    let mut set = GgCapabilitySet {
        preset: Some("planning-A".to_string()),
        capabilities: vec![GgCapabilityConfig {
            id: crate::gg::CAPABILITY_COMPACTION.to_string(),
            enabled: true,
            implementation: Some("summarize-v2".to_string()),
            params: json!({ "triggerFullness": 0.8 }),
        }],
        slots: vec![GgSlotBinding::new(PRIMARY_SLOT, "mock/echo")],
    };
    // A capability with no implementation selected reports the "default" bucket.
    set.capabilities
        .push(GgCapabilityConfig::enabled(crate::gg::CAPABILITY_SKILLS));

    let facets = set.facets();
    let find = |facet: &GgFacet| {
        facets
            .iter()
            .find(|b| &b.facet == facet)
            .unwrap_or_else(|| panic!("missing facet {facet:?}"))
            .value
            .clone()
    };

    assert_eq!(find(&GgFacet::Preset {}), Some("planning-A".to_string()));
    assert_eq!(
        find(&GgFacet::CapabilityEnabled {
            capability: crate::gg::CAPABILITY_COMPACTION.to_string()
        }),
        Some("true".to_string())
    );
    assert_eq!(
        find(&GgFacet::CapabilityImplementation {
            capability: crate::gg::CAPABILITY_COMPACTION.to_string()
        }),
        Some("summarize-v2".to_string())
    );
    assert_eq!(
        find(&GgFacet::CapabilityImplementation {
            capability: crate::gg::CAPABILITY_SKILLS.to_string()
        }),
        Some("default".to_string())
    );
    assert_eq!(
        find(&GgFacet::CapabilityParam {
            capability: crate::gg::CAPABILITY_COMPACTION.to_string(),
            param: "triggerFullness".to_string()
        }),
        Some("0.8".to_string())
    );
    assert_eq!(
        find(&GgFacet::SlotModel {
            slot: PRIMARY_SLOT.to_string()
        }),
        Some("mock/echo".to_string())
    );
}

#[test]
fn capability_enabled_facet_treats_absent_as_off() {
    // A capability the set never configured is off, not absent — so "compaction off"
    // slices catch it. The minimal set carries no compaction.
    let facet = GgFacet::CapabilityEnabled {
        capability: crate::gg::CAPABILITY_COMPACTION.to_string(),
    };
    let set = GgCapabilitySet::minimal("mock/echo");
    assert_eq!(
        facet.resolve("pong", Some(&set), None),
        Some("false".to_string())
    );
}

#[test]
fn group_by_compaction_enabled_averages_context_overflow_rate() {
    // The headline query: group by whether compaction is on and average the
    // context-overflow flag — the off arm should overflow more often than the on arm.
    let mut rows = Vec::new();

    // Two compaction-off runs, one of which ran out of context → rate 0.5.
    for ran_out in [true, false] {
        let mut r = row();
        r.capability_set = Some(set_with_compaction("mock/echo", false));
        r.summary = Some(GgSessionSummary {
            ran_out_of_context: ran_out,
            ..summary()
        });
        rows.push(r);
    }
    // Two compaction-on runs, neither overflowing → rate 0.0.
    for _ in 0..2 {
        let mut r = row();
        r.capability_set = Some(set_with_compaction("mock/echo", true));
        rows.push(r);
    }

    let query = GgAggregateQuery {
        test_case: None,
        facet_filters: Vec::new(),
        metric_filters: Vec::new(),
        group_by: vec![GgFacet::CapabilityEnabled {
            capability: crate::gg::CAPABILITY_COMPACTION.to_string(),
        }],
        metrics: vec![GgMetricSpec {
            metric: GgMetric::Summary {
                field: GgSummaryField::RanOutOfContext,
            },
            agg: GgAggregation::Avg,
        }],
    };

    let resp = aggregate(&rows, &query);
    assert_eq!(resp.total_runs, 4);
    assert_eq!(resp.buckets.len(), 2);

    let rate_for = |enabled: &str| -> f64 {
        let bucket = resp
            .buckets
            .iter()
            .find(|b| b.key[0].value.as_deref() == Some(enabled))
            .expect("bucket for the compaction arm");
        assert_eq!(bucket.n, 2);
        bucket.metrics[0].value.expect("a rate was aggregated")
    };

    assert_eq!(rate_for("false"), 0.5, "compaction-off overflow rate");
    assert_eq!(rate_for("true"), 0.0, "compaction-on overflow rate");
}

#[test]
fn facet_filter_narrows_before_grouping() {
    // "runs with compaction off": a facet filter drops the on-arm entirely.
    let mut off = row();
    off.capability_set = Some(set_with_compaction("mock/echo", false));
    let mut on = row();
    on.capability_set = Some(set_with_compaction("mock/echo", true));

    let query = GgAggregateQuery {
        test_case: None,
        facet_filters: vec![GgFacetFilter {
            facet: GgFacet::CapabilityEnabled {
                capability: crate::gg::CAPABILITY_COMPACTION.to_string(),
            },
            op: GgFacetOp::Eq,
            value: Some("false".to_string()),
        }],
        metric_filters: Vec::new(),
        group_by: Vec::new(),
        metrics: Vec::new(),
    };

    let resp = aggregate(&[off, on], &query);
    assert_eq!(resp.total_runs, 1);
    assert_eq!(resp.buckets.len(), 1);
    assert_eq!(resp.buckets[0].n, 1);
}

#[test]
fn metric_filter_enforces_a_fixed_budget() {
    // "at a fixed budget": a cost ceiling excludes the expensive run.
    let cheap = GgAggregateRow {
        cost_comparable: Some(0.05),
        ..row()
    };
    let dear = GgAggregateRow {
        cost_comparable: Some(5.0),
        ..row()
    };

    let query = GgAggregateQuery {
        test_case: None,
        facet_filters: Vec::new(),
        metric_filters: vec![GgMetricFilter {
            metric: GgMetric::Cost {},
            op: GgCompareOp::Lte,
            value: 1.0,
        }],
        group_by: Vec::new(),
        metrics: vec![GgMetricSpec {
            metric: GgMetric::Score {},
            agg: GgAggregation::Avg,
        }],
    };

    let resp = aggregate(&[cheap, dear], &query);
    assert_eq!(resp.total_runs, 1);
    assert_eq!(resp.buckets[0].n, 1);
    assert_eq!(resp.buckets[0].metrics[0].contributing, 1);
}

#[test]
fn buckets_carry_a_state_distribution() {
    // Every bucket reports its terminal-state split without being asked.
    let completed = row();
    let catastrophic = GgAggregateRow {
        run_state: RunState::Catastrophic,
        ..row()
    };

    let resp = aggregate(
        &[completed, catastrophic],
        &GgAggregateQuery {
            test_case: None,
            facet_filters: Vec::new(),
            metric_filters: Vec::new(),
            group_by: Vec::new(),
            metrics: Vec::new(),
        },
    );
    let dist = &resp.buckets[0].state_distribution;
    assert_eq!(dist.len(), 2);
    // `RunState::ALL` order puts Completed before Catastrophic.
    assert_eq!(dist[0].state, RunState::Completed);
    assert_eq!(dist[0].count, 1);
    assert_eq!(dist[1].state, RunState::Catastrophic);
    assert_eq!(dist[1].count, 1);
}

#[test]
fn missing_metric_leaves_a_bucket_column_absent() {
    // A run with no reviews contributes no score, so an all-unscored bucket reports
    // `value: None` (not a misleading zero) while still counting the run.
    let unscored = GgAggregateRow {
        score: None,
        ..row()
    };
    let resp = aggregate(
        &[unscored],
        &GgAggregateQuery {
            test_case: None,
            facet_filters: Vec::new(),
            metric_filters: Vec::new(),
            group_by: Vec::new(),
            metrics: vec![GgMetricSpec {
                metric: GgMetric::Score {},
                agg: GgAggregation::Avg,
            }],
        },
    );
    assert_eq!(resp.buckets[0].n, 1);
    assert_eq!(resp.buckets[0].metrics[0].value, None);
    assert_eq!(resp.buckets[0].metrics[0].contributing, 0);
}
