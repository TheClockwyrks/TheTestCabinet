//! TCQ's tests, in two halves.
//!
//! The first half executes `gg_query.conformance.json` — the **shared** fixture the
//! TypeScript twin runs too. It is the only thing standing between two independent
//! evaluators and two different published numbers, so every case in it names the rule
//! it pins and every new rule owes it a case.
//!
//! The second half tests what only Rust has: the [document builder](build_run_doc),
//! whose job is to decide what a field is called and when it exists at all.

use serde::Deserialize;

use super::*;
use crate::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_FSM, CAPABILITY_MEMORIES, CAPABILITY_SHELL, GgAgentConfig,
    GgCapabilityConfig, GgCapabilitySet, GgHealingSummary, GgRunLimits, GgSessionSummary,
    GgSlotCost,
};
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::run_record::{
    AuthMode, HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject,
    RunTooling,
};
use crate::test_case::TestType;
use crate::validation::ValidationSummary;

// --- the shared conformance fixture -------------------------------------------

/// The fixture, compiled in so the test cannot silently run against a missing file.
const CONFORMANCE: &str = include_str!("gg_query.conformance.json");

/// The fixture document: a corpus, and the cases to run over it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Conformance {
    documents: Vec<GgRunDoc>,
    cases: Vec<ConformanceCase>,
    /// The expected [field catalog](field_catalog) over the whole corpus — the
    /// *second* mirrored function, whose drift is a one-host-only autocomplete
    /// regression rather than a wrong number, and therefore quieter.
    field_catalog: GgFieldCatalog,
}

/// One case: a query and what it must produce.
///
/// `deny_unknown_fields` on both this and [`ConformanceExpect`] is load-bearing rather
/// than tidy. Every assertion below is optional, so a misspelled expectation key —
/// `documentIDs` for `documentIds` — would deserialize into `None`, silently degrade
/// that case to a `totalRuns` check, and leave the suite green. The fixture would then
/// be *quieter* than no fixture at all, because it would still look like coverage. The
/// TypeScript twin reads this same file and must reject unknown keys too.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConformanceCase {
    name: String,
    /// Why the case exists, so a future reader deleting it has to argue with the
    /// reason rather than with an opaque assertion.
    #[allow(dead_code)]
    why: String,
    query: GgQuery,
    expect: ConformanceExpect,
}

/// The expected result. Document queries assert the **ids in order** rather than the
/// whole documents — the ordering is the property under test, and repeating six full
/// documents per case would bury it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConformanceExpect {
    total_runs: u64,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    document_ids: Option<Vec<String>>,
    #[serde(default)]
    buckets: Option<Vec<GgBucket>>,
    #[serde(default)]
    columns: Option<Vec<GgAggColumn>>,
}

fn conformance() -> Conformance {
    serde_json::from_str(CONFORMANCE).expect("the conformance fixture parses")
}

#[test]
fn the_conformance_fixture_pins_every_evaluator_rule() {
    let fixture = conformance();
    for case in &fixture.cases {
        let actual = evaluate(&fixture.documents, &case.query);
        let name = &case.name;
        assert_eq!(
            actual.total_runs, case.expect.total_runs,
            "{name}: total runs"
        );
        assert_eq!(actual.truncated, case.expect.truncated, "{name}: truncated");
        // A case that asserts nothing but a run count is not pinning an evaluator rule,
        // and it is exactly what a typo'd expectation key degrades into. `total_runs` is
        // the one field every case shares, so it cannot stand in for the assertion the
        // case exists to make.
        assert!(
            case.expect.document_ids.is_some()
                || case.expect.buckets.is_some()
                || case.expect.columns.is_some(),
            "{name}: a case must assert documents, buckets or columns, not just a count"
        );
        if let Some(expected) = &case.expect.document_ids {
            let ids: Vec<&str> = actual.documents.iter().map(GgRunDoc::id).collect();
            assert_eq!(ids, expected.as_slice(), "{name}: document ids, in order");
        }
        if let Some(expected) = &case.expect.buckets {
            assert_eq!(&actual.buckets, expected, "{name}: buckets");
        }
        if let Some(expected) = &case.expect.columns {
            assert_eq!(&actual.columns, expected, "{name}: columns");
        }
    }
}

