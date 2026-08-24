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
use crate::code_analysis::{
    CodeAnalysisNotes, CodeAnalysisSummary, CodeApiSummary, CodeAuthoredBasis,
    CodeComplexitySummary, CodeDuplicationSummary, CodeGraphSummary, CodeLanguage, CodeSizeSummary,
    CodeTestSummary, CodeTreeBasis,
};
use crate::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_FSM, CAPABILITY_MEMORIES, CAPABILITY_SHELL,
    CAPABILITY_SKILLS, GgAgentConfig, GgCapabilityConfig, GgCapabilitySet, GgErrorSummary,
    GgRunLimits, GgSessionSummary, GgSlotCost, GgUndocumentedCalls, ROOT_PROFILE_ID,
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
    /// A corpus for **this case only**, replacing the shared one.
    ///
    /// Present for the handful of rules the shared corpus cannot discriminate. The
    /// chronological bucket order is the motivating example: it differs from the default
    /// count-descending order only when a *later* bucket is larger than an earlier one, and
    /// the shared corpus's busiest day is also its earliest — so every histogram case over it
    /// produces byte-identical output under both orders, and no filter over six documents can
    /// change that. Reshaping the shared corpus to fix it would rewrite the expectations of
    /// thirty other cases that were tuned to it (the quantile cases pin n=1..4 exactly), so a
    /// case that needs a different shape brings its own three documents instead.
    ///
    /// Deliberately **not** used to give every case a bespoke corpus: the shared one is what
    /// makes the cases comparable to each other and is the only corpus the
    /// [field catalog](field_catalog) is pinned over.
    #[serde(default)]
    documents: Option<Vec<GgRunDoc>>,
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
        let docs = case.documents.as_ref().unwrap_or(&fixture.documents);
        let actual = evaluate(docs, &case.query);
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
        // The hazards the TypeScript twin added when it landed. Each one is a place the
        // two implementations can disagree that the original set did not reach: string
        // ordering inside a *comparison* rather than a bucket key, the cross-kind rank,
        // a glob that only matches after backtracking, a two-component bucket key (which
        // a twin that concatenates key components can silently merge), free text against
        // a number's spelling, and the numeric coercions.
        "code point too",
        "mixed value kinds",
        "backtracks",
        "composite bucket key",
        "free text ignores numbers",
        "coerces to a number",
        "projects to 1 in a comparison",
        "min and max",
        // The hazards the mutation audit found the fixture could not discriminate: every
        // rule below survived a deliberate break of the TypeScript evaluator with all
        // thirty-two of the cases above still green.
        "later bucket is larger",
        "pre-1970",
        "below its own origin",
        "aggregation column orders buckets",
        "aliased to the same name",
        "truncates buckets",
        "fourth group key",
        "trailing star",
        "byte-order mark",
        // The hazards the **publishable** `code.*` namespace brought: a derived scalar
        // standing in for an array, the composable truncation filter (whose absent-field
        // reading is the easy one to get backwards), and the presence marker every code
        // rate is scoped on. These are the fields the public site ships, so a divergence
        // here is a wrong number on the open internet rather than in a console.
        "code.language groups",
        "not code.notes.truncated",
        "has.codeAnalysis",
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
                slug: ROOT_PROFILE_ID.to_string(),
                name: "Root".to_string(),
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
                slug: "reviewer".to_string(),
                name: "Careful Reviewer".to_string(),
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
        rejected_responses: Default::default(),
        max_response_chars: 0,
        max_response_output_tokens: 0,
        terminal_status: "completed".to_string(),
        undocumented_calls: GgUndocumentedCalls::default(),
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
        execution_mode: "tool_calling".to_string(),
        program_language: None,
        code_executions: 0,
        compile_ms: 0,
        errors: GgErrorSummary {
            turns: 20,
            errors: 3,
            max_consecutive: 2,
            model_api: 1,
            transpile: 0,
            program_fault: 2,
            sandbox_limit: 0,
            missing_completion: 0,
            loop_aborts: 4,
            loop_abort_words: 31_000,
            loop_abort_chars: 190_000,
            by_type: BTreeMap::from([
                ("model_retry_exhausted".to_string(), 1),
                ("program_api_error".to_string(), 2),
            ]),
            tool_failures: BTreeMap::from([("not-found".to_string(), 5)]),
        },
        tool_calls: 0,
        provider_stats: Vec::new(),
        issues_created: 0,
        issues_completed: 0,
        slot_costs: vec![
            GgSlotCost {
                profile_id: ROOT_PROFILE_ID.to_string(),
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
                profile_id: "reviewer".to_string(),
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
            engine_slug: "simple-2d".to_string(),
            engine_version: Some("1.0.0".to_string()),
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
        code_analysis: None,
        toolchain: None,
    }
}

