use super::*;

use tempfile::TempDir;
use test_cabinet_core::gg::{GgCapabilitySet, GgSessionSummary, GgUndocumentedCalls};
use test_cabinet_core::gg_query::{
    GgAgg, GgAggFunc, GgGroupKey, GgQuery, GgStatsStage, GgValue, evaluate,
};
use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{DomainRating, Rating, ReviewVerdict, VerdictStatus};
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::ValidationSummary;

use crate::db::{Db, Reviewer, StoredReview};
use crate::store::{
    StoredBuild, StoredReference, StoredReviewItem, StoredSpec, StoredVariant, StoredWorkspace,
    StoredWorkspaceFile,
};

/// A gg run record: the smallest record that the document builder produces a
/// realistic document from — a capability set (so the total `cap.*` projection has
/// something to say) and a session summary (so `summary.*` is populated).
fn gg_record(id: &str, model: &str) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-17T20:40:00Z".to_string(),
        finished_at: "2026-06-17T21:30:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_core::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Gg,
            harness_version: Some("0.7.0".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            engine_slug: "none".to_string(),
            engine_version: None,
            model_id: model.to_string(),
            gg_capability_set: Some(GgCapabilitySet::minimal(model)),
            gg_summary: Some(GgSessionSummary {
                rejected_responses: Default::default(),
                max_response_chars: 0,
                max_response_output_tokens: 0,
                terminal_status: "completed".to_string(),
                undocumented_calls: GgUndocumentedCalls::default(),
                agents_spawned: 1,
                subagent_count: 0,
                max_subagent_depth: 0,
                compactions: 0,
                ran_out_of_context: false,
                context_overflow_count: 0,
                final_fullness: Some(0.4),
                issue_reviews: 0,
                review_cycles: 0,
                issues_reopened: 0,
                execution_mode: "tool_calling".to_string(),
                program_language: None,
                code_executions: 0,
                compile_ms: 0,
                errors: Default::default(),
                tool_calls: 0,
                provider_stats: Vec::new(),
                issues_created: 0,
                issues_completed: 0,
                slot_costs: Vec::new(),
                effective_tools: vec!["shell".to_string()],
                limits: Default::default(),
                limit_hit: None,
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
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
    }
}

/// A review from `account` giving `rating` to the `gameplay` domain, passing the
/// checklist items named in `passed` and failing the rest of [`manifest`]'s two.
fn review(account: &str, rating: Rating, passed: &[&str]) -> StoredReview {
    StoredReview {
        reviewer: Reviewer {
            user_id: account.to_string(),
            username: format!("{account}-handle"),
            display_name: format!("{account} Display"),
        },
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating,
        }],
        aesthetics: vec![],
        aesthetic: None,
        writeup: "Reviewed.".to_string(),
        checklist: ["heavy", "light"]
            .into_iter()
            .map(|id| ReviewVerdict {
                id: id.to_string(),
                status: if passed.contains(&id) {
                    VerdictStatus::Pass
                } else {
                    VerdictStatus::Fail
                },
                note: None,
            })
            .collect(),
        reviewed_at: "2026-06-17T22:00:00Z".to_string(),
        edited_at: None,
        revisions: Vec::new(),
    }
}

/// A weighted checklist item.
fn item(id: &str, weight: u32) -> StoredReviewItem {
    StoredReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        text: format!("The build satisfies {id}."),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight,
        graded: false,
        domain: Some("gameplay".to_string()),
        failure_cap: None,
        domains: vec![],
        sub_items: vec![],
        validation: None,
    }
}