#[test]
fn the_conformance_fixture_pins_the_field_catalog() {
    let fixture = conformance();
    assert_eq!(field_catalog(&fixture.documents), fixture.field_catalog);
}

#[test]
fn the_conformance_fixture_covers_the_named_hazards() {
    // The fixture is the *only* defence against mirrored drift, so a case being
    // deleted has to be as loud as a rule changing. These are the hazards the design
    // called out by name.
    let fixture = conformance();
    let names: Vec<&str> = fixture.cases.iter().map(|c| c.name.as_str()).collect();
    for needle in [
        "absent field fails !=",
        "not is the only way",
        "total cap.* projection",
        "sparse tool.*",
        "glob",
        "open-ended range",
        "n=1",
        "n=2",
        "n=3",
        "n=4",
        "day histogram",
        "week histogram",
        "Unicode code point",
        "absent value last",
    ] {
        assert!(
            names.iter().any(|name| name.contains(needle)),
            "the conformance fixture lost its {needle:?} case"
        );
    }
}

// --- the language's own invariants --------------------------------------------

#[test]
fn a_week_bucket_opens_on_the_monday_before_the_epoch() {
    // The epoch was a Thursday, so an epoch-floored week would run Thursday to
    // Wednesday. 1767225600000 is 2026-01-01T00:00:00Z, itself a Thursday.
    let week = GgInterval {
        count: 1,
        unit: GgIntervalUnit::Week,
    };
    assert_eq!(week.floor(1_767_225_600_000), 1_766_966_400_000);
    // The origin itself floors to itself, and one millisecond earlier falls into the
    // previous week — the boundary a truncating division would get wrong on the
    // negative side.
    assert_eq!(week.floor(WEEK_ORIGIN_MS), WEEK_ORIGIN_MS);
    assert_eq!(
        week.floor(WEEK_ORIGIN_MS - 1),
        WEEK_ORIGIN_MS - GgIntervalUnit::Week.millis()
    );
}

#[test]
fn a_multi_unit_interval_is_a_multiple_of_its_unit() {
    let fifteen = GgInterval {
        count: 15,
        unit: GgIntervalUnit::Minute,
    };
    assert_eq!(fifteen.millis(), 900_000);
    assert_eq!(fifteen.floor(901_000), 900_000);
    // A zero count would divide by zero; it is treated as one rather than panicking on
    // a hand-built query.
    let zero = GgInterval {
        count: 0,
        unit: GgIntervalUnit::Hour,
    };
    assert_eq!(zero.millis(), 3_600_000);
}

#[test]
fn an_un_aliased_column_names_itself_the_same_way_everywhere() {
    // A column name is what a `sort` stage and a saved dashboard bind to, so it has to
    // be a pure function of the query rather than something the renderer invents.
    let counted = GgAgg {
        func: GgAggFunc::Count,
        field: None,
        alias: None,
    };
    assert_eq!(counted.name(), "count()");
    let avg = GgAgg {
        func: GgAggFunc::Avg,
        field: Some("score".to_string()),
        alias: None,
    };
    assert_eq!(avg.name(), "avg(score)");
    let aliased = GgAgg {
        alias: Some("mean_score".to_string()),
        ..avg
    };
    assert_eq!(aliased.name(), "mean_score");
}

#[test]
fn group_keys_are_clamped_to_the_documented_maximum() {
    // The TypeScript compiler rejects a longer list; a hand-built query must not get
    // further, because bucket cardinality is the product of the keys' cardinalities.
    let docs = conformance().documents;
    let query = GgQuery {
        stats: Some(GgStatsStage {
            aggs: vec![GgAgg {
                func: GgAggFunc::Count,
                field: None,
                alias: None,
            }],
            group_by: vec![
                GgGroupKey::Field {
                    field: "case".to_string(),
                },
                GgGroupKey::Field {
                    field: "state".to_string(),
                },
                GgGroupKey::Field {
                    field: "published".to_string(),
                },
                GgGroupKey::Field {
                    field: "model".to_string(),
                },
            ],
        }),
        ..GgQuery::default()
    };
    let response = evaluate(&docs, &query);
    assert!(
        response
            .buckets
            .iter()
            .all(|b| b.key.len() == GG_MAX_GROUP_KEYS),
        "a fourth group key must be dropped, not honoured"
    );
}