/// The [engine](crate::engine) reaches the document as `engine`, for every run,
/// and is therefore filterable and groupable.
///
/// It belongs with `model` and `orchestrator` rather than with `case` and `variant`:
/// the engine is selected per run, so two runs of one case version can differ on it,
/// and the runtime a build was written against is one of the first things an analysis
/// slices by. Written unconditionally, so an engineless run reports the honest `none`
/// instead of an absence — otherwise `count() by engine` would drop exactly the runs
/// that had no runtime, which is the population every engine is measured against.
#[test]
fn the_engine_reaches_the_document_and_is_filterable() {
    let on_engine = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(
        on_engine.get("engine"),
        Some(&GgValue::String("simple-2d".to_string()))
    );

    let mut record = gg_record();
    record.id = "run-2".to_string();
    record.subject.engine_slug = crate::engine::NONE_SLUG.to_string();
    record.subject.engine_version = None;
    let engineless = build_run_doc(&record, &GgDocLifecycle::default());
    assert_eq!(
        engineless.get("engine"),
        Some(&GgValue::String("none".to_string())),
        "an engineless run states it, so the field is total over the corpus"
    );

    let docs = vec![on_engine, engineless];
    let matching = evaluate(
        &docs,
        &GgQuery {
            filter: Some(GgFilter::Compare {
                field: "engine".to_string(),
                op: GgCompareOp::Eq,
                value: GgValue::String("simple-2d".to_string()),
            }),
            ..GgQuery::default()
        },
    );
    assert_eq!(matching.total_runs, 1);
    assert_eq!(
        matching.documents[0].get("id"),
        Some(&GgValue::String("run-1".to_string()))
    );

    // And the whole corpus is accounted for when grouping by it, which is what
    // "total" buys: two buckets of one, no run left out.
    let grouped = evaluate(
        &docs,
        &GgQuery {
            stats: Some(GgStatsStage {
                aggs: vec![GgAgg {
                    func: GgAggFunc::Count,
                    field: None,
                    alias: None,
                }],
                group_by: vec![GgGroupKey::Field {
                    field: "engine".to_string(),
                }],
            }),
            ..GgQuery::default()
        },
    );
    assert_eq!(grouped.buckets.len(), 2);
    assert_eq!(grouped.total_runs, 2);
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
/// all, which is why [`GgCapabilitySet::any_agent_enabled`] exists. `cap.*` is the field a
/// comparison of two configurations slices on and `avg(cap.x)` is meant to be an enablement
/// *rate*, so a run that
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
    // capability does not report itself as enabled with nothing configured. `fsm` offers no arms
    // at all, so the arm it reports is the one that says there is none rather than a default it
    // fell back to.
    assert_eq!(
        doc.get("cap.fsm.impl"),
        Some(&GgValue::String(super::doc::NO_IMPLEMENTATION.to_string()))
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

/// **The per-agent namespace is keyed by the profile id**, which is the whole reason the id
/// exists: two profiles may carry one display name, and two profiles sharing a field key would
/// merge into one document entry — a query would then read one profile's configuration as the
/// other's, with nothing in the document to show it happened.
#[test]
fn the_per_agent_namespace_keys_on_the_id_so_two_profiles_sharing_a_name_stay_apart() {
    let mut record = gg_record();
    let set = record.subject.gg_capability_set.as_mut().expect("set");
    set.agents.push(GgAgentConfig {
        slug: "reviewer-2".to_string(),
        // The same display name the `reviewer` profile carries: legal, and the case that used to
        // be inexpressible.
        name: "Careful Reviewer".to_string(),
        model_id: "openai/gpt-y".to_string(),
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_FSM)],
        ..GgAgentConfig::root()
    });
    assert_eq!(
        set.agents[1].name, set.agents[2].name,
        "the premise: two profiles under one name"
    );

    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert_eq!(
        doc.get("agent.reviewer.model"),
        Some(&GgValue::String("openai/gpt-x".to_string()))
    );
    assert_eq!(
        doc.get("agent.reviewer-2.model"),
        Some(&GgValue::String("openai/gpt-y".to_string())),
        "each profile keeps its own field, because the key is the id",
    );
    assert_eq!(
        doc.get("agent.reviewer-2.cap.fsm"),
        Some(&GgValue::Bool(true))
    );
    assert!(
        doc.get("agent.reviewer.cap.fsm").is_none(),
        "the sibling sharing its name declared no such capability",
    );
    assert!(
        doc.get("agent.Careful Reviewer.model").is_none(),
        "nothing is keyed by a display name",
    );
}