/// The `pong@v1.0.0` manifest the runs above are launched against, carrying a
/// two-item checklist weighted 2 + 1 — so a review that passes only the heavy item
/// earns exactly two thirds and the score is unmistakably weight-derived rather than
/// a count of ticks.
fn manifest() -> StoredManifest {
    StoredManifest {
        toolchain: None,
        engine_format: false,
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: vec!["arcade".to_string()],
        summary: Some("A duel.".to_string()),
        description: None,
        changelog: "Introduced.".to_string(),
        max_runtime_seconds: 1800,
        test_type: test_cabinet_core::TestType::EndToEnd,
        engines: vec![test_cabinet_core::EngineSupport::unbounded(
            test_cabinet_core::engine::NONE_SLUG,
        )],
        experimental: false,
        build: Some(StoredBuild {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        cases: Vec::new(),
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: test_cabinet_core::AssetKind::Sprite,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        prompt_template: "build it".to_string(),
        common_specs: vec![StoredSpec {
            source: "specs/overview.hbs".to_string(),
            dest: "specs/overview.md".to_string(),
            template: true,
            kind: Default::default(),
        }],
        workspace: StoredWorkspace(std::collections::BTreeMap::from([(
            "none".to_string(),
            vec![StoredWorkspaceFile {
                source: "workspaces/base/package.json".to_string(),
                dest: "package.json".to_string(),
            }],
        )])),
        init: None,
        assets: vec![],
        packages: vec![],
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: None,
            specs: vec![],
            workspace: None,
            references: vec![],
            proofs: vec![],
            review_items: vec![],
            domains: vec![],
            voxel: None,
            showcase: None,
        }],
        common_references: vec![StoredReference {
            view: "gameplay".to_string(),
            kind: test_cabinet_core::ReferenceKind::Rendered,
            extension: "png".to_string(),
        }],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![item("heavy", 2), item("light", 1)],
        domains: vec![crate::store::StoredDomain {
            id: "gameplay".to_string(),
            name: "Gameplay".to_string(),
            description: "Core gameplay.".to_string(),
        }],
        instrumentation: None,
        errata: Vec::new(),
    }
}

/// A definition store holding [`manifest`], so [`CatalogScores`] resolves a real
/// weighted checklist rather than a stub.
fn ingested_store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path()).expect("open store");
    store.write_manifest(&manifest()).expect("write manifest");
    (dir, store)
}

/// The document for `id`, or `None` when the index does not hold one.
fn doc_of<'a>(docs: &'a [Arc<GgRunDoc>], id: &str) -> Option<&'a GgRunDoc> {
    docs.iter().map(Arc::as_ref).find(|doc| doc.id() == id)
}

#[tokio::test]
async fn a_review_added_after_indexing_changes_the_documents_score_rating_and_review_count() {
    // The reason the index reconciles on a *mutation* timestamp rather than on the
    // record's own finish time: reviewing a run rewrites what its document must say
    // and touches nothing on the record. Prove the whole chain — the store's stamp
    // moves, the reconcile notices, the score resolver re-reads the case's weights,
    // and the rebuilt document reports the new figures.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    // Zero TTL so every read reconciles; this test is about the reconcile, not about
    // how long its answer is cached.
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();

    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let doc = doc_of(&docs, "r1").expect("the pushed gg run is indexed");
    // An unreviewed run has no rating and no score at all — absent, not zero, so an
    // average over the corpus is taken across reviewed runs only.
    assert_eq!(doc.get("rating"), None);
    assert_eq!(doc.get("score"), None);
    assert_eq!(doc.get("reviewCount"), Some(&GgValue::Number(0.0)));

    // One review, passing both items: the whole checklist weight is earned.
    db.add_review(
        "r1",
        &review("u1", Rating::Great, &["heavy", "light"]),
        None,
        None,
    )
    .await
    .unwrap();
    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let doc = doc_of(&docs, "r1").expect("still indexed");
    assert_eq!(
        doc.get("rating"),
        Some(&GgValue::String("great".to_string()))
    );
    assert_eq!(doc.get("score"), Some(&GgValue::Number(1.0)));
    assert_eq!(doc.get("reviewCount"), Some(&GgValue::Number(1.0)));

    // A second reviewer fails the light item: the score is the mean earned weight
    // over the total (2.5 of 3), and the rating is the worst any reviewer gave.
    db.add_review("r1", &review("u2", Rating::Scuffed, &["heavy"]), None, None)
        .await
        .unwrap();
    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let doc = doc_of(&docs, "r1").expect("still indexed");
    assert_eq!(
        doc.get("rating"),
        Some(&GgValue::String("scuffed".to_string()))
    );
    let score = doc.get("score").and_then(GgValue::as_number).unwrap();
    assert!(
        (score - 2.5 / 3.0).abs() < 1e-9,
        "score should be the mean earned weight over the total, got {score}",
    );
    assert_eq!(doc.get("reviewCount"), Some(&GgValue::Number(2.0)));
}