#[test]
fn a_non_finite_number_never_reaches_a_document() {
    // Rule 7. A NaN would make the total order intransitive and an average
    // unrecoverable, so it is dropped at the door rather than defended against
    // downstream.
    let mut doc = GgRunDoc::default();
    doc.insert("ok", 1.0);
    doc.insert("nan", f64::NAN);
    doc.insert("inf", f64::INFINITY);
    assert!(doc.get("ok").is_some());
    assert!(doc.get("nan").is_none());
    assert!(doc.get("inf").is_none());
}

// --- the document builder -----------------------------------------------------

/// A capability set with an explicit `compaction` (on, with typed params) and an
/// explicit `memories` (off), so both the total projection and the typed-param rule
/// have something to bite on.
fn capability_set() -> GgCapabilitySet {
    GgCapabilitySet {
        preset: Some("planning-A".to_string()),
        agents: vec![
            GgAgentConfig {
                name: "root".to_string(),
                model_id: "anthropic/claude-a".to_string(),
                capabilities: vec![
                    GgCapabilityConfig::enabled(CAPABILITY_SHELL),
                    GgCapabilityConfig {
                        implementation: Some("handoff".to_string()),
                        params: serde_json::json!({
                            "summaryHeadroom": 0.6,
                            "handoffModel": "anthropic/claude-b",
                            "nested": { "depth": 2 }
                        }),
                        ..GgCapabilityConfig::enabled(CAPABILITY_COMPACTION)
                    },
                    GgCapabilityConfig::disabled(CAPABILITY_MEMORIES),
                ],
                ..GgAgentConfig::root()
            },
            // Declares no capabilities of its own, so the run-wide `cap.*` reads are the
            // root's and the assertions below stay about the root's configuration.
            // `the_capability_namespace_reads_every_agent` is where a subagent-only
            // enablement is exercised.
            GgAgentConfig {
                name: "reviewer".to_string(),
                model_id: "openai/gpt-x".to_string(),
                capabilities: Vec::new(),
                ..GgAgentConfig::root()
            },
        ],
        ..GgCapabilitySet::default()
    }
}

fn session_summary() -> GgSessionSummary {
    GgSessionSummary {
        terminal_status: "completed".to_string(),
        agents_spawned: 3,
        subagent_count: 2,
        max_subagent_depth: 1,
        compactions: 1,
        ran_out_of_context: false,
        context_overflow_count: 0,
        final_fullness: Some(0.42),
        issue_reviews: 0,
        review_cycles: 0,
        issues_reopened: 0,
        speculations: 0,
        execution_mode: "tool_calling".to_string(),
        code_executions: 0,
        healing: GgHealingSummary::default(),
        issues_created: 0,
        issues_completed: 0,
        slot_costs: vec![
            GgSlotCost {
                slot: "primary".to_string(),
                model_id: "anthropic/claude-a".to_string(),
                tokens: TokenCounts {
                    uncached_input: Some(100),
                    cached_input: None,
                    output: Some(50),
                    reasoning: None,
                },
                cost: Some(Cost {
                    comparable: Some(0.25),
                    actual: Some(0.25),
                }),
            },
            GgSlotCost {
                slot: "reviewer".to_string(),
                model_id: "anthropic/claude-a".to_string(),
                tokens: TokenCounts {
                    uncached_input: Some(10),
                    cached_input: None,
                    output: Some(5),
                    reasoning: None,
                },
                cost: Some(Cost {
                    comparable: Some(0.05),
                    actual: Some(0.05),
                }),
            },
        ],
        effective_tools: vec!["shell".to_string(), "read_file".to_string()],
        limits: GgRunLimits::default(),
        limit_hit: None,
    }
}