/// **An agent-less set is malformed, and indexing one is still total.**
///
/// A set that declares no agents has no root, so no run can have produced it: both launch
/// paths refuse it by name before a container exists. It is what a hand-written, truncated
/// or otherwise corrupt record carries — and a stored record reaches the backend's document
/// indexer, where a panic would take a service down over one bad row. The builder therefore
/// writes what such a set states (no agents, and every catalog capability honestly `false`)
/// instead of unwrapping a root that is not there.
#[test]
fn an_agent_less_capability_set_still_builds_a_document() {
    // Deserialized rather than constructed: an explicit empty `agents` list is precisely
    // the shape that survives `serde` and arrives at the indexer.
    let set: GgCapabilitySet =
        serde_json::from_str(r#"{"agents": []}"#).expect("an empty agent list deserializes");
    assert!(
        set.agents.is_empty(),
        "the fixture must have no root at all"
    );
    let mut record = gg_record();
    record.subject.gg_capability_set = Some(set);

    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert_eq!(doc.get("agents"), Some(&GgValue::Number(0.0)));
    assert_eq!(doc.get("has.capabilitySet"), Some(&GgValue::Bool(true)));
    for id in GG_CAPABILITY_CATALOG {
        assert_eq!(
            doc.get(&format!("cap.{id}")),
            Some(&GgValue::Bool(false)),
            "cap.{id} must be a total, honest false"
        );
        assert!(
            doc.get(&format!("cap.{id}.impl")).is_none(),
            "no agent carries cap.{id}, so there is no implementation to report"
        );
    }
}

#[test]
fn a_stored_capability_outside_the_catalog_is_still_queryable() {
    // No *run* can record one: `GG_CAPABILITY_CATALOG` is the closed vocabulary a set is read
    // against and an id outside it refuses the launch. This is the builder's totality over what a
    // record actually carries — a hand-written or corrupted row reaching the backend's document
    // indexer, where dropping the field (or panicking) would leave the very record that needs
    // finding unfindable. It reports what is stored; it does not bless it, and the run that would
    // have written it never started. The subagent-declared id is the same argument one level down:
    // a root-only union would have dropped it from the document entirely rather than reported it.
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
fn the_error_rollup_is_queryable_the_moment_it_exists_on_the_summary() {
    // The same property one level down: `GgErrorSummary` was added to the summary and no
    // arm anywhere had to be written for it. A study asking "which configurations fail
    // more than a fifth of their turns?" divides two fields the summary carries, which is
    // exactly why no percentage is stored.
    let doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(
        doc.get("summary.errors.turns"),
        Some(&GgValue::Number(20.0))
    );
    assert_eq!(
        doc.get("summary.errors.errors"),
        Some(&GgValue::Number(3.0))
    );
    assert_eq!(
        doc.get("summary.errors.maxConsecutive"),
        Some(&GgValue::Number(2.0))
    );
    assert_eq!(
        doc.get("summary.errors.programFault"),
        Some(&GgValue::Number(2.0))
    );
    assert_eq!(
        doc.get("summary.errors.loopAborts"),
        Some(&GgValue::Number(4.0)),
        "a discarded looping attempt is money spent on nothing and must be sliceable"
    );
    assert_eq!(
        doc.get("summary.errors.loopAbortChars"),
        Some(&GgValue::Number(190_000.0)),
        "and so must the size of what it threw away, which is the half that says how much"
    );
    // And one level down again: the open per-type breakdown becomes a field per type
    // without a line of query-layer work, which is the property that lets a type added to
    // gg become queryable the moment a run records it.
    assert_eq!(
        doc.get("summary.errors.byType.program_api_error"),
        Some(&GgValue::Number(2.0)),
        "\"which configurations spend their turns fighting a call?\" is one field away"
    );
    assert_eq!(
        doc.get("summary.errors.toolFailures.not-found"),
        Some(&GgValue::Number(5.0))
    );
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

// --- the code-analysis namespace ----------------------------------------------

/// A code-analysis summary parsed in `languages`, with a couple of figures set so the
/// flattening has something recognisable to produce.
fn code_summary(languages: Vec<CodeLanguage>) -> CodeAnalysisSummary {
    CodeAnalysisSummary {
        analyzer_version: 1,
        authored_basis: CodeAuthoredBasis::SeedCommit,
        tree_basis: CodeTreeBasis::PreValidation,
        languages,
        size: CodeSizeSummary {
            files: 12,
            code_lines: 1_400,
            gini_code_lines: 0.42,
            ..CodeSizeSummary::default()
        },
        complexity: CodeComplexitySummary::default(),
        graph: CodeGraphSummary::default(),
        api: CodeApiSummary::default(),
        typescript: None,
        rust: None,
        tests: CodeTestSummary::default(),
        duplication: CodeDuplicationSummary::default(),
        notes: CodeAnalysisNotes::default(),
    }
}

/// The whole typed block is flattened, so a figure the analyzer emits is queryable with
/// no arm anywhere — the same property `summary.*` has, and the reason
/// [`crate::gg_query::flatten_json`] is shared rather than reimplemented per namespace.
#[test]
fn the_code_namespace_is_the_whole_analysis_flattened() {
    let mut record = gg_record();
    record.code_analysis = Some(code_summary(vec![CodeLanguage::TypeScript]));
    let doc = build_run_doc(&record, &GgDocLifecycle::default());

    assert_eq!(doc.get("code.size.files"), Some(&GgValue::Number(12.0)));
    assert_eq!(
        doc.get("code.size.codeLines"),
        Some(&GgValue::Number(1_400.0))
    );
    assert_eq!(
        doc.get("code.size.giniCodeLines"),
        Some(&GgValue::Number(0.42))
    );
    assert_eq!(doc.get("code.analyzerVersion"), Some(&GgValue::Number(1.0)));
    assert_eq!(
        doc.get("code.authoredBasis"),
        Some(&GgValue::String("seedCommit".to_string()))
    );
    assert_eq!(
        doc.get("code.treeBasis"),
        Some(&GgValue::String("preValidation".to_string()))
    );
    // The composable filter the truncation rule is expressed as, rather than a hidden
    // default on a query.
    assert_eq!(doc.get("code.notes.truncated"), Some(&GgValue::Bool(false)));
    // Nothing here was enumerated: a block the analyzer did not fill is simply absent.
    assert!(doc.get("code.typescript.anyAnnotations").is_none());
}

/// **`code.language` is a derived scalar**, because `languages` is an array and
/// [rule 4](crate::gg_query#the-seven-semantic-rules) makes an array contribute only its
/// length. Without it, "which language does this model write?" — the first question code
/// analysis invites — would be unaskable in the language built to ask it.
#[test]
fn the_language_list_surfaces_as_a_groupable_scalar() {
    let cases = [
        (vec![], "none"),
        (vec![CodeLanguage::TypeScript], "typescript"),
        (vec![CodeLanguage::Rust], "rust"),
        (vec![CodeLanguage::Rust, CodeLanguage::TypeScript], "mixed"),
        // Deduplicated: the same language twice is still one language.
        (vec![CodeLanguage::Rust, CodeLanguage::Rust], "rust"),
    ];
    for (languages, expected) in cases {
        let mut record = gg_record();
        let count = languages.len();
        record.code_analysis = Some(code_summary(languages));
        let doc = build_run_doc(&record, &GgDocLifecycle::default());
        assert_eq!(
            doc.get("code.language"),
            Some(&GgValue::String(expected.to_string())),
            "a tree parsed in {count} language(s) should report {expected:?}"
        );
        // The array itself contributes only its length, which is exactly why the
        // derived scalar has to exist.
        assert_eq!(
            doc.get("code.languages.count"),
            Some(&GgValue::Number(count as f64))
        );
    }
}

/// The presence marker, so a rate over the code corpus has an honest denominator
/// ([rule 2](crate::gg_query#the-seven-semantic-rules)). Code analysis is **not
/// backfilled**, so a large part of the corpus has no `code.*` at all and every code
/// aggregate must be able to scope itself.
#[test]
fn a_run_without_code_analysis_says_so_rather_than_going_quiet() {
    let without = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    assert_eq!(without.get("has.codeAnalysis"), Some(&GgValue::Bool(false)));
    assert!(without.get("code.language").is_none());
    assert!(without.get("code.size.files").is_none());

    let mut record = gg_record();
    record.code_analysis = Some(code_summary(vec![CodeLanguage::Rust]));
    let with = build_run_doc(&record, &GgDocLifecycle::default());
    assert_eq!(with.get("has.codeAnalysis"), Some(&GgValue::Bool(true)));
}

// --- the public export's redaction --------------------------------------------

/// The length rule, on the field it exists for.
///
/// A capability parameter is flattened straight out of a run's configuration, so an
/// operator who pasted a system-prompt override into one has put it in every document.
/// Publishing documents would publish it verbatim — this is the rule that makes the
/// export safe without anyone having to notice the parameter.
#[test]
fn a_long_capability_parameter_never_reaches_the_public_export() {
    let mut record = gg_record();
    let long = "You are a meticulous engineer. ".repeat(40);
    assert!(long.chars().count() > GG_PUBLIC_MAX_STRING);
    if let Some(set) = record.subject.gg_capability_set.as_mut() {
        set.agents[0].capabilities.push(GgCapabilityConfig {
            id: CAPABILITY_SKILLS.to_string(),
            enabled: true,
            implementation: None,
            params: serde_json::json!({ "systemPrompt": long, "budget": 4 }),
        });
    }

    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    assert!(
        doc.get("cap.skills.systemPrompt").is_some(),
        "the console's own document keeps the parameter — redaction is the export's job"
    );

    let public = redacted_for_public(&doc);
    assert!(public.get("cap.skills.systemPrompt").is_none());
    // Only the long string goes: the numbers beside it are the corpus.
    assert_eq!(public.get("cap.skills.budget"), Some(&GgValue::Number(4.0)));
    assert_eq!(public.get("cap.skills"), Some(&GgValue::Bool(true)));
}

/// The deny-list, on a document that carries the field.
///
/// The builder does not emit `statusDetail` today; the export refuses it by name so the
/// day something does, the first snapshot after that change does not carry a stack trace
/// to the public internet.
#[test]
fn a_denied_field_is_dropped_by_name_however_short_it_is() {
    let mut doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    for field in GG_PRIVATE_FIELDS {
        doc.insert(*field, "boom".to_string());
    }
    let public = redacted_for_public(&doc);
    for field in GG_PRIVATE_FIELDS {
        assert!(
            public.get(field).is_none(),
            "{field} is on the deny-list but survived the export"
        );
    }
}

/// The length rule covers the field **name**, not only the value.
///
/// A document's field names are not a closed vocabulary: `flatten_json` mints them from
/// arbitrary configuration keys, so `cap.<id>.<key>` bottoms out in whatever an operator
/// typed. Free text pasted as a *key* — a note above a parameter, a whole instruction
/// used as a map entry — would otherwise cross into the public corpus while the identical
/// text pasted one position to the right would not.
#[test]
fn a_field_whose_name_is_itself_free_text_is_dropped() {
    let mut doc = build_run_doc(&gg_record(), &GgDocLifecycle::default());
    let long_name = format!("cap.skills.{}", "you-are-a-meticulous-engineer-".repeat(20));
    assert!(long_name.chars().count() > GG_PUBLIC_MAX_STRING);
    doc.insert(&long_name, 4.0);

    let public = redacted_for_public(&doc);
    assert!(
        public.get(&long_name).is_none(),
        "a field name long enough to be prose is prose, whatever its value is"
    );
    // And the bound is a bound, not a namespace ban: the short sibling stays.
    doc.insert("cap.skills.budget", 4.0);
    assert_eq!(
        redacted_for_public(&doc).get("cap.skills.budget"),
        Some(&GgValue::Number(4.0)),
    );
}

/// Redaction drops fields and changes nothing else. A public figure that disagreed with
/// the console's would be indistinguishable from an evaluator bug, which is the failure
/// mode the whole mirrored-evaluator conformance fixture exists to prevent — so the
/// export must not become a second place a number can change.
#[test]
fn redaction_only_ever_removes() {
    let mut record = gg_record();
    record.code_analysis = Some(code_summary(vec![CodeLanguage::TypeScript]));
    let doc = build_run_doc(&record, &GgDocLifecycle::default());
    let public = redacted_for_public(&doc);

    assert!(public.fields.len() <= doc.fields.len());
    for (field, value) in &public.fields {
        assert_eq!(
            doc.get(field),
            Some(value),
            "{field} changed value on its way to the public export"
        );
    }
    // The fields that carry the corpus survive, including the whole code namespace —
    // publishing code metrics is the point of exporting at all.
    for field in [
        "id",
        "case",
        "model",
        "state",
        "metric.cost",
        "code.language",
        "code.size.codeLines",
        "has.codeAnalysis",
    ] {
        assert!(
            public.get(field).is_some(),
            "{field} is corpus, not disclosure, and must survive the export"
        );
    }
}