/// **The hole in the per-id freshness rule, and the thing that closes it.**
///
/// A document's `score` is a fraction of the case manifest's checklist weights, and those
/// live in the definition store rather than on the `run` row. Re-ingesting a case with
/// different weights — or writing an erratum that excludes an item from scoring — changes
/// what every affected document must say while stamping no run at all, so the reconcile
/// sees nothing pending and serves the pre-change number indefinitely.
///
/// The first half of this asserts that hole exists, deliberately: it is the behaviour that
/// makes [`GgDocIndex::invalidate_all`] necessary rather than decorative, and a future
/// change that made the reconcile notice manifests on its own should fail here and be
/// re-read, not silently pass.
#[tokio::test]
async fn a_manifest_reweighting_is_invisible_until_the_index_is_invalidated() {
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    // One review earning the heavy item and failing the light one: 2 of 3.
    db.add_review("r1", &review("u1", Rating::Great, &["heavy"]), None, None)
        .await
        .unwrap();

    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let before = doc_of(&docs, "r1")
        .and_then(|doc| doc.get("score"))
        .and_then(GgValue::as_number)
        .expect("a reviewed run has a score");
    assert!((before - 2.0 / 3.0).abs() < 1e-9, "got {before}");

    // Re-ingest the case with the light item excluded from scoring — the denominator
    // drops to the heavy item alone, so the same review now earns everything. No `run`
    // row is written by this.
    let mut reweighted = manifest();
    reweighted.common_review_items = vec![item("heavy", 2)];
    store
        .write_manifest(&reweighted)
        .expect("re-write manifest");

    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let stale = doc_of(&docs, "r1")
        .and_then(|doc| doc.get("score"))
        .and_then(GgValue::as_number)
        .expect("still scored");
    assert!(
        (stale - before).abs() < 1e-9,
        "the per-id rule cannot see a manifest change; this must still be the old score",
    );

    // The ingest path's push. Now the whole ledger is rebuilt and the score moves.
    index.invalidate_all().await;
    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let after = doc_of(&docs, "r1")
        .and_then(|doc| doc.get("score"))
        .and_then(GgValue::as_number)
        .expect("still scored");
    assert!(
        (after - 1.0).abs() < 1e-9,
        "invalidating must re-resolve every score from the current manifest, got {after}",
    );
}

#[tokio::test]
async fn reconciling_reloads_only_the_runs_whose_mutation_stamp_moved() {
    // R14's steady state, stated as an assertion: the cost of a refresh is one narrow
    // projection plus a rebuild of *only* the changed rows. A full rebuild would pass
    // every other test in this file, so this is the one that pins the design.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    for id in ["r1", "r2", "r3"] {
        db.push(
            &gg_record(id, "mock/echo"),
            &RunLinks::default(),
            None,
            None,
        )
        .await
        .unwrap();
    }

    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    // The first reconcile is the cold one: every run is new.
    assert_eq!(delta.reloaded, 3);
    assert_eq!(delta.evicted, 0);
    assert_eq!(delta.documents, 3);

    // Nothing changed: the projection is read, nothing is loaded.
    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        delta,
        GgIndexDelta {
            reloaded: 0,
            evicted: 0,
            documents: 3
        }
    );

    // One run is reviewed: exactly that one is reloaded.
    db.add_review("r2", &review("u1", Rating::Great, &["heavy"]), None, None)
        .await
        .unwrap();
    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        delta,
        GgIndexDelta {
            reloaded: 1,
            evicted: 0,
            documents: 3
        }
    );

    // A deleted run leaves the index with no row to reconcile against, so it is
    // evicted — the case a finish-time watermark can never notice at all.
    db.delete_run("r3").await.unwrap();
    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        delta,
        GgIndexDelta {
            reloaded: 0,
            evicted: 1,
            documents: 2
        }
    );
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert!(doc_of(&docs, "r3").is_none(), "the deleted run is gone");
}