fn gg_record() -> RunRecord {
    RunRecord {
        id: "run-1".to_string(),
        started_at: "2026-01-01T00:00:00Z".to_string(),
        finished_at: "2026-01-01T01:00:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "carom".to_string(),
            test_case_version: "v2.0.0".to_string(),
            test_type: TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Gg,
            harness_version: Some("0.7.0".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            model_id: "anthropic/claude-a".to_string(),
            gg_capability_set: Some(capability_set()),
            gg_summary: Some(session_summary()),
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".to_string(),
            container_image: "test-cabinet/gg:latest".to_string(),
            node_version: None,
            auth_mode: AuthMode::ApiKey,
        },
        metrics: RunMetrics {
            run_time_seconds: 3600.0,
            tokens: TokenCounts {
                uncached_input: Some(110),
                cached_input: None,
                output: Some(55),
                reasoning: None,
            },
            cost: Cost {
                comparable: Some(0.3),
                actual: Some(0.3),
            },
        },
        validation: ValidationSummary::default(),
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: Some("abc123".to_string()),
    }
}

#[test]
fn the_capability_namespace_is_total_over_the_catalog() {
    // The property the whole `cap.*` design rests on: a run that never mentioned a
    // capability still stores an explicit `false` for it, so `avg(cap.x)` is an
    // enablement rate over *all* runs rather than over the ones that configured it.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    for id in GG_CAPABILITY_CATALOG {
        assert!(
            doc.get(&format!("cap.{id}")).is_some(),
            "cap.{id} must be stored even when the run never named it"
        );
    }
    assert_eq!(doc.get("cap.compaction"), Some(&GgValue::Bool(true)));
    assert_eq!(doc.get("cap.memories"), Some(&GgValue::Bool(false)));
    // Never configured at all — still false, never absent.
    assert_eq!(doc.get("cap.fsm"), Some(&GgValue::Bool(false)));
}

/// **`cap.<id>` is a run-wide read, not a root-only one**, and per-agent detail survives
/// beside it.
///
/// The root-only reading of a capability set is a defect this codebase has already been
/// bitten by once — enabling `replay` on the one subagent under suspicion did nothing at
/// all, which is why [`GgCapabilitySet::any_agent_enabled`] exists. `cap.*` is the field an
/// ablation slices on and `avg(cap.x)` is meant to be an enablement *rate*, so a run that
/// configured a capability per-agent must not be counted as a run that did without it.
#[test]
fn the_capability_namespace_reads_every_agent() {
    let mut record = gg_record();
    let set = record.subject.gg_capability_set.as_mut().expect("set");
    // `fsm` on the subagent only, and the root does not mention it at all.
    set.agents[1]
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_FSM));
    assert!(
        !set.is_enabled(CAPABILITY_FSM),
        "the fixture must actually leave the root without it, or this proves nothing"
    );
    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert_eq!(doc.get("cap.fsm"), Some(&GgValue::Bool(true)));
    // The params come from whichever agent carries the configuration, so a subagent-only
    // capability does not report itself as enabled with nothing configured.
    assert_eq!(
        doc.get("cap.fsm.impl"),
        Some(&GgValue::String("default".to_string()))
    );

    // Per-agent detail is recoverable, and it is sparse: only the agents that have a
    // capability get a field, and only ever as `true`.
    assert_eq!(
        doc.get("agent.reviewer.cap.fsm"),
        Some(&GgValue::Bool(true))
    );
    assert!(doc.get("agent.root.cap.fsm").is_none());
    assert_eq!(
        doc.get("agent.root.cap.compaction"),
        Some(&GgValue::Bool(true))
    );
    assert!(
        doc.get("agent.root.cap.memories").is_none(),
        "a capability the root carries but disabled is absent per agent, never false"
    );
}

#[test]
fn a_capability_outside_the_catalog_is_still_queryable() {
    // The catalog is the floor, not the ceiling: an externally supplied capability
    // must not vanish from the document just because core has never heard of it —
    // including one only a subagent declares, which a root-only union would have
    // dropped from the document entirely rather than merely reported as false.
    let mut record = gg_record();
    let set = record.subject.gg_capability_set.as_mut().expect("set");
    set.agents[0]
        .capabilities
        .push(GgCapabilityConfig::enabled("third-party-thing"));
    set.agents[1]
        .capabilities
        .push(GgCapabilityConfig::enabled("subagent-only-thing"));
    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert_eq!(doc.get("cap.third-party-thing"), Some(&GgValue::Bool(true)));
    assert_eq!(
        doc.get("cap.subagent-only-thing"),
        Some(&GgValue::Bool(true))
    );
}

#[test]
fn a_capability_param_keeps_its_type() {
    // The implementation this replaced stringified every param, which made
    // `cap.compaction.summaryHeadroom > 0.5` inexpressible. Nested params flatten with
    // the same dotted rule as everything else.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(
        doc.get("cap.compaction.summaryHeadroom"),
        Some(&GgValue::Number(0.6))
    );
    assert_eq!(
        doc.get("cap.compaction.nested.depth"),
        Some(&GgValue::Number(2.0))
    );
    assert_eq!(
        doc.get("cap.compaction.impl"),
        Some(&GgValue::String("handoff".to_string()))
    );
    // A capability the set does not carry has no implementation to report, so the
    // field is absent rather than invented — only the enabled flag is made total.
    assert!(doc.get("cap.fsm.impl").is_none());
}

#[test]
fn the_tool_namespace_stays_sparse() {
    // Deliberately the opposite of `cap.*`: the tool universe is per-run, so there is
    // no honest closed set to write `false` over. "Never offered" is asked as a
    // negation, and the field sidebar's document count is what makes that visible.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(doc.get("tool.shell"), Some(&GgValue::Bool(true)));
    assert_eq!(doc.get("tool.read_file"), Some(&GgValue::Bool(true)));
    assert!(doc.get("tool.edit_file").is_none());
}

#[test]
fn an_array_on_the_summary_contributes_only_its_length() {
    // Rule 4, and the reason every other feature owes this module scalars: positional
    // keys are unqueryable, so the array itself surfaces only as a count and the data
    // that matters is folded into a purpose-built namespace.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(
        doc.get("summary.slotCosts.count"),
        Some(&GgValue::Number(2.0))
    );
    assert_eq!(
        doc.get("summary.effectiveTools.count"),
        Some(&GgValue::Number(2.0))
    );
    assert!(doc.get("summary.slotCosts.0.cost").is_none());
    // The per-model fold is what keeps the spend queryable: both slots ran on the same
    // model, so their tokens and cost add up under one key.
    assert_eq!(
        doc.get("model.anthropic/claude-a.tokens"),
        Some(&GgValue::Number(165.0))
    );
    assert_eq!(
        doc.get("model.anthropic/claude-a.cost"),
        Some(&GgValue::Number(0.3))
    );
}

#[test]
fn the_whole_session_summary_is_queryable_without_an_enum_arm() {
    // The property that replaced the 27-variant hand-matched summary-field enum.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(
        doc.get("summary.agentsSpawned"),
        Some(&GgValue::Number(3.0))
    );
    assert_eq!(
        doc.get("summary.ranOutOfContext"),
        Some(&GgValue::Bool(false))
    );
    assert_eq!(
        doc.get("summary.finalFullness"),
        Some(&GgValue::Number(0.42))
    );
    assert_eq!(
        doc.get("summary.healing.healed"),
        Some(&GgValue::Number(0.0))
    );
    // The three top-level aliases the language's own vocabulary leans on.
    assert_eq!(
        doc.get("status"),
        Some(&GgValue::String("completed".to_string()))
    );
    assert_eq!(
        doc.get("mode"),
        Some(&GgValue::String("tool_calling".to_string()))
    );
    assert_eq!(doc.get("limit"), Some(&GgValue::String("none".to_string())));
}

#[test]
fn a_run_that_produced_nothing_reports_no_metrics_rather_than_zero() {
    // Rule 3. A failure record is built with default metrics, and flattening those
    // naively would drag every average toward zero with exactly the runs that burned
    // the most budget.
    let mut record = gg_record();
    record.metrics = RunMetrics::default();
    record.status.state = RunState::TimedOut;
    record.subject.gg_summary = None;
    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert!(doc.get("metric.runTimeSeconds").is_none());
    assert!(doc.get("metric.totalTokens").is_none());
    assert!(doc.get("metric.cost").is_none());
    // The marker is what makes the missing summary expressible as a denominator.
    assert_eq!(doc.get("has.summary"), Some(&GgValue::Bool(false)));
    assert_eq!(doc.get("has.capabilitySet"), Some(&GgValue::Bool(true)));
}