#[tokio::test]
async fn the_index_holds_only_gg_runs() {
    // The corpus is the gg population, not every run: a Claude run carries no
    // capability set and no session summary, so indexing it would put a document with
    // an all-absent `cap.*`/`summary.*` projection into every enablement rate's
    // denominator.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    db.push(
        &gg_record("gg1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    let mut other = gg_record("claude1", "claude-sonnet-4-5");
    other.subject.harness_slug = HarnessSlug::Claude;
    other.subject.gg_capability_set = None;
    other.subject.gg_summary = None;
    db.push(&other, &RunLinks::default(), None, None)
        .await
        .unwrap();

    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(docs.len(), 1);
    assert_eq!(docs[0].id(), "gg1");
}

#[tokio::test]
async fn a_group_by_over_the_index_returns_buckets_summing_to_the_total() {
    // The invariant every aggregate view reads its figures against: `totalRuns` is the
    // matched-document count and the buckets partition it. If a document could land in
    // two buckets, or in none, every percentage on the page would be wrong.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    for (id, model) in [
        ("r1", "mock/echo"),
        ("r2", "mock/echo"),
        ("r3", "anthropic/claude-opus-4"),
        ("r4", "openai/gpt-5"),
    ] {
        db.push(&gg_record(id, model), &RunLinks::default(), None, None)
            .await
            .unwrap();
    }

    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();

    let response = evaluate(
        &docs,
        &GgQuery {
            stats: Some(GgStatsStage {
                aggs: vec![GgAgg {
                    func: GgAggFunc::Count,
                    field: None,
                    alias: None,
                }],
                group_by: vec![GgGroupKey::Field {
                    field: "model".to_string(),
                }],
            }),
            ..GgQuery::default()
        },
    );

    assert_eq!(response.total_runs, 4);
    assert_eq!(response.buckets.len(), 3);
    let summed: u64 = response.buckets.iter().map(|bucket| bucket.n).sum();
    assert_eq!(
        summed, response.total_runs,
        "the buckets must partition the matched documents",
    );
}

#[tokio::test]
async fn a_run_of_an_uningested_case_indexes_with_no_score() {
    // The score is a fraction of the *case's* checklist weights, so a run whose case
    // the definition store has never seen has no denominator. It must index with the
    // field absent rather than fail the reconcile or store a misleading zero.
    let db = Db::connect_in_memory().await.unwrap();
    let dir = TempDir::new().unwrap();
    let store = DefinitionStore::open(dir.path()).unwrap();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    db.add_review("r1", &review("u1", Rating::Great, &["heavy"]), None, None)
        .await
        .unwrap();

    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let doc = doc_of(&docs, "r1").expect("indexed");
    assert_eq!(doc.get("score"), None);
    // The lifecycle facts that do not depend on the catalog still land.
    assert_eq!(
        doc.get("rating"),
        Some(&GgValue::String("great".to_string()))
    );
    assert_eq!(doc.get("reviewCount"), Some(&GgValue::Number(1.0)));
}