#[test]
fn the_lifecycle_columns_ride_beside_the_record() {
    // A review and a publish change what the document must say without rewriting the
    // record, which is why they are passed in rather than read off it.
    let lifecycle = GgDocLifecycle {
        published: true,
        rating: Some(crate::review::Rating::Great),
        score: Some(0.8),
        review_count: 3,
    };
    let doc = build_run_doc(&gg_record(), &lifecycle);
    assert_eq!(doc.get("published"), Some(&GgValue::Bool(true)));
    assert_eq!(
        doc.get("rating"),
        Some(&GgValue::String("great".to_string()))
    );
    assert_eq!(doc.get("score"), Some(&GgValue::Number(0.8)));
    assert_eq!(doc.get("reviewCount"), Some(&GgValue::Number(3.0)));
    // An unreviewed run has no rating and no score at all — absent, so it fails every
    // comparison rather than reading as a zero-scoring run.
    let unreviewed = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert!(unreviewed.get("rating").is_none());
    assert!(unreviewed.get("score").is_none());
}

#[test]
fn timestamps_become_epoch_milliseconds() {
    // Rule 6: a date *is* a number, so nothing downstream needs a calendar.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(
        doc.get("started"),
        Some(&GgValue::Number(1_767_225_600_000.0))
    );
    assert_eq!(
        doc.get("finished"),
        Some(&GgValue::Number(1_767_229_200_000.0))
    );
    // An unparseable timestamp leaves the field absent rather than claiming the run
    // happened at the epoch — which would sort it to the *front* of a recency listing.
    let mut record = gg_record();
    record.finished_at = "not a timestamp".to_string();
    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert!(doc.get("finished").is_none());
}

#[test]
fn a_date_field_is_labelled_as_one_even_though_it_is_a_number() {
    // Date-ness cannot be observed from the values, so the catalog reads it off the
    // known date fields — otherwise the editor would offer a raw number box for a
    // timestamp.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    let catalog = field_catalog(&[doc]);
    let kind = |name: &str| {
        catalog
            .fields
            .iter()
            .find(|f| f.name == name)
            .map(|f| f.kind)
    };
    assert_eq!(kind("finished"), Some(GgFieldKind::Date));
    assert_eq!(kind("started"), Some(GgFieldKind::Date));
    assert_eq!(kind("metric.runTimeSeconds"), Some(GgFieldKind::Number));
    assert_eq!(kind("case"), Some(GgFieldKind::String));
    assert_eq!(kind("cap.shell"), Some(GgFieldKind::Boolean));
}

#[test]
fn the_capability_catalog_covers_every_capability_gg_ships() {
    // The `cap.*` namespace's totality is only as good as this list, and the failure
    // mode of forgetting an entry is quiet: the field turns sparse, so an average over
    // it silently becomes a rate among the runs that happened to configure it. Read
    // the ids straight out of the module that declares them rather than restating
    // them, so a new capability cannot land without either updating the catalog or
    // turning this red.
    const GG_SOURCE: &str = include_str!("gg.rs");
    let declared: Vec<&str> = GG_SOURCE
        .lines()
        .filter_map(|line| line.strip_prefix("pub const CAPABILITY_"))
        .filter_map(|rest| rest.split_once("&str = \""))
        .filter_map(|(_, value)| value.split_once('"'))
        .map(|(id, _)| id)
        .collect();
    assert!(
        declared.len() > 20,
        "the capability-id scan found only {} ids — the declaration shape moved",
        declared.len()
    );
    for id in declared {
        assert!(
            GG_CAPABILITY_CATALOG.contains(&id),
            "capability {id:?} is not in GG_CAPABILITY_CATALOG, so `cap.{id}` would be \
             sparse instead of total"
        );
    }
}