#[tokio::test]
async fn a_run_whose_record_no_longer_parses_is_tombstoned_not_retried_forever() {
    // A row written under an older, incompatible `RunRecord` schema is skipped by
    // every listing — so the index asks for it, gets nothing back, and would see the
    // id as *new* on the next reconcile and re-load it, forever. The tombstone is what
    // stops the steady state from carrying a permanent per-cycle re-read of every
    // unparseable run, and it must lift the moment the row is written again.
    use sea_orm::sea_query::Expr;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    use test_cabinet_entities::run;

    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    db.push(
        &gg_record("good", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    db.push(
        &gg_record("corrupt", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    run::Entity::update_many()
        .col_expr(
            run::Column::RecordJson,
            Expr::value(r#"{"id":"corrupt","schema":"not-a-run-record"}"#),
        )
        .filter(run::Column::Id.eq("corrupt"))
        .exec(&db.connection())
        .await
        .unwrap();

    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    // Both ids were asked for; only one produced a document.
    assert_eq!(delta.reloaded, 2);
    assert_eq!(delta.documents, 1);

    // The second pass costs nothing: the corrupt row is remembered at the stamp it
    // failed on rather than looking new again.
    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        delta,
        GgIndexDelta {
            reloaded: 0,
            evicted: 0,
            documents: 1
        }
    );

    // Re-pushing a parseable record stamps the row, which is what lifts the tombstone.
    db.push(
        &gg_record("corrupt", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    let mut scores = CatalogScores::new(&store);
    let delta = index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        delta,
        GgIndexDelta {
            reloaded: 1,
            evicted: 0,
            documents: 2
        }
    );
}

#[tokio::test]
async fn a_reconcile_within_the_ttl_is_skipped_and_serves_the_same_corpus() {
    // The whole point of the index: between refreshes a query costs one `Arc` clone
    // and touches the database not at all. Proven by mutating the store and observing
    // that the corpus does *not* move until the TTL is bypassed.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::from_secs(3600));

    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    let mut scores = CatalogScores::new(&store);
    let first = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(first.len(), 1);

    db.push(
        &gg_record("r2", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    let mut scores = CatalogScores::new(&store);
    let second = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        second.len(),
        1,
        "the new run is not visible until the TTL lapses"
    );
    assert!(
        Arc::ptr_eq(&first, &second),
        "an unchanged index hands out the same allocation rather than rebuilding",
    );
    assert_eq!(index.last_delta().await.reloaded, 1);

    // An explicit reconcile ignores the TTL, which is what a caller that has just
    // written a run reaches for.
    let mut scores = CatalogScores::new(&store);
    index
        .reconcile(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    let third = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(third.len(), 2);
}

// --- the public export ---------------------------------------------------------

#[tokio::test]
async fn the_public_export_is_decoupled_from_publication_but_not_from_the_catalog_gate() {
    // The two halves of owner decision Q1, together, because they are easy to state and
    // easy to get backwards. A gg document carries configuration ids and outcome
    // numbers, so **publication is not the gate** — almost no gg run is ever published
    // and gating on it would export an empty corpus. But the backend deliberately hides
    // experimental case versions, and exporting one's document would publish an
    // unreleased case's slug, its existence, its run count and its scores — so **the
    // catalog gate still applies**.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    // A second case, ingested and flagged experimental.
    let mut wip = manifest();
    wip.slug = "wip".to_string();
    wip.experimental = true;
    store.write_manifest(&wip).expect("write the wip manifest");

    // Neither run is published.
    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();
    let mut hidden = gg_record("r2", "mock/echo");
    hidden.subject.test_case_slug = "wip".to_string();
    db.push(&hidden, &RunLinks::default(), None, None)
        .await
        .unwrap();

    let documents = public_documents(&db, &store).await.unwrap();
    let ids: Vec<&str> = documents.iter().map(|doc| doc.id()).collect();
    assert_eq!(
        ids,
        vec!["r1"],
        "an unpublished run exports; an experimental case's run does not"
    );
    assert!(
        !documents
            .iter()
            .any(|doc| doc.get("case") == Some(&GgValue::String("wip".to_string()))),
        "the experimental case's very slug must not appear in the export"
    );
}

#[tokio::test]
async fn a_case_this_process_cannot_classify_is_withheld_from_the_export() {
    // The gate's direction of failure, which is the one thing about it that is a
    // judgement call. `DefinitionStore::is_experimental` fails **open** — an unreadable
    // manifest is a case the console still lists — and inheriting that here would mean
    // the export publishes exactly the versions it exists to withhold whenever the
    // definition store cannot answer.
    //
    // That is not a contrived state. In production the def store is an `emptyDir`
    // wiped on every restart while the snapshot's dirty flag is durable in Postgres, so
    // a refresh pending at the last restart runs against a store that knows about no
    // case at all — and every experimental version in the corpus would go to public R2.
    // An empty store here is that window, exactly.
    let db = Db::connect_in_memory().await.unwrap();
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path()).expect("open store");

    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();

    let documents = public_documents(&db, &store).await.unwrap();
    assert!(
        documents.is_empty(),
        "a run whose case manifest cannot be read is not publishable: {:?}",
        documents.iter().map(GgRunDoc::id).collect::<Vec<_>>(),
    );

    // And the withholding is the *store's* answer rather than a permanent verdict: the
    // same corpus exports the moment the case is ingested, which is what makes a cold
    // store a delay rather than data loss.
    store.write_manifest(&manifest()).expect("write manifest");
    let documents = public_documents(&db, &store).await.unwrap();
    assert_eq!(
        documents.iter().map(GgRunDoc::id).collect::<Vec<_>>(),
        vec!["r1"],
        "the next refresh after the store is back exports it",
    );
}

#[tokio::test]
async fn every_exported_document_is_redacted() {
    // Redaction is applied by the composer, not by the snapshot builder, so a second
    // exporter cannot forget it. Prove it end to end rather than by unit-testing
    // `redacted_for_public` twice: a capability parameter carrying pasted free text is
    // in the console's own document and out of the exported one.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();

    let mut record = gg_record("r1", "mock/echo");
    let pasted = "The player must be able to serve. ".repeat(30);
    if let Some(set) = record.subject.gg_capability_set.as_mut() {
        // The preset already declares `skills`; the *first* declaration is the one the
        // builder reads, so configure that one rather than appending a second.
        let agent = &mut set.agents[0];
        agent
            .capabilities
            .retain(|cfg| cfg.id != test_cabinet_core::gg::CAPABILITY_SKILLS);
        agent
            .capabilities
            .push(test_cabinet_core::gg::GgCapabilityConfig {
                id: test_cabinet_core::gg::CAPABILITY_SKILLS.to_string(),
                enabled: true,
                implementation: None,
                params: serde_json::json!({ "brief": pasted, "budget": 3 }),
            });
    }
    db.push(&record, &RunLinks::default(), None, None)
        .await
        .unwrap();

    // What the console serves.
    let index = GgDocIndex::with_ttl(Duration::ZERO);
    let mut scores = CatalogScores::new(&store);
    let console = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert!(
        doc_of(&console, "r1")
            .expect("the console's document")
            .get("cap.skills.brief")
            .is_some(),
        "the console keeps the parameter — redaction is the export's job",
    );

    // What the public site gets.
    let exported = public_documents(&db, &store).await.unwrap();
    let public = exported.first().expect("the exported document");
    assert!(public.get("cap.skills.brief").is_none());
    assert_eq!(public.get("cap.skills.budget"), Some(&GgValue::Number(3.0)));
    assert_eq!(
        public.get("case"),
        Some(&GgValue::String("pong".to_string())),
        "everything else is untouched",
    );
}

#[tokio::test]
async fn the_export_is_documents_and_never_a_replay_record() {
    // Owner decision Q1, as a regression rather than a comment. A gg document is a flat
    // map of scalars — configuration ids and outcome numbers. A **session record** is the
    // complete model conversation verbatim, and it lives in this very store, one call
    // away from the composer. The distinction is the whole reason the corpus is
    // publishable at all, and folding a record in would be a small, plausible-looking
    // change that nothing else would notice.
    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    // The record exists for this run, so this asserts a choice rather than an absence of
    // data.
    store
        .write_run_artifact(
            "r1",
            "replay",
            br#"{"messages":[{"role":"user","text":"the-verbatim-conversation"}]}"#,
        )
        .expect("store the run's session record");
    db.push(
        &gg_record("r1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();

    let documents = public_documents(&db, &store).await.unwrap();
    let json = serde_json::to_string(&documents).unwrap();
    assert!(
        !json.contains("the-verbatim-conversation"),
        "the export carried recorded conversation text",
    );

    for doc in &documents {
        for (field, value) in &doc.fields {
            // A scalar map is the whole shape: nothing nested — a message list, a pool,
            // a blob — has anywhere to ride.
            assert!(
                matches!(
                    value,
                    GgValue::Bool(_) | GgValue::Number(_) | GgValue::String(_)
                ),
                "{field} is not a scalar",
            );
            // `cap.replay` is a legitimate field (the capability's enablement flag), so
            // the assertion is on the *conversation* vocabulary rather than on the word
            // "replay": no document namespace carries messages, pools or blobs.
            for forbidden in ["message", "conversation", "blob", "toolset", "transcript"] {
                assert!(
                    !field.to_ascii_lowercase().contains(forbidden),
                    "{field} looks like recorded conversation, not a document field",
                );
            }
        }
    }
}

#[tokio::test]
async fn the_reconcile_builds_stats_facts_beside_the_documents() {
    // The one parse pass feeds two consumers: prove that the facts corpus is
    // reconciled on the same terms as the documents, that a new-format run's
    // provider slices and dispatch total arrive intact, and that an old-format
    // run is present with neither — absent, not defaulted — so the `/stats`
    // folds can tell the two apart end to end.
    use test_cabinet_core::gg::GgProviderStat;

    use crate::stats::{fold_model_accuracy, fold_provider_stats};

    let db = Db::connect_in_memory().await.unwrap();
    let (_dir, store) = ingested_store();
    let index = GgDocIndex::with_ttl(Duration::ZERO);

    // A new-format responses-as-code run: one provider slice, exact turn
    // accounting.
    let mut new_format = gg_record("new1", "mock/echo");
    {
        let summary = new_format.subject.gg_summary.as_mut().unwrap();
        summary.execution_mode = "responses_as_code".to_string();
        summary.errors.turns = 3;
        summary.errors.errors = 1;
        summary.errors.transpile = 1;
        summary.provider_stats = vec![GgProviderStat {
            provider: Some("acme".to_string()),
            model_id: Some("mock/echo".to_string()),
            calls: 3,
            turns: 3,
            working: 2,
            errors: [("transpile_compile".to_string(), 1)].into_iter().collect(),
            ..GgProviderStat::default()
        }];
    }
    db.push(&new_format, &RunLinks::default(), None, None)
        .await
        .unwrap();

    // An old-format tool-calling run: the fixture default — no slices, no
    // dispatch total.
    db.push(
        &gg_record("old1", "mock/echo"),
        &RunLinks::default(),
        None,
        None,
    )
    .await
    .unwrap();

    let mut scores = CatalogScores::new(&store);
    let facts = index
        .facts(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(
        facts.len(),
        2,
        "both runs carry a summary, so both have facts"
    );

    let (scanned, with_data, providers) = fold_provider_stats(&facts);
    assert_eq!(scanned, 2);
    assert_eq!(with_data, 1, "only the new-format run recorded providers");
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0].provider.as_deref(), Some("acme"));
    assert_eq!(providers[0].totals.calls, 3);
    assert_eq!(providers[0].totals.working, 2);

    let accuracy = fold_model_accuracy(&facts);
    assert_eq!(accuracy.unattributable_runs, 0);
    assert_eq!(accuracy.models.len(), 1);
    let entry = &accuracy.models[0];
    assert_eq!(entry.model_id, "mock/echo");
    let rac = entry
        .rac
        .as_ref()
        .expect("the new-format run's rac figures");
    assert_eq!((rac.turns, rac.valid, rac.compile), (3, 2, 1));
    assert_eq!(rac.approximate_runs, 0);
    assert!(
        entry.tool_calling.is_none(),
        "the old run recorded no dispatch total and no failures, so nothing is invented"
    );

    // The documents corpus is untouched by the second consumer.
    let mut scores = CatalogScores::new(&store);
    let docs = index
        .documents(&db, &mut |run| scores.score(run))
        .await
        .unwrap();
    assert_eq!(docs.len(), 2);
}
