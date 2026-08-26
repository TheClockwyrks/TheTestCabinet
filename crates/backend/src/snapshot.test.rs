use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use test_cabinet_core::MediaKind;
use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{DomainRating, Rating};
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::{
    AssetFrameResult, AssetGenResult, DebugScriptOutput, DebugScriptResult, ProofResult,
    ValidationSummary,
};

use crate::db::StoredReview;
use crate::store::{
    StoredBuild, StoredCheck, StoredManifest, StoredReference, StoredShowcase, StoredShowcaseMedia,
    StoredVariant, StoredWorkspace, StoredWorkspaceFile,
};

/// The per-run document object for `run_id`.
///
/// Located by the run's `documents/runs/<id>/` prefix rather than a composed path:
/// the key's last segment is a digest of the document's own bytes, so it is not
/// predictable from the test's inputs.
fn run_document<'a>(snapshot: &'a Snapshot, run_id: &str) -> &'a SnapshotObject {
    let prefix = format!("{RUN_DOCUMENT_PREFIX}/{run_id}/");
    snapshot
        .objects
        .iter()
        .find(|object| object.key.starts_with(&prefix))
        .unwrap_or_else(|| panic!("a document object for run {run_id}"))
}

/// The parsed per-run document for `run_id`.
fn run_document_json(snapshot: &Snapshot, run_id: &str) -> serde_json::Value {
    serde_json::from_slice(&run_document(snapshot, run_id).bytes)
        .expect("the run document is valid JSON")
}

/// The parsed `runs.json` summary index.
fn runs_index(snapshot: &Snapshot) -> serde_json::Value {
    let key = format!("snapshots/{}/runs.json", snapshot.snapshot_id);
    let object = snapshot
        .objects
        .iter()
        .find(|object| object.key == key)
        .expect("runs.json present");
    serde_json::from_slice(&object.bytes).expect("runs.json is valid JSON")
}

/// An empty definition store rooted at a fresh temp dir. The `TempDir` is
/// returned so the caller keeps it alive for the test's duration.
fn empty_store() -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path()).expect("open store");
    (dir, store)
}

fn stored_run(id: &str, published_at: &str) -> StoredRun {
    StoredRun {
        record: RunRecord {
            id: id.to_string(),
            started_at: "2026-06-17T20:40:00Z".to_string(),
            finished_at: "2026-06-17T21:30:00Z".to_string(),
            subject: RunSubject {
                test_case_slug: "pong".to_string(),
                test_case_version: "v1.0.0".to_string(),
                test_type: test_cabinet_core::TestType::EndToEnd,
                variant: "base".to_string(),
                harness_slug: HarnessSlug::Claude,
                harness_version: Some("1.2.3".to_string()),
                orchestrator_slug: "one-shot".to_string(),
                engine_slug: "none".to_string(),
                engine_version: None,
                model_id: "claude-sonnet-4-5".to_string(),
                gg_capability_set: None,
                gg_summary: None,
            },
            tooling: RunTooling::default(),
            environment: RunEnvironment {
                os: "Debian".to_string(),
                container_image: "test-cabinet/claude:abcd".to_string(),
                node_version: None,
                auth_mode: test_cabinet_core::AuthMode::ApiKey,
            },
            metrics: RunMetrics::default(),
            validation: ValidationSummary {
                debug_scripts: Vec::new(),
                loaded: true,
                ..ValidationSummary::default()
            },
            links: RunLinks {
                source_repo: Some("https://github.com/x/y".to_string()),
                playable_build: Some("https://abc.pages.dev".to_string()),
            },
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
        },
        reviews: vec![StoredReview {
            reviewer: crate::db::Reviewer {
                user_id: "u1".to_string(),
                username: "ada".to_string(),
                display_name: "Ada L.".to_string(),
            },
            ratings: vec![DomainRating {
                domain: "gameplay".to_string(),
                rating: Rating::Great,
            }],
            aesthetics: vec![],
            writeup: "Plays well.".to_string(),
            checklist: vec![],
            reviewed_at: "2026-06-17T22:00:00Z".to_string(),
            edited_at: None,
            revisions: Vec::new(),
        }],
        rating: None,
        aesthetic: None,
        validator_rated: false,
        links: RunLinks {
            source_repo: Some("https://github.com/x/y".to_string()),
            playable_build: Some("https://abc.pages.dev".to_string()),
        },
        published: true,
        published_at: Some(published_at.to_string()),
        events_json: None,
    }
}

/// An asset-generation variant of [`stored_run`]: its `validation.asset` is
/// populated so the snapshot exports the run's media.
fn asset_run(id: &str, published_at: &str) -> StoredRun {
    let mut run = stored_run(id, published_at);
    run.record.subject.test_type = test_cabinet_core::TestType::AssetGeneration;
    run.record.validation.asset = Some(AssetGenResult {
        frames: vec![AssetFrameResult {
            index: 0,
            regenerated_image: "regenerated.png".to_string(),
            preview_image: "preview.png".to_string(),
            actions_log: "actions.json".to_string(),
            operation_count: 3,
            cheat_divergence: Some(0.05),
            detail: None,
        }],
        sheet: None,
        detail: None,
    });
    run
}

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
        description: Some("## Carom".to_string()),
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
        common_specs: vec![],
        workspace: Default::default(),
        init: None,
        assets: vec![],
        packages: vec![],
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: Some("Standard".to_string()),
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
        checks: vec![StoredCheck {
            view: "title".to_string(),
            name: "Title".to_string(),
            reference_view: "title".to_string(),
            actions: vec![],
        }],
        common_review_items: vec![],
        domains: vec![crate::store::StoredDomain {
            id: "gameplay".to_string(),
            name: "Gameplay".to_string(),
            description: "Core gameplay.".to_string(),
        }],
        instrumentation: None,
        errata: Vec::new(),
    }
}

fn now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_718_660_880).unwrap()
}

#[test]
fn run_summary_from_stored_maps_fields_without_a_catalog() {
    // A reviewed run: the aggregate rating is the worst across its reviews (here a
    // single `Great`), the test type is carried through, and `case_name` falls
    // back to the slug because `from_stored` never consults the case catalog.
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    // Add a harsher domain rating so the aggregate is the worst of the two.
    run.reviews[0].ratings.push(DomainRating {
        domain: "polish".to_string(),
        rating: Rating::Scuffed,
    });
    let summary = RunSummary::from_stored(&run);
    assert_eq!(summary.id, "r1");
    assert_eq!(summary.case_name, "pong"); // slug fallback, not a catalog name
    assert_eq!(
        summary.subject.test_type,
        test_cabinet_core::TestType::EndToEnd
    );
    assert_eq!(summary.subject.test_case_slug, "pong");
    assert_eq!(summary.review_count, 1);
    assert!(summary.validation_loaded);
    assert_eq!(summary.rating, Some(Rating::Scuffed)); // worst across the two domains
    // A non-performance run carries no performance result on its card.
    assert!(summary.performance.is_none());

    // An unrated run (no reviews) carries a `None` rating — the whole point of the
    // field being optional for console runs.
    let mut unrated = stored_run("r2", "2026-06-17T21:41:00Z");
    unrated.reviews.clear();
    let summary = RunSummary::from_stored(&unrated);
    assert_eq!(summary.rating, None);
    assert_eq!(summary.review_count, 0);
}

#[test]
fn run_summary_lifts_the_gg_configuration_name_onto_the_card() {
    use test_cabinet_core::gg::GgCapabilitySet;

    // A third-party-harness run has no capability set at all, so its card names no
    // configuration and the run log falls back to showing its model.
    let plain = stored_run("r1", "2026-06-17T21:40:00Z");
    assert_eq!(RunSummary::from_stored(&plain).subject.gg_preset, None);

    // A gg run launched from a named configuration: the name rides on the card so
    // the run log can identify the row without loading the whole record (a gg run
    // has no single harness model to name it by).
    let mut named = stored_run("r2", "2026-06-17T21:41:00Z");
    named.record.subject.harness_slug = HarnessSlug::Gg;
    named.record.subject.gg_capability_set = Some(GgCapabilitySet {
        preset: Some("planning-A".to_string()),
        ..GgCapabilitySet::default()
    });
    assert_eq!(
        RunSummary::from_stored(&named).subject.gg_preset.as_deref(),
        Some("planning-A")
    );

    // A gg run assembled by hand records no preset; the card carries none rather
    // than inventing one, and the run log falls back to the model.
    let mut hand_assembled = stored_run("r3", "2026-06-17T21:42:00Z");
    hand_assembled.record.subject.harness_slug = HarnessSlug::Gg;
    hand_assembled.record.subject.gg_capability_set = Some(GgCapabilitySet::default());
    assert_eq!(
        RunSummary::from_stored(&hand_assembled).subject.gg_preset,
        None
    );
}

#[test]
fn run_summary_lifts_performance_fuel_for_the_leaderboard() {
    use test_cabinet_core::validation::PerformanceResult;

    // A correct performance run: the card carries the correctness gate and the
    // comparable total fuel, so a fuel leaderboard can rank it from the summary
    // set alone (no full record loaded).
    let mut correct = stored_run("p1", "2026-06-17T21:40:00Z");
    correct.record.subject.test_type = test_cabinet_core::TestType::Performance;
    correct.record.validation.performance = Some(PerformanceResult {
        correct: true,
        total_fuel: Some(1_234_567),
        fuel_limit: Some(5_000_000_000),
        cases: vec![],
        module_wasm: None,
        detail: None,
    });
    let summary = RunSummary::from_stored(&correct);
    let perf = summary.performance.expect("performance card is lifted");
    assert!(perf.correct);
    assert_eq!(perf.total_fuel, Some(1_234_567));

    // An incorrect run earns no fuel score: the gate is recorded but the total is
    // `None`, so it takes no leaderboard placement.
    let mut wrong = stored_run("p2", "2026-06-17T21:41:00Z");
    wrong.record.subject.test_type = test_cabinet_core::TestType::Performance;
    wrong.record.validation.performance = Some(PerformanceResult {
        correct: false,
        total_fuel: None,
        fuel_limit: Some(5_000_000_000),
        cases: vec![],
        module_wasm: None,
        detail: None,
    });
    let summary = RunSummary::from_stored(&wrong);
    let perf = summary.performance.expect("performance card is lifted");
    assert!(!perf.correct);
    assert_eq!(perf.total_fuel, None);
}

#[tokio::test]
async fn snapshot_has_index_runs_per_run_and_case_objects() {
    let runs = vec![stored_run("r1", "2026-06-17T21:40:00Z")];
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(runs, vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    assert_eq!(snapshot.run_count, 1);
    assert_eq!(snapshot.index.key, "index.json");

    let keys: Vec<&str> = snapshot.objects.iter().map(|o| o.key.as_str()).collect();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    assert!(keys.contains(&format!("{prefix}/runs.json").as_str()));
    assert!(keys.contains(&format!("{prefix}/cases/pong/v1.0.0.json").as_str()));
    // The per-run document lives outside the generation prefix, content-addressed by
    // run id, and the summary index names it.
    assert!(
        keys.iter()
            .any(|key| key.starts_with(&format!("{RUN_DOCUMENT_PREFIX}/r1/"))),
    );
    assert_eq!(
        runs_index(&snapshot)["runs"][0]["documentKey"],
        run_document(&snapshot, "r1").key,
    );
    // An empty catalog still emits a well-formed models.json.
    assert!(keys.contains(&format!("{prefix}/models.json").as_str()));
}

#[tokio::test]
async fn snapshot_emits_the_composed_model_catalog() {
    use crate::api::{AliasOut, ModelOut};
    use test_cabinet_core::run_record::HarnessFamily;

    let (_tmp, store) = empty_store();
    let model = ModelOut {
        slug: "opus".to_string(),
        name: "Claude Opus 4.8".to_string(),
        provider: "Anthropic".to_string(),
        curated: true,
        openrouter_url: Some("https://openrouter.ai/anthropic/claude-opus-4.8".to_string()),
        description: None,
        logo_svg: None,
        covered_model_ids: vec![],
        aliases: vec![AliasOut {
            slug: "anthropic/claude-opus-4.8".to_string(),
            harness_family: HarnessFamily::Openrouter,
        }],
        price: None,
        price_history: vec![],
        context_length: None,
        released_at: None,
        input_modalities: vec![],
    };
    let snapshot = SnapshotBuilder::new(vec![], vec![], store)
        .with_models(vec![model])
        .build(now())
        .await
        .unwrap();

    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let models = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/models.json"))
        .expect("models.json present");
    let body: serde_json::Value = serde_json::from_slice(&models.bytes).unwrap();
    assert_eq!(body["models"][0]["name"], "Claude Opus 4.8");
    assert_eq!(body["models"][0]["curated"], true);
    // The index points at the catalog file.
    let index: serde_json::Value = serde_json::from_slice(&snapshot.index.bytes).unwrap();
    assert_eq!(index["modelsKey"], format!("{prefix}/models.json"));
}

#[tokio::test]
async fn snapshot_emits_the_test_case_group_set() {
    let (_tmp, store) = empty_store();
    let group = crate::api::TestCaseGroupOut {
        slug: "tower-defense".to_string(),
        name: "Tower Defense".to_string(),
        summary: Some("Mazes and waves.".to_string()),
        cases: vec!["meltdown".to_string(), "valence".to_string()],
    };
    let snapshot = SnapshotBuilder::new(vec![], vec![], store)
        .with_test_case_groups(vec![group])
        .build(now())
        .await
        .unwrap();

    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let groups = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/test-case-groups.json"))
        .expect("test-case-groups.json present");
    let body: serde_json::Value = serde_json::from_slice(&groups.bytes).unwrap();
    assert_eq!(body["groups"][0]["slug"], "tower-defense");
    assert_eq!(body["groups"][0]["cases"][1], "valence");
    // The index names the file under its optional key (absent only on snapshots
    // written before groups existed).
    let index: serde_json::Value = serde_json::from_slice(&snapshot.index.bytes).unwrap();
    assert_eq!(
        index["testCaseGroupsKey"],
        format!("{prefix}/test-case-groups.json")
    );
}

#[tokio::test]
async fn index_points_at_the_versioned_prefix() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![],
        store,
    )
    .build(now())
    .await
    .unwrap();
    let index: serde_json::Value = serde_json::from_slice(&snapshot.index.bytes).unwrap();
    assert_eq!(index["schemaVersion"], 2);
    assert_eq!(index["runCount"], 1);
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    assert_eq!(index["runsKey"], format!("{prefix}/runs.json"));
    assert_eq!(index["casesPrefix"], format!("{prefix}/cases/"));
    // The run documents are shared across generations, so their prefix is not the
    // generation's.
    assert_eq!(
        index["runDocumentsPrefix"],
        format!("{RUN_DOCUMENT_PREFIX}/"),
    );
}

#[tokio::test]
async fn run_summary_carries_denormalized_case_name_and_camelcase_fields() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();

    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let runs_obj = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&runs_obj.bytes).unwrap();
    let summary = &parsed["runs"][0];
    assert_eq!(summary["caseName"], "Carom");
    assert_eq!(summary["publishedAt"], "2026-06-17T21:40:00Z");
    assert_eq!(summary["validationLoaded"], true);
    assert_eq!(summary["rating"], "great");
    assert_eq!(summary["reviewCount"], 1);
    assert_eq!(summary["subject"]["harnessSlug"], "claude");
    assert_eq!(summary["links"]["playableBuild"], "https://abc.pages.dev");
}

#[tokio::test]
async fn per_run_file_embeds_full_record_review_and_links() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();
    let parsed = run_document_json(&snapshot, "r1");
    assert_eq!(parsed["record"]["id"], "r1");
    assert_eq!(
        parsed["record"]["links"]["playableBuild"],
        "https://abc.pages.dev"
    );
    assert_eq!(parsed["reviews"][0]["ratings"][0]["domain"], "gameplay");
    assert_eq!(parsed["reviews"][0]["ratings"][0]["rating"], "great");
    assert_eq!(parsed["reviews"][0]["writeup"], "Plays well.");
    assert_eq!(parsed["reviews"][0]["reviewer"], "Ada L.");
    assert_eq!(parsed["reviews"][0]["reviewerId"], "u1");
}

#[tokio::test]
async fn reviewer_picture_is_exported_and_named_by_key_on_the_review() {
    let (_tmp, store) = empty_store();
    // The run's sole review is by `u1`; supply that reviewer's picture.
    let mut pictures = std::collections::HashMap::new();
    pictures.insert(
        "u1".to_string(),
        test_cabinet_core::accounts::ReviewerPicture {
            bytes: vec![1, 2, 3, 4],
            content_type: "image/webp".to_string(),
        },
    );
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .with_reviewer_pictures(pictures)
    .build(now())
    .await
    .unwrap();

    // The picture rides under the content-stable top-level `pfp/` prefix (not the
    // snapshot's own prefix), keyed by reviewer id, with its content type.
    let pfp = snapshot
        .objects
        .iter()
        .find(|o| o.key == "pfp/u1")
        .expect("the reviewer's picture object");
    assert_eq!(pfp.bytes, vec![1, 2, 3, 4]);
    assert_eq!(pfp.content_type, "image/webp");

    // The review points at it by that key.
    let parsed = run_document_json(&snapshot, "r1");
    assert_eq!(parsed["reviews"][0]["pictureKey"], "pfp/u1");
}

#[tokio::test]
async fn without_a_reviewer_picture_no_pfp_object_and_no_key() {
    let (_tmp, store) = empty_store();
    // No `with_reviewer_pictures`: the reviewer has no picture in this snapshot.
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();

    assert!(!snapshot.objects.iter().any(|o| o.key.starts_with("pfp/")));
    let parsed = run_document_json(&snapshot, "r1");
    // The optional key is omitted (skip_serializing_if) when absent.
    assert!(parsed["reviews"][0].get("pictureKey").is_none());
}

#[tokio::test]
async fn per_run_file_includes_events_when_present_and_omits_them_when_absent() {
    let (_tmp, store) = empty_store();
    let mut with_events = stored_run("r1", "2026-06-17T21:40:00Z");
    with_events.events_json =
        Some(r#"[{"timestamp":"2026-06-17T20:41:00Z","type":"agent","message":"hi"}]"#.to_string());
    let without_events = stored_run("r2", "2026-06-17T21:41:00Z");
    let snapshot = SnapshotBuilder::new(vec![with_events, without_events], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();
    // The recorded event stream is re-emitted verbatim into the per-run file.
    let r1 = run_document_json(&snapshot, "r1");
    assert_eq!(r1["events"][0]["type"], "agent");
    assert_eq!(r1["events"][0]["message"], "hi");

    // A run that captured no events omits the field entirely.
    let r2 = run_document_json(&snapshot, "r2");
    assert!(r2.get("events").is_none());
}

#[tokio::test]
async fn per_run_file_exports_asset_media_and_names_it_by_key() {
    let (_tmp, store) = empty_store();
    // Stage the asset media the run uploaded; one of the three (preview.png) is
    // deliberately absent to prove a missing file is skipped, not fatal.
    store
        .write_run_asset("a1", "regenerated.png", b"png:regen")
        .unwrap();
    store.write_run_asset("a1", "actions.json", b"[]").unwrap();

    let snapshot = SnapshotBuilder::new(
        vec![asset_run("a1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();

    // The staged bytes are exported under the run's content-stable media prefix
    // (NOT this snapshot's prefix) with a content type that follows the extension.
    let regen_key = "media/runs/a1/asset/regenerated.png".to_string();
    let regen = snapshot
        .objects
        .iter()
        .find(|o| o.key == regen_key)
        .expect("regenerated image exported");
    assert_eq!(regen.content_type, "image/png");
    assert_eq!(regen.bytes, b"png:regen");
    let actions = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/a1/asset/actions.json")
        .expect("action log exported");
    assert_eq!(actions.content_type, "application/json");

    // The per-run document names each present file by its served name + key; the
    // missing preview.png is omitted.
    let parsed = run_document_json(&snapshot, "a1");
    let media = parsed["assetMedia"].as_array().unwrap();
    let files: Vec<&str> = media.iter().map(|m| m["file"].as_str().unwrap()).collect();
    assert_eq!(files, vec!["regenerated.png", "actions.json"]);
    let regen_meta = media
        .iter()
        .find(|m| m["file"] == "regenerated.png")
        .unwrap();
    assert_eq!(regen_meta["key"], regen_key);
}

#[tokio::test]
async fn per_run_file_omits_asset_media_for_a_non_asset_run() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();
    let parsed = run_document_json(&snapshot, "r1");
    // An end-to-end run carries an empty assetMedia list and exports no asset objects.
    assert_eq!(parsed["assetMedia"].as_array().unwrap().len(), 0);
    assert!(!snapshot.objects.iter().any(|o| o.key.contains("/asset/")));
}

#[tokio::test]
async fn per_run_file_exports_showcase_media_and_names_it_by_key() {
    let (_tmp, store) = empty_store();
    // The store holds the whole mirrored directory: the carousel entry, the
    // description file, and an image the description references that the carousel
    // does NOT list — which must still publish, or the description renders broken.
    store
        .write_run_showcase("s1", "title.png", b"png:title")
        .unwrap();
    store
        .write_run_showcase("s1", "showcase.md", b"# My Game\n![B](banner.png)")
        .unwrap();
    store
        .write_run_showcase("s1", "banner.png", b"png:banner")
        .unwrap();

    let mut run = stored_run("s1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game\n![B](banner.png)".to_string(),
        media: vec![test_cabinet_core::ShowcaseMedia {
            file: "title.png".to_string(),
            name: "Title".to_string(),
            kind: MediaKind::Image,
        }],
    });
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    // Every stored file is exported under the run's content-stable media prefix
    // (NOT this snapshot's prefix) with a content type that follows the extension.
    let title_key = "media/runs/s1/showcase/title.png".to_string();
    let title = snapshot
        .objects
        .iter()
        .find(|o| o.key == title_key)
        .expect("carousel image exported");
    assert_eq!(title.content_type, "image/png");
    assert_eq!(title.bytes, b"png:title");
    let banner = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/s1/showcase/banner.png")
        .expect("description-referenced image exported even when not in the carousel");
    assert_eq!(banner.bytes, b"png:banner");

    // The per-run document names each file by its recorded name + key; the store
    // listing is sorted, so the set is stable.
    let parsed = run_document_json(&snapshot, "s1");
    let media = parsed["showcaseMedia"].as_array().unwrap();
    let files: Vec<&str> = media.iter().map(|m| m["file"].as_str().unwrap()).collect();
    assert_eq!(files, vec!["banner.png", "showcase.md", "title.png"]);
    let title_meta = media.iter().find(|m| m["file"] == "title.png").unwrap();
    assert_eq!(title_meta["key"], title_key);
}

#[tokio::test]
async fn per_run_file_omits_showcase_media_when_the_record_carries_none() {
    let (_tmp, store) = empty_store();
    // Bytes sitting in the store without a captured showcase on the record are not
    // published: the record decides, exactly as it does for code analysis.
    store
        .write_run_showcase("s1", "title.png", b"png:title")
        .unwrap();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("s1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();
    let parsed = run_document_json(&snapshot, "s1");
    assert_eq!(parsed["showcaseMedia"].as_array().unwrap().len(), 0);
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.contains("/showcase/"))
    );
}

#[tokio::test]
async fn showcase_video_recorded_as_webm_is_transcoded_to_mp4() {
    // A `.webm` carousel clip publishes as an iOS-playable `.mp4` under the mp4
    // key, while the per-run doc keeps the recorded `.webm` name the UI requests —
    // the validation-media convention.
    let Some(webm) = make_test_webm() else {
        eprintln!("skipping: ffmpeg/libvpx unavailable");
        return;
    };
    let (_tmp, store) = empty_store();
    store.write_run_showcase("s1", "clip.webm", &webm).unwrap();

    let mut run = stored_run("s1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game".to_string(),
        media: vec![test_cabinet_core::ShowcaseMedia {
            file: "clip.webm".to_string(),
            name: "Gameplay".to_string(),
            kind: MediaKind::Video,
        }],
    });
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.ends_with("/clip.webm")),
        "the raw showcase webm must not be published",
    );
    let clip = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/s1/showcase/clip.mp4")
        .expect("showcase video published as mp4");
    assert_eq!(clip.content_type, "video/mp4");

    let parsed = run_document_json(&snapshot, "s1");
    let media = parsed["showcaseMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "clip.webm");
    assert_eq!(media[0]["key"], "media/runs/s1/showcase/clip.mp4");
}

#[tokio::test]
async fn existing_showcase_media_is_referenced_without_rereading_the_store() {
    // A key already in the bucket is referenced without touching the source bytes:
    // stage NO bytes in the store, hand the builder the key as already-existing, and
    // the meta still names it.
    let (_tmp, store) = empty_store();
    let mut run = stored_run("s1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game".to_string(),
        media: vec![test_cabinet_core::ShowcaseMedia {
            file: "title.png".to_string(),
            name: "Title".to_string(),
            kind: MediaKind::Image,
        }],
    });
    let key = "media/runs/s1/showcase/title.png".to_string();
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_existing_media(std::collections::HashSet::from([key.clone()]))
        .build(now())
        .await
        .unwrap();

    assert!(
        !snapshot.objects.iter().any(|o| o.key == key),
        "an existing showcase key must not be re-uploaded",
    );
    let parsed = run_document_json(&snapshot, "s1");
    let media = parsed["showcaseMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "title.png");
    assert_eq!(media[0]["key"], key);
}

#[tokio::test]
async fn showcase_description_image_survives_a_wiped_store_via_the_record() {
    // The backend store is ephemeral, and an image the description references
    // without listing in the carousel is named nowhere else on the record — the
    // builder must extract its name from the description text or a store loss
    // silently breaks the published page's image forever (the write-once media
    // convention never heals it). Stage NOTHING in the store and hand the image's
    // key as already-in-bucket: the meta naming it proves the extracted name
    // reached the lookup.
    let (_tmp, store) = empty_store();
    let mut run = stored_run("s1", "2026-06-17T21:40:00Z");
    run.record.showcase = Some(test_cabinet_core::RunShowcase {
        description: "# My Game\n![B](banner.png)".to_string(),
        media: vec![],
    });
    let key = "media/runs/s1/showcase/banner.png".to_string();
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_existing_media(std::collections::HashSet::from([key.clone()]))
        .build(now())
        .await
        .unwrap();

    let parsed = run_document_json(&snapshot, "s1");
    let media = parsed["showcaseMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "banner.png");
    assert_eq!(media[0]["key"], key);
}

#[test]
fn description_image_references_extracts_only_flat_relative_names() {
    // Bare relative names come back (percent-escapes decoded, angle-bracketed
    // and titled destinations handled, duplicates folded); everything the
    // renderer would not resolve against the showcase — absolute, anchored,
    // schemed — and every name the flat namespace refuses is skipped.
    let description = "\
# My Game\n\
![Banner](banner.png)\n\
![Same again](banner.png)\n\
![Encoded](my%20shot.png)\n\
![Bracketed](<two words.png> \"With a title\")\n\
![Titled](titled.png \"The title\")\n\
![Absolute](/logo.png)\n\
![Anchor](#top)\n\
![External](https://example.com/x.png)\n\
![Data](data:image/png;base64,AAAA)\n\
![Traversal](../escape.png)\n\
![Dotted](shot..final.png)\n\
![Manifest](showcase.toml)\n";
    assert_eq!(
        description_image_references(description),
        vec!["banner.png", "my shot.png", "two words.png", "titled.png"],
    );
}

#[tokio::test]
async fn case_metadata_inlines_specs_and_description() {
    // A case with a common spec (`spec/rules.md`, seeded into every variant) and a
    // variant-scoped one (`spec/base.md` on `base`). Write their source bytes into
    // the store so the snapshot can inline them.
    let mut m = manifest();
    m.common_specs = vec![crate::store::StoredSpec {
        source: "spec/rules.md".to_string(),
        dest: "spec/rules.md".to_string(),
        template: false,
        kind: Default::default(),
    }];
    m.variants[0].specs = vec![crate::store::StoredSpec {
        source: "spec/build.py".to_string(),
        dest: "build.py".to_string(),
        template: false,
        kind: test_cabinet_core::SpecKind::Script,
    }];
    // A declared runtime package: its UI-only description is looked up from core's
    // registry at snapshot time (never stored), so the static gallery's Inputs tab
    // can show it.
    m.packages = vec!["@test-cabinet/particle-runtime".to_string()];

    let (_tmp, store) = empty_store();
    for (key, body) in [("spec/rules.md", "# Rules"), ("spec/build.py", "# build")] {
        let path = store.version_dir(&m.slug, &m.version).join(key);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, body).unwrap();
    }

    // The case is only emitted when a published run built it.
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert_eq!(parsed["name"], "Carom");
    assert_eq!(parsed["description"], "## Carom");
    // The type discriminators are carried so the static gallery can scope its
    // catalog tabs; previously absent, which left every case reading as
    // end-to-end on the site.
    assert_eq!(parsed["testType"], "end-to-end");
    assert_eq!(parsed["assetKind"], "sprite");
    assert_eq!(parsed["variants"][0]["slug"], "base");
    assert_eq!(parsed["checks"][0]["referenceView"], "title");
    // The prompt template itself never leaks (only its rendered prompt does).
    assert!(parsed.get("promptTemplate").is_none());
    // The seeded spec bodies are inlined per variant: each variant carries its
    // complete, seed-ordered set — the common specs first, then the variant's own —
    // with every body rendered for that variant. So `base`'s set opens with the
    // common `spec/rules.md`, then its own `build.py`.
    assert_eq!(
        parsed["variants"][0]["seededInputs"][0]["path"],
        "spec/rules.md"
    );
    assert_eq!(parsed["variants"][0]["seededInputs"][0]["text"], "# Rules");
    // A common spec with no explicit role defaults to "spec".
    assert_eq!(parsed["variants"][0]["seededInputs"][0]["kind"], "spec");
    assert_eq!(parsed["variants"][0]["seededInputs"][1]["path"], "build.py");
    assert_eq!(parsed["variants"][0]["seededInputs"][1]["text"], "# build");
    // The script role survives ingest → snapshot, so the Inputs tab tags it "Script".
    assert_eq!(parsed["variants"][0]["seededInputs"][1]["kind"], "script");
    // The declared package is carried with its UI-only description, looked up from
    // core's registry at snapshot time.
    assert_eq!(
        parsed["packages"][0]["name"],
        "@test-cabinet/particle-runtime"
    );
    assert!(
        parsed["packages"][0]["description"]
            .as_str()
            .is_some_and(|d| !d.is_empty()),
        "package description should be inlined from core's registry"
    );
}

#[tokio::test]
async fn case_metadata_renders_template_specs_per_variant() {
    // A common `.hbs` spec (`template = true`) that branches on the variant slug,
    // seeded into two variants. The snapshot must render it FOR EACH variant, so the
    // static gallery shows the resolved branch — never the raw `{{#if …}}` template.
    // This is the regression the whole change fixes.
    let mut m = manifest();
    m.common_specs = vec![crate::store::StoredSpec {
        source: "spec/field.md.hbs".to_string(),
        dest: "spec/field.md".to_string(),
        template: true,
        kind: Default::default(),
    }];
    // A second variant so the two renders can be compared. Its `base` sibling comes
    // from the manifest() helper.
    m.variants.push(crate::store::StoredVariant {
        slug: "gyre".to_string(),
        name: "Gyre".to_string(),
        description: Some("Rotating.".to_string()),
        specs: vec![],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
        domains: vec![],
        voxel: None,
        showcase: None,
    });

    let (_tmp, store) = empty_store();
    let template = "# Field\n\
        {{#if (eq variant.slug \"gyre\")}}\nRotating obstacles.\n\
        {{else}}\nStatic obstacles.\n{{/if}}\n";
    let path = store
        .version_dir(&m.slug, &m.version)
        .join("spec/field.md.hbs");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, template).unwrap();

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();

    // Each variant carries its own rendered copy at the seeded dest (not the source
    // `.hbs` key), with the branch resolved and no handlebars left behind.
    let base = &parsed["variants"][0]["seededInputs"][0];
    let gyre = &parsed["variants"][1]["seededInputs"][0];
    assert_eq!(parsed["variants"][0]["slug"], "base");
    assert_eq!(parsed["variants"][1]["slug"], "gyre");
    assert_eq!(base["path"], "spec/field.md");
    assert_eq!(gyre["path"], "spec/field.md");
    let base_text = base["text"].as_str().unwrap();
    let gyre_text = gyre["text"].as_str().unwrap();
    assert!(base_text.contains("Static obstacles."), "base: {base_text}");
    assert!(
        gyre_text.contains("Rotating obstacles."),
        "gyre: {gyre_text}"
    );
    for text in [base_text, gyre_text] {
        assert!(
            !text.contains("{{") && !text.contains("variant.slug"),
            "raw handlebars leaked into the rendered spec: {text}"
        );
    }
}

#[tokio::test]
async fn case_metadata_renders_the_prompt_and_specs_for_every_declared_engine() {
    // A run's Inputs surface on the static site reads the rendering for the engine
    // its run recorded. The engineless pair stays at the top level (what a reader
    // browsing the case sees, and what a run on `none` was handed); every other
    // declared engine rides in `engineRenderings`.
    let mut m = manifest();
    m.prompt_template = "Built on {{engine.name}}.".to_string();
    m.engines = vec![
        test_cabinet_core::EngineSupport::unbounded(test_cabinet_core::engine::NONE_SLUG),
        test_cabinet_core::EngineSupport::unbounded("simple-2d"),
    ];
    m.common_specs = vec![crate::store::StoredSpec {
        source: "spec/field.md.hbs".to_string(),
        dest: "spec/field.md".to_string(),
        template: true,
        kind: Default::default(),
    }];

    let (_tmp, store) = empty_store();
    let path = store
        .version_dir(&m.slug, &m.version)
        .join("spec/field.md.hbs");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "Write the loop yourself: {{engine.slug}}.\n").unwrap();

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let variant = &parsed["variants"][0];

    assert_eq!(variant["prompt"], "Built on None.");
    assert_eq!(
        variant["seededInputs"][0]["text"],
        "Write the loop yourself: none.\n"
    );
    let engine = &variant["engineRenderings"]["simple-2d"];
    assert_eq!(engine["prompt"], "Built on Simple 2D.");
    assert_eq!(
        engine["seededInputs"][0]["text"],
        "Write the loop yourself: simple-2d.\n"
    );
    // The engineless engine is the top-level pair, so duplicating it here would
    // double every spec body in the document for no reader.
    assert!(variant["engineRenderings"]["none"].is_null());
}

#[tokio::test]
async fn only_cases_with_a_published_run_are_emitted() {
    // Two ingested versions, but only `pong@v1.0.0` has a published run. The
    // gallery shows only cases with a published run, so the runless version's case
    // file (and its references) must not be emitted.
    let mut other = manifest();
    other.version = "v2.0.0".to_string();

    let (_tmp, store) = empty_store();
    let snapshot =
        SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![manifest(), other], store)
            .build(now())
            .await
            .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let keys: Vec<&str> = snapshot.objects.iter().map(|o| o.key.as_str()).collect();
    assert!(keys.contains(&format!("{prefix}/cases/pong/v1.0.0.json").as_str()));
    assert!(!keys.contains(&format!("{prefix}/cases/pong/v2.0.0.json").as_str()));
}

#[tokio::test]
async fn case_metadata_exports_reference_baselines_and_names_them_by_key() {
    // A case with a common reference (`gameplay`, applies to every variant) and a
    // variant-scoped one (`title` on `base`). Render both into the store.
    let mut m = manifest();
    m.variants[0].references = vec![StoredReference {
        view: "title".to_string(),
        kind: test_cabinet_core::ReferenceKind::Rendered,
        extension: "png".to_string(),
    }];

    let (_tmp, store) = empty_store();
    for (scope, view) in [("_common", "gameplay"), ("base", "title")] {
        let path = store.reference_path(&m.slug, &m.version, scope, &format!("{view}.png"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("png:{scope}/{view}").into_bytes()).unwrap();
    }

    // The case is only emitted when a published run built it.
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    // The PNG bytes are exported under the content-stable case-media prefix — NOT
    // this snapshot's prefix — keyed by a digest of their own bytes, with an image
    // content type.
    let common_bytes = b"png:_common/gameplay";
    let common_key = format!(
        "media/cases/pong/v1.0.0/references/_common/{}-gameplay.png",
        content_digest(common_bytes)
    );
    let common_obj = snapshot
        .objects
        .iter()
        .find(|o| o.key == common_key)
        .expect("common baseline exported");
    assert_eq!(common_obj.content_type, "image/png");
    assert_eq!(common_obj.bytes, common_bytes);
    let variant_key = format!(
        "media/cases/pong/v1.0.0/references/base/{}-title.png",
        content_digest(b"png:base/title")
    );
    assert!(snapshot.objects.iter().any(|o| o.key == variant_key));
    // Nothing reference-shaped is left under the per-snapshot prefix.
    assert!(
        !snapshot.objects.iter().any(|o| o
            .key
            .starts_with(&format!("{prefix}/cases/pong/v1.0.0/references/"))),
        "reference media must not be written under the per-snapshot prefix"
    );

    // The case metadata names both, with the common one carrying a null variant
    // and the variant-scoped one carrying its slug.
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let refs = parsed["references"].as_array().unwrap();
    let common = refs.iter().find(|r| r["view"] == "gameplay").unwrap();
    assert!(common["variant"].is_null());
    assert_eq!(common["key"], common_key);
    let title = refs.iter().find(|r| r["view"] == "title").unwrap();
    assert_eq!(title["variant"], "base");
    assert_eq!(title["key"], variant_key);
}

#[tokio::test]
async fn snapshot_id_changes_with_the_run_set() {
    let (_tmp_a, store_a) = empty_store();
    let a = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![], store_a)
        .build(now())
        .await
        .unwrap();
    let (_tmp_b, store_b) = empty_store();
    let b = SnapshotBuilder::new(
        vec![stored_run("r1", "t"), stored_run("r2", "t")],
        vec![],
        store_b,
    )
    .build(now())
    .await
    .unwrap();
    assert_ne!(a.snapshot_id, b.snapshot_id);
}

/// A stored run carrying the given proof results (end-to-end). The recorded proofs
/// are what the builder enumerates from — the store/artifact-service only supply the
/// bytes.
fn proof_run(id: &str, proofs: Vec<ProofResult>) -> StoredRun {
    let mut run = stored_run(id, "2026-06-17T21:40:00Z");
    run.record.validation.proofs = proofs;
    run
}

/// A proof result the agent did (or did not) produce at `dest`.
fn proof(id: &str, dest: &str, kind: MediaKind, present: bool) -> ProofResult {
    ProofResult {
        id: id.into(),
        name: id.into(),
        kind,
        dest: dest.into(),
        present,
        detail: None,
    }
}

/// A throwaway HTTP server standing in for the artifact service: it answers `200`
/// with the staged bytes for a known `/runs/<id>/<kind>/<file>` path and `404`
/// otherwise, recording every path it is asked for so a test can assert the store
/// fast-path skipped it. Returns its base URL and that request log.
async fn stub_artifacts(files: HashMap<String, Vec<u8>>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            let files = files.clone();
            let sink = sink.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let path = req
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("")
                    .to_string();
                sink.lock().expect("lock").push(path.clone());
                let resp = match files.get(&path) {
                    Some(body) => {
                        let mut r =
                            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len())
                                .into_bytes();
                        r.extend_from_slice(body);
                        r
                    }
                    None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec(),
                };
                let _ = sock.write_all(&resp).await;
                let _ = sock.flush().await;
            });
        }
    });
    (format!("http://{addr}"), seen)
}

#[tokio::test]
async fn per_run_file_exports_proof_media_from_the_record() {
    let (_tmp, store) = empty_store();
    // The store holds the produced proofs under their served names; the record
    // declares them (one image, one video) plus one the agent did not produce.
    store
        .write_run_proof("p1", "title.png", b"png:title")
        .unwrap();
    store
        .write_run_proof("p1", "rally.mp4", b"mp4:rally")
        .unwrap();

    let run = proof_run(
        "p1",
        vec![
            proof("title", "proof/title.png", MediaKind::Image, true),
            proof("rally", "proof/rally.mp4", MediaKind::Video, true),
            proof("skip", "proof/skip.png", MediaKind::Image, false),
        ],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    // Each present proof's bytes are exported under its content-stable media key,
    // with a content type that follows the extension (the video stays a video).
    let title = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/title.png")
        .expect("image proof exported");
    assert_eq!(title.content_type, "image/png");
    assert_eq!(title.bytes, b"png:title");
    let rally = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/rally.mp4")
        .expect("video proof exported");
    assert_eq!(rally.content_type, "video/mp4");

    // The per-run document lists the present proofs with the record's kinds; the
    // unproduced `skip` is omitted.
    let parsed = run_document_json(&snapshot, "p1");
    let media = parsed["proofMedia"].as_array().unwrap();
    let ids: Vec<&str> = media.iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["title", "rally"]);
    let rally_meta = media.iter().find(|m| m["id"] == "rally").unwrap();
    assert_eq!(rally_meta["kind"], "video");
}

/// A stored run carrying one debug script with the given image + video outputs, so
/// the builder enumerates its synthesized *actual* validation media. `present` gates
/// whether each output is recorded as produced.
fn validation_run(id: &str, item_id: &str, image_present: bool, video_present: bool) -> StoredRun {
    let mut run = stored_run(id, "2026-06-17T21:40:00Z");
    run.record.validation.debug_scripts = vec![DebugScriptResult {
        item_id: item_id.to_string(),
        sub_item_id: None,
        title: "Ball spin".to_string(),
        category_title: "Ball spin".to_string(),
        script: "validation/spin.mjs".to_string(),
        gates: true,
        ran: true,
        precondition_unmet: false,
        detail: None,
        verdicts: vec![],
        outputs: vec![
            DebugScriptOutput {
                id: "still".to_string(),
                name: "Still".to_string(),
                kind: MediaKind::Image,
                actual_present: image_present,
            },
            DebugScriptOutput {
                id: "rally".to_string(),
                name: "Rally".to_string(),
                kind: MediaKind::Video,
                actual_present: video_present,
            },
        ],
    }];
    run
}

#[tokio::test]
async fn per_run_file_exports_actual_validation_media_from_the_record() {
    // The store holds the mirrored *actual* media under the flat, gallery-requested
    // names. Only the present image output is a still (no transcode); the absent
    // outputs contribute nothing.
    let (_tmp, store) = empty_store();
    store
        .write_run_validation("v1", "spin__still.png", b"png:spin-still")
        .unwrap();

    // `still` present, `rally` (video) absent so no transcode is attempted.
    let run = validation_run("v1", "spin", true, false);
    let snapshot = SnapshotBuilder::new(vec![run], vec![], store)
        .build(now())
        .await
        .unwrap();

    // The still's bytes are exported under its content-stable validation media key.
    let still = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/v1/validation/spin__still.png")
        .expect("image validation media exported");
    assert_eq!(still.content_type, "image/png");
    assert_eq!(still.bytes, b"png:spin-still");

    // The per-run document names it by the flat name the reviewer UI requests; the
    // unproduced video output is omitted.
    let parsed = run_document_json(&snapshot, "v1");
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "spin__still.png");
    assert_eq!(media[0]["key"], "media/runs/v1/validation/spin__still.png");
}

#[tokio::test]
async fn a_published_recording_carries_its_framing_onto_the_object() {
    // R2 hands back what the object records, so a recording published without its
    // framing declared would reach the gallery as an opaque gzip blob. The compound
    // `.json.gz` suffix is what says the gzip frames a document rather than being one.
    let (_tmp, store) = empty_store();
    store
        .write_run_validation("v1", "spin__replay.json.gz", &[0x1f, 0x8b, 0x08, 0x00])
        .unwrap();

    let mut run = validation_run("v1", "spin", false, false);
    run.record.validation.debug_scripts[0].outputs = vec![DebugScriptOutput {
        id: "replay".to_string(),
        name: "Replay".to_string(),
        kind: MediaKind::Replay,
        actual_present: true,
    }];
    let snapshot = SnapshotBuilder::new(vec![run], vec![], store)
        .build(now())
        .await
        .unwrap();

    let replay = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/v1/validation/spin__replay.json.gz")
        .expect("replay validation media exported");
    assert_eq!(replay.content_type, "application/json");
    assert_eq!(replay.content_encoding.as_deref(), Some("gzip"));
    assert_eq!(replay.bytes, vec![0x1f, 0x8b, 0x08, 0x00]);
}

#[tokio::test]
async fn per_run_validation_media_for_a_sub_item_is_keyed_by_the_composite_verdict_id() {
    // A per-sub-item driver's media is addressed by the composite verdict id
    // `<item>.<sub>`, so a sub-item's proof does not collide with its siblings' or the
    // whole item's. The store holds it (and the reviewer requests it) under that name.
    let (_tmp, store) = empty_store();
    store
        .write_run_validation("v1", "ball-spin.stationary__still.png", b"png:sub-still")
        .unwrap();

    let mut run = stored_run("v1", "2026-06-17T21:40:00Z");
    run.record.validation.debug_scripts = vec![DebugScriptResult {
        item_id: "ball-spin".to_string(),
        sub_item_id: Some("stationary".to_string()),
        title: "No spin while stationary".to_string(),
        category_title: "Paddle spin".to_string(),
        script: "validation/ball-spin/stationary.mjs".to_string(),
        gates: true,
        ran: true,
        precondition_unmet: false,
        detail: None,
        verdicts: vec![],
        outputs: vec![DebugScriptOutput {
            id: "still".to_string(),
            name: "Still".to_string(),
            kind: MediaKind::Image,
            actual_present: true,
        }],
    }];

    let snapshot = SnapshotBuilder::new(vec![run], vec![], store)
        .build(now())
        .await
        .unwrap();

    assert!(
        snapshot
            .objects
            .iter()
            .any(|o| o.key == "media/runs/v1/validation/ball-spin.stationary__still.png"),
        "the sub-item's media is exported under the composite verdict-id name"
    );
    let parsed = run_document_json(&snapshot, "v1");
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "ball-spin.stationary__still.png");
}

#[tokio::test]
async fn case_metadata_exports_validation_baselines_keyed_by_engine_variant_and_file() {
    // A committed baseline still under the version's
    // `validation-baseline/<engine>/<variant>/` dir (copied into the store verbatim at
    // ingest). The walk is over the engines the manifest declares crossed with its
    // variants, which is exactly the set of reference builds the case has.
    let m = manifest();
    let (_tmp, store) = empty_store();
    let baseline_dir = store
        .version_dir(&m.slug, &m.version)
        .join(test_cabinet_core::VALIDATION_BASELINE_DIR)
        .join(test_cabinet_core::engine::NONE_SLUG)
        .join("base");
    std::fs::create_dir_all(&baseline_dir).unwrap();
    std::fs::write(baseline_dir.join("spin__still.png"), b"png:baseline-still").unwrap();

    // The case is only emitted when a published run built it.
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    // The PNG bytes are exported under the content-stable case-media prefix, keyed
    // by a digest of their own bytes — not under this snapshot's prefix.
    let key = format!(
        "media/cases/pong/v1.0.0/validation-baseline/none/base/{}-spin__still.png",
        content_digest(b"png:baseline-still")
    );
    let obj = snapshot
        .objects
        .iter()
        .find(|o| o.key == key)
        .expect("baseline validation media exported");
    assert_eq!(obj.content_type, "image/png");
    assert_eq!(obj.bytes, b"png:baseline-still");

    // The case metadata names it, carrying the reference build it came from — engine
    // and variant — and the flat requested name. The static gallery keys its lookup
    // off all three, so a run resolves the baseline of the build it was compared
    // against rather than of whichever engine happened to be captured last.
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let baselines = parsed["validationBaselines"].as_array().unwrap();
    assert_eq!(baselines.len(), 1);
    assert_eq!(baselines[0]["engine"], "none");
    assert_eq!(baselines[0]["variant"], "base");
    assert_eq!(baselines[0]["file"], "spin__still.png");
    assert_eq!(baselines[0]["key"], key);
}

/// A stored showcase whose carousel is `files`, each entry keyed under the
/// variant's `showcase/base/` dir the way ingest writes it.
fn stored_showcase(files: &[(&str, MediaKind)]) -> StoredShowcase {
    StoredShowcase {
        description: "A demo game.".to_string(),
        media: files
            .iter()
            .map(|(file, kind)| StoredShowcaseMedia {
                file: file.to_string(),
                name: format!("Caption for {file}"),
                kind: *kind,
                key: format!("showcase/base/{file}"),
            })
            .collect(),
    }
}

#[tokio::test]
async fn case_metadata_exports_variant_showcases_and_names_media_by_key() {
    // A variant's authored showcase: the description and carousel reach the case
    // document, and each media file is published under the content-stable,
    // digest-keyed case-media prefix — exactly as a validation baseline is.
    let mut m = manifest();
    m.variants[0].showcase = Some(stored_showcase(&[
        ("title.png", MediaKind::Image),
        ("rally.json.gz", MediaKind::Replay),
    ]));
    let (_tmp, store) = empty_store();
    let showcase_dir = store.version_dir(&m.slug, &m.version).join("showcase/base");
    std::fs::create_dir_all(&showcase_dir).unwrap();
    std::fs::write(showcase_dir.join("title.png"), b"png:title").unwrap();
    std::fs::write(showcase_dir.join("rally.json.gz"), b"\x1f\x8bgz:rally").unwrap();

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    let png_key = format!(
        "media/cases/pong/v1.0.0/showcase/base/{}-title.png",
        content_digest(b"png:title")
    );
    let png = snapshot
        .objects
        .iter()
        .find(|o| o.key == png_key)
        .expect("showcase still exported under the case-media prefix");
    assert_eq!(png.content_type, "image/png");
    assert_eq!(png.bytes, b"png:title");
    // A replay recording travels gzip-framed, labelled so the player is handed
    // the JSON inside.
    let replay_key = format!(
        "media/cases/pong/v1.0.0/showcase/base/{}-rally.json.gz",
        content_digest(b"\x1f\x8bgz:rally")
    );
    let replay = snapshot
        .objects
        .iter()
        .find(|o| o.key == replay_key)
        .expect("showcase recording exported");
    assert_eq!(replay.content_encoding.as_deref(), Some("gzip"));

    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let showcase = &parsed["variants"][0]["showcase"];
    assert_eq!(showcase["description"], "A demo game.");
    let media = showcase["media"].as_array().unwrap();
    assert_eq!(media.len(), 2);
    assert_eq!(media[0]["file"], "title.png");
    assert_eq!(media[0]["name"], "Caption for title.png");
    assert_eq!(media[0]["kind"], "image");
    assert_eq!(media[0]["key"], serde_json::json!(png_key));
    assert_eq!(media[1]["kind"], "replay");
    assert_eq!(media[1]["key"], serde_json::json!(replay_key));
}

#[tokio::test]
async fn a_variant_without_a_showcase_exports_null() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert!(parsed["variants"][0]["showcase"].is_null());
}

#[tokio::test]
async fn showcase_webm_is_transcoded_to_mp4_with_the_authored_name_kept() {
    let Some(webm) = make_test_webm() else {
        eprintln!("skipping: ffmpeg/libvpx unavailable");
        return;
    };
    let mut m = manifest();
    m.variants[0].showcase = Some(stored_showcase(&[("play.webm", MediaKind::Video)]));
    let (_tmp, store) = empty_store();
    let showcase_dir = store.version_dir(&m.slug, &m.version).join("showcase/base");
    std::fs::create_dir_all(&showcase_dir).unwrap();
    std::fs::write(showcase_dir.join("play.webm"), &webm).unwrap();

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    // Published as an iOS-playable mp4, keyed by a digest of the **source** bytes
    // (decided before the transcode, so an unchanged clip skips the ffmpeg run on
    // the next refresh); the metadata keeps the authored `.webm` name.
    let key = format!(
        "media/cases/pong/v1.0.0/showcase/base/{}-play.mp4",
        content_digest(&webm)
    );
    let clip = snapshot
        .objects
        .iter()
        .find(|o| o.key == key)
        .expect("showcase clip published as mp4");
    assert_eq!(clip.content_type, "video/mp4");
    assert_eq!(&clip.bytes[4..8], b"ftyp", "transcoded bytes are not mp4");

    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let media = &parsed["variants"][0]["showcase"]["media"][0];
    assert_eq!(media["file"], "play.webm");
    assert_eq!(media["kind"], "video");
    assert_eq!(media["key"], serde_json::json!(key));
}

#[tokio::test]
async fn existing_showcase_media_is_referenced_without_re_uploading() {
    // A showcase file already in the bucket under its content key is referenced by
    // the metadata but not re-uploaded — the same dedup a validation baseline gets.
    let mut m = manifest();
    m.variants[0].showcase = Some(stored_showcase(&[("title.png", MediaKind::Image)]));
    let (_tmp, store) = empty_store();
    let showcase_dir = store.version_dir(&m.slug, &m.version).join("showcase/base");
    std::fs::create_dir_all(&showcase_dir).unwrap();
    std::fs::write(showcase_dir.join("title.png"), b"png:title").unwrap();

    let key = format!(
        "media/cases/pong/v1.0.0/showcase/base/{}-title.png",
        content_digest(b"png:title")
    );
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .with_existing_media(std::collections::HashSet::from([key.clone()]))
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    assert!(
        !snapshot.objects.iter().any(|o| o.key == key),
        "an already-published showcase file must not be re-uploaded",
    );
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert_eq!(
        parsed["variants"][0]["showcase"]["media"][0]["key"],
        serde_json::json!(key)
    );
}

#[tokio::test]
async fn case_metadata_exports_workspace_files_engineless_and_per_engine() {
    // The starter workspace reaches the case document as lazy addressing — dest +
    // published object key — for the engineless set on the variant itself and for
    // each declared engine's set on its rendering, with the bytes published once
    // under the content-addressed files prefix with a text content type.
    let mut m = manifest();
    m.engines = vec![
        test_cabinet_core::EngineSupport::unbounded(test_cabinet_core::engine::NONE_SLUG),
        test_cabinet_core::EngineSupport::unbounded("simple-2d"),
    ];
    m.workspace = StoredWorkspace(std::collections::BTreeMap::from([
        (
            "none".to_string(),
            vec![StoredWorkspaceFile {
                source: "workspaces/none/src/main.ts".to_string(),
                dest: "src/main.ts".to_string(),
            }],
        ),
        (
            "simple-2d".to_string(),
            vec![
                StoredWorkspaceFile {
                    source: "workspaces/simple-2d/src/main.ts".to_string(),
                    dest: "src/main.ts".to_string(),
                },
                StoredWorkspaceFile {
                    source: "workspaces/simple-2d/package.json".to_string(),
                    dest: "package.json".to_string(),
                },
            ],
        ),
    ]));
    let (_tmp, store) = empty_store();
    for (key, body) in [
        // The two engines' `main.ts` are byte-identical, so they collapse onto one
        // published object.
        ("workspaces/none/src/main.ts", "console.log(1)"),
        ("workspaces/simple-2d/src/main.ts", "console.log(1)"),
        ("workspaces/simple-2d/package.json", "{}"),
    ] {
        let path = store.version_dir(&m.slug, &m.version).join(key);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, body).unwrap();
    }

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    // `main.ts` is published exactly once even though both engines seed it: the
    // key is a digest of the bytes plus the base name, and identical bytes share
    // one object. A TypeScript source deliberately serves as plain text.
    let main_key = format!(
        "files/cases/pong/v1.0.0/workspace/{}-main.ts",
        content_digest(b"console.log(1)")
    );
    let main_objects: Vec<_> = snapshot
        .objects
        .iter()
        .filter(|o| o.key == main_key)
        .collect();
    assert_eq!(main_objects.len(), 1, "identical bytes publish one object");
    assert_eq!(main_objects[0].content_type, "text/plain; charset=utf-8");
    let package_key = format!(
        "files/cases/pong/v1.0.0/workspace/{}-package.json",
        content_digest(b"{}")
    );
    let package = snapshot
        .objects
        .iter()
        .find(|o| o.key == package_key)
        .expect("workspace package.json exported");
    assert_eq!(package.content_type, "application/json");

    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    // The variant-level set is the engineless (`none`) workspace…
    let engineless = parsed["variants"][0]["workspaceFiles"].as_array().unwrap();
    assert_eq!(engineless.len(), 1);
    assert_eq!(engineless[0]["dest"], "src/main.ts");
    assert_eq!(engineless[0]["key"], serde_json::json!(main_key));
    // …and each engine rendering carries its own.
    let rendering = &parsed["variants"][0]["engineRenderings"]["simple-2d"];
    let files = rendering["workspaceFiles"].as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0]["dest"], "src/main.ts");
    assert_eq!(files[0]["key"], serde_json::json!(main_key));
    assert_eq!(files[1]["dest"], "package.json");
    assert_eq!(files[1]["key"], serde_json::json!(package_key));
}

/// Generate a tiny real `.webm` clip with ffmpeg, or `None` if ffmpeg (or a VP8
/// encoder) is unavailable — the caller then skips the transcode round-trip test.
fn make_test_webm() -> Option<Vec<u8>> {
    let dir = TempDir::new().ok()?;
    let out = dir.path().join("in.webm");
    let ok = std::process::Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=64x64:rate=10",
            "-c:v",
            "libvpx",
            "-b:v",
            "50k",
        ])
        .arg(&out)
        .status()
        .ok()
        .is_some_and(|s| s.success());
    ok.then(|| std::fs::read(&out).ok()).flatten()
}

#[tokio::test]
async fn video_proof_recorded_as_webm_is_transcoded_to_mp4_for_the_snapshot() {
    // A run captures its clip as the `.webm` Playwright records; the snapshot must
    // publish it as an iOS-playable `.mp4`, keyed `<proof-id>.mp4`.
    let Some(webm) = make_test_webm() else {
        eprintln!("skipping: ffmpeg/libvpx unavailable");
        return;
    };
    let (_tmp, store) = empty_store();
    store.write_run_proof("p1", "rally.webm", &webm).unwrap();

    let run = proof_run(
        "p1",
        vec![proof("rally", "proof/rally.webm", MediaKind::Video, true)],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    // The webm is gone from the snapshot; the exported object is a real mp4.
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.ends_with("/rally.webm")),
        "the raw webm must not be published",
    );
    let rally = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/rally.mp4")
        .expect("video proof published as mp4");
    assert_eq!(rally.content_type, "video/mp4");
    // The bytes are a valid mp4: the `ftyp` box tag sits at offset 4.
    assert_eq!(&rally.bytes[4..8], b"ftyp", "transcoded bytes are not mp4");

    // The per-run doc points at the mp4 key with a video kind.
    let parsed = run_document_json(&snapshot, "p1");
    let rally_meta = parsed["proofMedia"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "rally")
        .unwrap();
    assert_eq!(rally_meta["kind"], "video");
    assert_eq!(rally_meta["key"], "media/runs/p1/proof/rally.mp4");
}

#[tokio::test]
async fn video_validation_media_recorded_as_webm_is_transcoded_to_mp4() {
    // The captured *actual* video output is the `.webm` Playwright records; the
    // snapshot must publish it as an iOS-playable `.mp4` under the flat validation
    // key, while the per-run doc keeps the gallery-requested `.webm` name.
    let Some(webm) = make_test_webm() else {
        eprintln!("skipping: ffmpeg/libvpx unavailable");
        return;
    };
    let (_tmp, store) = empty_store();
    store
        .write_run_validation("v1", "spin__rally.webm", &webm)
        .unwrap();

    // Only the video output is present.
    let run = validation_run("v1", "spin", false, true);
    let snapshot = SnapshotBuilder::new(vec![run], vec![], store)
        .build(now())
        .await
        .unwrap();

    // The raw webm is gone; the exported object is a real mp4 under the mp4 key.
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.ends_with("/spin__rally.webm")),
        "the raw validation webm must not be published",
    );
    let rally = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/v1/validation/spin__rally.mp4")
        .expect("video validation media published as mp4");
    assert_eq!(rally.content_type, "video/mp4");
    assert_eq!(&rally.bytes[4..8], b"ftyp", "transcoded bytes are not mp4");

    // The per-run doc keeps the `.webm` file the UI requests but points at the mp4 key.
    let parsed = run_document_json(&snapshot, "v1");
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "spin__rally.webm");
    assert_eq!(media[0]["key"], "media/runs/v1/validation/spin__rally.mp4");
}

#[tokio::test]
async fn video_proof_falls_back_to_webm_when_transcode_fails() {
    // The webm bytes are unusable (or ffmpeg is absent): rather than dropping the
    // proof, the builder publishes the raw webm so it still appears in the gallery.
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("p1", "rally.webm", b"not a real webm")
        .unwrap();

    let run = proof_run(
        "p1",
        vec![proof("rally", "proof/rally.webm", MediaKind::Video, true)],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    let rally = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/rally.webm")
        .expect("video proof falls back to raw webm");
    assert_eq!(rally.content_type, "video/webm");
    assert_eq!(rally.bytes, b"not a real webm");
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.ends_with("/rally.mp4")),
        "no mp4 should be published when the transcode fails",
    );
}

#[tokio::test]
async fn missing_store_media_falls_back_to_the_artifact_service() {
    // The store is empty (as after a backend restart wiped its emptyDir), but the
    // artifact service still holds the run's proof. The builder must recover it.
    let (_tmp, store) = empty_store();
    let (base, seen) = stub_artifacts(HashMap::from([(
        "/runs/p1/proof/title.png".to_string(),
        b"durable:title".to_vec(),
    )]))
    .await;

    let run = proof_run(
        "p1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .build(now())
        .await
        .unwrap();

    let title = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/title.png")
        .expect("proof recovered from the artifact service");
    assert_eq!(title.bytes, b"durable:title");
    assert!(
        seen.lock()
            .unwrap()
            .contains(&"/runs/p1/proof/title.png".to_string()),
        "the builder fetched the missing proof from the artifact service",
    );
}

#[tokio::test]
async fn store_media_is_used_without_calling_the_artifact_service() {
    // When the store has the media, it is the fast path: no artifact request is made
    // even though the fallback is configured.
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("p1", "title.png", b"local:title")
        .unwrap();
    let (base, seen) = stub_artifacts(HashMap::new()).await;

    let run = proof_run(
        "p1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_artifacts(Some(base), reqwest::Client::new())
        .build(now())
        .await
        .unwrap();

    let title = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/title.png")
        .expect("proof exported from the store");
    assert_eq!(title.bytes, b"local:title");
    assert!(
        seen.lock().unwrap().is_empty(),
        "the store fast-path made no artifact-service request",
    );
}

#[tokio::test]
async fn existing_media_is_referenced_without_re_uploading_or_reading_the_source() {
    // The media is already in the bucket at its content-stable key. The builder must
    // reference it in the per-run document but NOT re-emit it as an upload object, and
    // must not need the source bytes at all — proving a refresh keeps a run's media
    // even when the store and artifact service have both lost the bytes (as after a
    // cluster recreate). The store is empty and no artifact fallback is configured.
    let (_tmp, store) = empty_store();
    let existing = std::collections::HashSet::from([
        "media/runs/p1/proof/title.png".to_string(),
        "media/runs/p1/proof/rally.mp4".to_string(),
    ]);

    let run = proof_run(
        "p1",
        vec![
            proof("title", "proof/title.png", MediaKind::Image, true),
            proof("rally", "proof/rally.mp4", MediaKind::Video, true),
        ],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_existing_media(existing)
        .build(now())
        .await
        .unwrap();

    // No media object is re-emitted for the already-present keys.
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.starts_with("media/runs/p1/proof/")),
        "existing media must not be re-uploaded",
    );
    // But the per-run document still points at both stable keys.
    let parsed = run_document_json(&snapshot, "p1");
    let keys: Vec<&str> = parsed["proofMedia"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["key"].as_str().unwrap())
        .collect();
    assert_eq!(
        keys,
        vec![
            "media/runs/p1/proof/title.png",
            "media/runs/p1/proof/rally.mp4"
        ],
    );
}

#[tokio::test]
async fn an_unchanged_run_document_is_referenced_without_being_re_uploaded() {
    // The whole point of content-addressing the documents: a refresh where nothing
    // about a run moved must upload nothing for it, while `runs.json` still resolves.
    // Build once to learn the key the run's document hashes to, then rebuild handing
    // that key back as already-present.
    let (_tmp, store) = empty_store();
    let runs = || vec![stored_run("r1", "2026-06-17T21:40:00Z")];
    let first = SnapshotBuilder::new(runs(), vec![manifest()], store.clone())
        .build(now())
        .await
        .unwrap();
    let key = run_document(&first, "r1").key.clone();

    let second = SnapshotBuilder::new(runs(), vec![manifest()], store)
        .with_existing_documents(std::collections::HashSet::from([key.clone()]))
        .build(now())
        .await
        .unwrap();

    assert!(
        !second
            .objects
            .iter()
            .any(|object| object.key.starts_with(RUN_DOCUMENT_PREFIX)),
        "an unchanged run document must not be re-uploaded",
    );
    // The summary still points at it, so the site reaches the same document…
    assert_eq!(runs_index(&second)["runs"][0]["documentKey"], key);
    // …and the prune sees it as live rather than orphaned.
    assert!(second.run_document_keys.contains(&key));
}

#[tokio::test]
async fn a_changed_run_mints_a_new_document_key_and_uploads_it() {
    // The complement, and what keeps the skip honest: the digest is over the document's
    // own bytes, so a run whose public content changed cannot collide with the key
    // already in the bucket and is uploaded.
    let (_tmp, store) = empty_store();
    let before = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store.clone(),
    )
    .build(now())
    .await
    .unwrap();
    let stale_key = run_document(&before, "r1").key.clone();

    let mut changed = stored_run("r1", "2026-06-17T21:40:00Z");
    changed.record.links.source_repo = Some("https://github.com/x/moved".to_string());
    let after = SnapshotBuilder::new(vec![changed], vec![manifest()], store)
        .with_existing_documents(std::collections::HashSet::from([stale_key.clone()]))
        .build(now())
        .await
        .unwrap();

    let fresh = run_document(&after, "r1");
    assert_ne!(fresh.key, stale_key, "changed content must mint a new key");
    assert_eq!(runs_index(&after)["runs"][0]["documentKey"], fresh.key);
    // The superseded revision is no longer referenced, so the prune may reclaim it.
    assert!(!after.run_document_keys.contains(&stale_key));
}

#[tokio::test]
async fn media_absent_from_the_bucket_is_still_uploaded_from_the_source() {
    // The complement: a stable key NOT in the existing set is read from the store and
    // uploaded as before, so a brand-new run's media is exported on its first refresh.
    let (_tmp, store) = empty_store();
    store
        .write_run_proof("p1", "title.png", b"png:title")
        .unwrap();
    let run = proof_run(
        "p1",
        vec![proof("title", "proof/title.png", MediaKind::Image, true)],
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        // An unrelated key is present, but not this run's — so it is not skipped.
        .with_existing_media(std::collections::HashSet::from([
            "media/runs/other/proof/x.png".to_string(),
        ]))
        .build(now())
        .await
        .unwrap();

    let title = snapshot
        .objects
        .iter()
        .find(|o| o.key == "media/runs/p1/proof/title.png")
        .expect("absent media is uploaded from the source");
    assert_eq!(title.bytes, b"png:title");
}

#[tokio::test]
async fn a_variant_carries_its_reference_build_urls_when_they_are_supplied() {
    // The reference-implementation URLs live in the `case_reference_build` table
    // (written out-of-band by `tcab publish-reference`), not the manifest, so the
    // caller hands the builder a `(slug, version)` → (variant → engine → URL) map.
    // A variant has one build per engine and they must land side by side, because
    // the site's Reference tab is what lets a reader switch between them.
    let (_tmp, store) = empty_store();
    let mut builds = std::collections::HashMap::new();
    builds.insert(
        ("pong".to_string(), "v1.0.0".to_string()),
        std::collections::HashMap::from([(
            "base".to_string(),
            std::collections::BTreeMap::from([
                (
                    "none".to_string(),
                    "https://carom-v1-0-0-base-none.test-cabinet-references.pages.dev".to_string(),
                ),
                (
                    "simple-2d".to_string(),
                    "https://carom-v1-0-0-base-simple-2d.test-cabinet-references.pages.dev"
                        .to_string(),
                ),
            ]),
        )]),
    );

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![manifest()], store)
        .with_reference_builds(builds)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert_eq!(
        parsed["variants"][0]["referenceBuilds"]["none"],
        "https://carom-v1-0-0-base-none.test-cabinet-references.pages.dev"
    );
    assert_eq!(
        parsed["variants"][0]["referenceBuilds"]["simple-2d"],
        "https://carom-v1-0-0-base-simple-2d.test-cabinet-references.pages.dev"
    );
}

#[tokio::test]
async fn a_variant_without_a_reference_build_exports_an_empty_map() {
    // No reference build supplied for this case → the variant's `referenceBuilds` is
    // serialized as an empty object, never omitted, so the site can rely on the
    // key's presence.
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert_eq!(
        parsed["variants"][0]["referenceBuilds"],
        serde_json::json!({})
    );
}

#[tokio::test]
async fn a_variant_carries_its_reference_sheet_frames_when_supplied() {
    // The asset-generation counterpart: the published frame set lives in the
    // `case_reference_sheet` table (reconciled at ingest from the bucket), not the
    // manifest, so the caller hands the builder a `(slug, version)` → (variant →
    // frames) map. Only the indices are exported — every frame's key is derivable —
    // and the site joins them onto its own snapshot base URL.
    let (_tmp, store) = empty_store();
    let mut sheets = std::collections::HashMap::new();
    sheets.insert(
        ("pong".to_string(), "v1.0.0".to_string()),
        std::collections::HashMap::from([("base".to_string(), vec![0u32, 1, 2])]),
    );

    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![manifest()], store)
        .with_reference_sheets(sheets)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert_eq!(
        parsed["variants"][0]["referenceSheet"]["frames"],
        serde_json::json!([0, 1, 2])
    );
}

#[tokio::test]
async fn a_variant_without_a_reference_sheet_exports_null() {
    // No reference sheet supplied for this case → the variant's `referenceSheet` is
    // serialized as JSON null (the default), never omitted, so the site can rely on
    // the key's presence. Null rather than an empty `frames` array, so "no published
    // reference" stays distinguishable from "a reference with nothing in it".
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    assert!(parsed["variants"][0]["referenceSheet"].is_null());
}

// --- content-stable case media ----------------------------------------------

#[tokio::test]
async fn case_media_already_in_the_bucket_is_referenced_without_re_uploading() {
    // The whole point of the content-stable prefix: a refresh over an unchanged
    // case corpus must upload none of it, while the metadata still names every key.
    let mut m = manifest();
    m.variants[0].references = vec![StoredReference {
        view: "title".to_string(),
        kind: test_cabinet_core::ReferenceKind::Rendered,
        extension: "png".to_string(),
    }];

    let (_tmp, store) = empty_store();
    for (scope, view) in [("_common", "gameplay"), ("base", "title")] {
        let path = store.reference_path(&m.slug, &m.version, scope, &format!("{view}.png"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("png:{scope}/{view}").into_bytes()).unwrap();
    }
    let baseline_dir = store
        .version_dir(&m.slug, &m.version)
        .join(test_cabinet_core::VALIDATION_BASELINE_DIR)
        .join(test_cabinet_core::engine::NONE_SLUG)
        .join("base");
    std::fs::create_dir_all(&baseline_dir).unwrap();
    std::fs::write(baseline_dir.join("spin__still.png"), b"png:baseline-still").unwrap();

    // First refresh: nothing in the bucket, so every object is uploaded.
    let first = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m.clone()], store.clone())
        .build(now())
        .await
        .unwrap();
    let case_media: Vec<String> = first
        .objects
        .iter()
        .filter(|o| o.key.starts_with("media/cases/"))
        .map(|o| o.key.clone())
        .collect();
    assert_eq!(
        case_media.len(),
        3,
        "two references + one baseline uploaded"
    );

    // Second refresh with those keys already present: the metadata is unchanged but
    // not one byte of case media is re-uploaded.
    let second = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .with_existing_media(case_media.iter().cloned().collect())
        .build(now())
        .await
        .unwrap();
    assert!(
        !second
            .objects
            .iter()
            .any(|o| o.key.starts_with("media/cases/")),
        "case media already in the bucket must not be re-uploaded"
    );

    let prefix = format!("snapshots/{}", second.snapshot_id);
    let case = second
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let named: Vec<String> = parsed["references"]
        .as_array()
        .unwrap()
        .iter()
        .chain(parsed["validationBaselines"].as_array().unwrap())
        .map(|r| r["key"].as_str().unwrap().to_string())
        .collect();
    for key in &case_media {
        assert!(named.contains(key), "metadata still names {key}");
    }
}

#[tokio::test]
async fn changed_reference_bytes_mint_a_new_content_key() {
    // A re-render that genuinely changes the bytes must not be masked by the skip:
    // it produces a different digest, so a different key, so a real upload.
    let m = manifest();
    let (_tmp, store) = empty_store();
    let path = store.reference_path(&m.slug, &m.version, "_common", "gameplay.png");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"png:first-render").unwrap();

    let first = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m.clone()], store.clone())
        .build(now())
        .await
        .unwrap();
    let first_key = first
        .objects
        .iter()
        .find(|o| o.key.starts_with("media/cases/"))
        .unwrap()
        .key
        .clone();

    // Re-render to different bytes, with the OLD key still in the bucket.
    std::fs::write(&path, b"png:second-render-different").unwrap();
    let second = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .with_existing_media(std::iter::once(first_key.clone()).collect())
        .build(now())
        .await
        .unwrap();
    let second_obj = second
        .objects
        .iter()
        .find(|o| o.key.starts_with("media/cases/"))
        .expect("changed bytes are uploaded under a new key");
    assert_ne!(second_obj.key, first_key);
    assert_eq!(second_obj.bytes, b"png:second-render-different");
}

// --- pruning superseded generations -----------------------------------------

/// A key inside generation `id`.
fn gen_key(id: &str, tail: &str) -> String {
    format!("snapshots/{id}/{tail}")
}

#[test]
fn prune_keeps_the_live_generation_however_old_it_is() {
    // The live snapshot is 30 days old (nothing published in a while). Deleting it
    // would take the public site down, so age must not reach it.
    let now = time::macros::datetime!(2026 - 07 - 31 12:00:00 UTC);
    let keys = vec![
        gen_key("2026-07-01T0000Z-aaaaaaaa", "runs.json"),
        gen_key("2026-07-01T0000Z-aaaaaaaa", "runs/r1.json"),
    ];
    let stale = stale_generation_keys(
        &keys,
        "2026-07-01T0000Z-aaaaaaaa",
        now,
        std::time::Duration::from_secs(24 * 3600),
    );
    assert!(stale.is_empty(), "the live generation is never pruned");
}

#[test]
fn prune_spares_generations_inside_the_retention_window() {
    // A generation superseded 10 minutes ago may still be feeding a site build
    // that already read the old index.json.
    let now = time::macros::datetime!(2026 - 07 - 31 12:00:00 UTC);
    let keys = vec![
        gen_key("2026-07-31T1150Z-bbbbbbbb", "runs.json"),
        gen_key("2026-07-29T0000Z-cccccccc", "runs.json"),
    ];
    let stale = stale_generation_keys(
        &keys,
        "2026-07-31T1200Z-dddddddd",
        now,
        std::time::Duration::from_secs(24 * 3600),
    );
    assert_eq!(
        stale,
        vec![gen_key("2026-07-29T0000Z-cccccccc", "runs.json")]
    );
}

#[test]
fn prune_collects_every_key_of_a_stale_generation() {
    let now = time::macros::datetime!(2026 - 07 - 31 12:00:00 UTC);
    let stale_id = "2026-07-01T0000Z-aaaaaaaa";
    let keys = vec![
        gen_key(stale_id, "runs.json"),
        gen_key(stale_id, "runs/r1.json"),
        gen_key(stale_id, "cases/pong/v1.0.0.json"),
        gen_key(stale_id, "models.json"),
    ];
    let stale = stale_generation_keys(
        &keys,
        "2026-07-31T1200Z-dddddddd",
        now,
        std::time::Duration::from_secs(24 * 3600),
    );
    assert_eq!(stale.len(), 4);
}

#[test]
fn prune_never_touches_media_or_the_index() {
    // Run media, case media and the pointer live outside `snapshots/` and are not
    // generation-scoped; the prune must be blind to them.
    let now = time::macros::datetime!(2026 - 07 - 31 12:00:00 UTC);
    let keys = vec![
        "index.json".to_string(),
        "media/runs/r1/proof/hunt.mp4".to_string(),
        "media/cases/pong/v1.0.0/references/_common/abcdef0123456789-gameplay.png".to_string(),
        "pfp/acct_1".to_string(),
    ];
    let stale = stale_generation_keys(
        &keys,
        "2026-07-31T1200Z-dddddddd",
        now,
        std::time::Duration::from_secs(0),
    );
    assert!(stale.is_empty());
}

#[test]
fn prune_keeps_a_generation_whose_id_it_cannot_date() {
    // An id shape this does not recognize is not something to delete on a guess.
    let now = time::macros::datetime!(2026 - 07 - 31 12:00:00 UTC);
    let keys = vec![
        gen_key("not-a-timestamp", "runs.json"),
        gen_key("2026-07-01T0000Z-nothex!!", "runs.json"),
        gen_key("2026-13-45T9999Z-aaaaaaaa", "runs.json"),
    ];
    let stale = stale_generation_keys(
        &keys,
        "2026-07-31T1200Z-dddddddd",
        now,
        std::time::Duration::from_secs(0),
    );
    assert!(
        stale.is_empty(),
        "undatable generations are kept: {stale:?}"
    );
}

#[test]
fn generation_timestamp_round_trips_a_real_snapshot_id() {
    // The exact id shape `snapshot_id` produces must parse back.
    assert_eq!(
        generation_timestamp("2026-07-27T0437Z-6898b393"),
        Some(time::macros::datetime!(2026 - 07 - 27 04:37:00 UTC))
    );
}

// ── run-tree artifacts and the public snapshot ──────────────────────────────

#[tokio::test]
async fn a_stored_run_tree_artifact_never_reaches_the_public_snapshot() {
    // R7, and owner decision Q1. The **session record** is never published: it is a
    // private, whole-run capture of everything the model was sent, so it never goes to
    // R2 at all (and could not be redacted usefully if it did — it is opaque, possibly
    // gzipped bytes the scrubber cannot walk). A code-analysis document *is* published
    // now, but only when the run **record** says the run was analysed — the store
    // holding one is not the authority, exactly as it is not for proofs. This run's
    // record carries none, so neither artifact becomes an object.
    //
    // This is the regression that would be silent: adding a new sibling object to the
    // snapshot is a two-line change, and nothing else in the builder would notice.
    let (_tmp, store) = empty_store();
    store
        .write_run_artifact("r1", "replay", b"prompt sk-ant-leaked-key-from-the-env")
        .unwrap();
    store
        .write_run_artifact("r1", "code-analysis", b"{\"files\":1}")
        .unwrap();

    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![],
        store,
    )
    .build(now())
    .await
    .unwrap();

    for object in snapshot
        .objects
        .iter()
        .chain(std::iter::once(&snapshot.index))
    {
        assert!(
            !object.key.contains("replay") && !object.key.contains("code-analysis"),
            "run-tree artifact published as `{}`",
            object.key
        );
        let body = String::from_utf8_lossy(&object.bytes);
        assert!(
            !body.contains("sk-ant-leaked-key-from-the-env"),
            "run-tree artifact bytes leaked into `{}`",
            object.key
        );
    }
}

#[tokio::test]
async fn every_published_run_document_is_scrubbed_on_its_way_out() {
    // The other half of R7: whatever *is* published for a run must go through
    // `scrub_json`. Today that is the one `PerRun` document, so a leaked provider key
    // anywhere in a run's captured text — here the failure detail, but the scrub walks
    // the whole document including the events blob — is redacted before it becomes an
    // object. Any new per-run field inherits that for free; a new sibling *object*
    // would not, which is what the test above pins.
    let (_tmp, store) = empty_store();
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.status.detail =
        Some("harness exited: ANTHROPIC_API_KEY=sk-ant-api03-notreal-value".to_string());
    let snapshot = SnapshotBuilder::new(vec![run], vec![], store)
        .build(now())
        .await
        .unwrap();

    let body = String::from_utf8(run_document(&snapshot, "r1").bytes.clone()).unwrap();
    assert!(!body.contains("sk-ant-api03-notreal-value"));
    assert!(body.contains(test_cabinet_core::redact::PLACEHOLDER));
}

/// A real `CodeAnalysisSummary`, produced by pointing the real analyzer at a two-file
/// tree. Cheaper and far more durable than a ninety-five-field literal, which would drift
/// from the contract the moment a metric is added.
fn code_analysis_summary() -> test_cabinet_core::CodeAnalysisSummary {
    let tree = TempDir::new().expect("temp dir");
    std::fs::create_dir_all(tree.path().join("src")).expect("a source directory");
    std::fs::write(
        tree.path().join("src/main.ts"),
        "export function boot(): number {\n  return 1;\n}\n",
    )
    .expect("a source file");
    test_cabinet_code_analysis::analyze(&test_cabinet_code_analysis::AnalysisRequest {
        root: tree.path(),
        seed_commit: None,
        tree_basis: test_cabinet_core::CodeTreeBasis::PreValidation,
    })
    .summary
}

/// A published run that carries a real code analysis, plus its stored unbounded document.
/// The document is written as **gzip**, which is what the driver actually mirrors from the
/// run tree's `code-analysis.json.gz`.
fn analysed_run(store: &DefinitionStore, id: &str, document: serde_json::Value) -> StoredRun {
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(&serde_json::to_vec(&document).expect("serialize the document"))
        .expect("gzip the document");
    store
        .write_run_code_analysis(id, &encoder.finish().expect("finish the gzip stream"))
        .expect("store the run's code-analysis document");

    let mut run = stored_run(id, "2026-06-17T21:40:00Z");
    run.record.code_analysis = Some(code_analysis_summary());
    run
}

/// The snapshot-relative key a run's code-analysis object is published under, for the
/// current analyzer generation.
fn code_analysis_key(run_id: &str) -> String {
    format!(
        "media/runs/{run_id}/code-analysis/v{}.json",
        test_cabinet_core::code_analysis::CODE_ANALYZER_VERSION
    )
}

#[tokio::test]
async fn a_run_s_code_analysis_publishes_as_a_summary_on_the_card_and_a_keyed_document() {
    // The two tiers, and the seam between them. The **card** in `runs.json` carries the
    // ranking-relevant slice plus its provenance, so an ordering over the whole corpus
    // costs one file; the **per-run document** carries the full bounded summary on the
    // record (as it always has) and now a `codeAnalysisKey` pointing at the unbounded
    // document published as its own object.
    let (_tmp, store) = empty_store();
    let run = analysed_run(
        &store,
        "r1",
        serde_json::json!({ "analyzerVersion": 1, "files": [{ "path": "src/main.ts" }] }),
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let runs_index = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs.json"))
        .expect("the runs index");
    let index: serde_json::Value = serde_json::from_slice(&runs_index.bytes).unwrap();
    let card = &index["runs"][0]["code"];
    assert_eq!(card["analyzerVersion"], 1);
    assert_eq!(card["authoredBasis"], "allFiles");
    assert_eq!(card["treeBasis"], "preValidation");
    assert_eq!(card["truncated"], false);
    assert_eq!(
        card["codeLines"], 3,
        "the card carries the ranking figures, not just the provenance",
    );
    assert!(card["giniCodeLines"].is_number());
    assert!(card["meanCognitive"].is_number());

    let parsed = run_document_json(&snapshot, "r1");
    assert_eq!(
        parsed["record"]["codeAnalysis"]["treeBasis"], "preValidation",
        "the bounded summary still rides inside the document `scrub_json` walked",
    );
    assert_eq!(
        parsed["codeAnalysisKey"],
        code_analysis_key("r1"),
        "the per-run document points at the unbounded tier by its generation-keyed key",
    );

    let document = snapshot
        .objects
        .iter()
        .find(|o| o.key == code_analysis_key("r1"))
        .expect("the unbounded code-analysis document is published as its own object");
    assert_eq!(document.content_type, "application/json");
    let body: serde_json::Value = serde_json::from_slice(&document.bytes).unwrap();
    assert_eq!(
        body["files"][0]["path"], "src/main.ts",
        "the stored gzip is decoded and republished as plain JSON",
    );
}

#[tokio::test]
async fn the_published_code_analysis_document_is_scrubbed() {
    // R7. `build` scrubs the `PerRun` document and *only* that document, so a sibling
    // object bypasses redaction entirely. This one is a static read of model-written
    // source — every authored path and every symbol name it wrote — and model-written
    // source contains hard-coded credentials often enough that the scrubber exists at
    // all, so it is parsed and scrubbed on its own way out. The leak below is a file the
    // model named after the key it was handed, which is exactly the shape that reaches an
    // *unbounded* document while the bounded summary (all numbers) can never carry one.
    let (_tmp, store) = empty_store();
    let run = analysed_run(
        &store,
        "r1",
        serde_json::json!({
            "analyzerVersion": 1,
            "files": [{ "path": "src/keys/sk-ant-api03-notreal-value.ts" }],
        }),
    );
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    let document = snapshot
        .objects
        .iter()
        .find(|o| o.key == code_analysis_key("r1"))
        .expect("the code-analysis object");
    let body = String::from_utf8(document.bytes.clone()).unwrap();
    assert!(
        !body.contains("sk-ant-api03-notreal-value"),
        "a leaked key reached R2 through the code-analysis object: {body}",
    );
    assert!(body.contains(test_cabinet_core::redact::PLACEHOLDER));
}

#[tokio::test]
async fn two_snapshot_refreshes_upload_the_code_analysis_object_once() {
    // **The property the generation-in-the-key exists for.** The document is immutable
    // for a given (run, analyzer generation), so a refresh that finds the object already
    // in the bucket must reference it rather than re-read, re-scrub and re-upload it —
    // otherwise every refresh re-exports the whole analysed corpus, which is the growing
    // cost `with_existing_media` was introduced to stop for media.
    //
    // The second build is handed exactly what the first uploaded, which is what the
    // publisher does (it lists the `media/` prefix before building).
    let (_tmp, store) = empty_store();
    let run = analysed_run(&store, "r1", serde_json::json!({ "analyzerVersion": 1 }));

    let first = SnapshotBuilder::new(vec![run.clone()], vec![manifest()], store.clone())
        .build(now())
        .await
        .unwrap();
    assert!(
        first
            .objects
            .iter()
            .any(|o| o.key == code_analysis_key("r1")),
        "the first refresh uploads it",
    );

    let uploaded: std::collections::HashSet<String> = first
        .objects
        .iter()
        .map(|o| o.key.clone())
        .filter(|key| key.starts_with("media/"))
        .collect();
    let second = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_existing_media(uploaded)
        .build(now())
        .await
        .unwrap();

    assert!(
        !second
            .objects
            .iter()
            .any(|o| o.key == code_analysis_key("r1")),
        "the second refresh re-uploaded the code-analysis object: {:?}",
        second.objects.iter().map(|o| &o.key).collect::<Vec<_>>(),
    );

    let parsed = run_document_json(&second, "r1");
    assert_eq!(
        parsed["codeAnalysisKey"],
        code_analysis_key("r1"),
        "skipping the upload must still point the document at the object already there",
    );
}

#[tokio::test]
async fn a_newer_analyzer_generation_mints_a_new_code_analysis_key() {
    // The other half of putting the generation in the key: the skip must be scoped to the
    // generation that produced the bytes. A re-analysis under a newer generation is a
    // different document, so it gets a different key rather than silently overwriting
    // figures an already-published snapshot still points at — and the older object's
    // presence in the bucket must not suppress it.
    let (_tmp, store) = empty_store();
    let mut run = analysed_run(&store, "r1", serde_json::json!({ "analyzerVersion": 99 }));
    run.record.code_analysis.as_mut().unwrap().analyzer_version = 99;

    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .with_existing_media(std::collections::HashSet::from([code_analysis_key("r1")]))
        .build(now())
        .await
        .unwrap();

    let key = "media/runs/r1/code-analysis/v99.json";
    assert!(
        snapshot.objects.iter().any(|o| o.key == key),
        "the generation the record carries keys the object, not the running binary's: {:?}",
        snapshot.objects.iter().map(|o| &o.key).collect::<Vec<_>>(),
    );
}

#[tokio::test]
async fn an_unanalysed_run_carries_no_code_summary_and_no_key() {
    // Absence is explicit, and it is the common case: the corpus is deliberately not
    // backfilled (owner decision Q2), so every run that finished before the analyzer
    // shipped carries no analysis forever. The card must therefore omit `code` entirely
    // rather than serialize a zeroed block — a zero reads as "wrote no code", which is a
    // different and false claim.
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();

    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let index: serde_json::Value = serde_json::from_slice(
        &snapshot
            .objects
            .iter()
            .find(|o| o.key == format!("{prefix}/runs.json"))
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert!(
        index["runs"][0]["code"].is_null(),
        "an unanalysed run's card must not claim a figure",
    );

    let parsed = run_document_json(&snapshot, "r1");
    assert!(parsed["codeAnalysisKey"].is_null());
}

#[tokio::test]
async fn an_analysed_run_whose_document_is_gone_still_publishes_its_summary() {
    // The backend store is an ephemeral emptyDir in production and there is no
    // artifact-service route for a tree-root file, so a run can legitimately reach a
    // refresh with its bounded summary on the record and no document bytes anywhere. The
    // card and the record still carry the figures; only the key is omitted, so the
    // explorer is simply not offered rather than offering a link that 404s.
    let (_tmp, store) = empty_store();
    let mut run = stored_run("r1", "2026-06-17T21:40:00Z");
    run.record.code_analysis = Some(code_analysis_summary());
    let snapshot = SnapshotBuilder::new(vec![run], vec![manifest()], store)
        .build(now())
        .await
        .unwrap();

    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let index: serde_json::Value = serde_json::from_slice(
        &snapshot
            .objects
            .iter()
            .find(|o| o.key == format!("{prefix}/runs.json"))
            .unwrap()
            .bytes,
    )
    .unwrap();
    assert_eq!(index["runs"][0]["code"]["codeLines"], 3);

    let parsed = run_document_json(&snapshot, "r1");
    assert!(
        parsed["codeAnalysisKey"].is_null(),
        "a key with no object behind it would 404 the Code tab",
    );
    assert!(
        !snapshot
            .objects
            .iter()
            .any(|o| o.key.contains("code-analysis")),
    );
}

// ── the gg document corpus ──────────────────────────────────────────────────

/// A gg document with the given id and a couple of fields, standing in for what
/// [`crate::gg_docs::public_documents`] hands the builder.
fn gg_doc(id: &str) -> test_cabinet_core::gg_query::GgRunDoc {
    let mut doc = test_cabinet_core::gg_query::GgRunDoc::default();
    doc.insert("id", id.to_string());
    doc.insert("case", "pong".to_string());
    doc.insert("metric.cost", 0.42);
    doc
}

#[tokio::test]
async fn the_gg_corpus_is_published_and_the_index_points_at_it() {
    // The whole public analysis payload is one object, and `index.json` is how the site
    // finds it — a key the site cannot resolve is the same as no corpus at all.
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(vec![], vec![], store)
        .with_gg_documents(vec![gg_doc("r1"), gg_doc("r2")])
        .build(now())
        .await
        .unwrap();

    let index: serde_json::Value = serde_json::from_slice(&snapshot.index.bytes).unwrap();
    let key = index["ggRunsKey"]
        .as_str()
        .expect("the index names the corpus");
    let object = snapshot
        .objects
        .iter()
        .find(|o| o.key == key)
        .expect("the corpus the index points at is uploaded");

    let corpus: serde_json::Value = serde_json::from_slice(&object.bytes).unwrap();
    assert_eq!(corpus["documents"].as_array().unwrap().len(), 2);
    assert_eq!(corpus["documents"][0]["fields"]["id"], "r1");
    // Its own build time, so a public figure can be rendered beside the instant it was
    // true rather than joined against the index at read time.
    assert_eq!(corpus["generatedAt"], index["generatedAt"]);
}

#[tokio::test]
async fn the_gg_corpus_passes_the_scrubber_like_every_other_public_object() {
    // R7, on the object this milestone adds. `build` scrubs the `PerRun` document by
    // walking it individually, so **every sibling object has to opt in** — a new one
    // reaches R2 unredacted by default, and that is a two-line change nothing else in
    // the builder would notice. A gg document is derived from a run's configuration, and
    // an operator who pasted a provider key into a capability parameter has put it into
    // a field short enough to survive the document's own redaction.
    let (_tmp, store) = empty_store();
    let mut leaky = gg_doc("r1");
    leaky.insert("cap.shell.env", "sk-ant-api03-notreal-value".to_string());

    let snapshot = SnapshotBuilder::new(vec![], vec![], store)
        .with_gg_documents(vec![leaky])
        .build(now())
        .await
        .unwrap();

    let object = snapshot
        .objects
        .iter()
        .find(|o| o.key.ends_with("/gg-runs.json"))
        .expect("the gg corpus");
    let body = String::from_utf8(object.bytes.clone()).unwrap();
    assert!(!body.contains("sk-ant-api03-notreal-value"));
    assert!(body.contains(test_cabinet_core::redact::PLACEHOLDER));
}

#[tokio::test]
async fn the_builder_redacts_the_corpus_itself_rather_than_trusting_its_caller() {
    // The other half of R7, and the one the scrubber cannot cover. A pasted system
    // prompt in a capability parameter is neither short nor key-shaped, so the scrubber
    // has nothing to match on: the *document* redaction is what drops it. Applying that
    // in the composer alone made it a caller's discipline at the one seam where the
    // object stops being a value in this process and becomes bytes in a public bucket —
    // so it is applied here too, which the idempotence of the rule makes free.
    let (_tmp, store) = empty_store();
    let mut leaky = gg_doc("r1");
    let pasted = "You are a careful reviewer. ".repeat(64);
    leaky.insert("cap.review.instructions", pasted.clone());

    let snapshot = SnapshotBuilder::new(vec![], vec![], store)
        .with_gg_documents(vec![leaky])
        .build(now())
        .await
        .unwrap();

    let object = snapshot
        .objects
        .iter()
        .find(|o| o.key.ends_with("/gg-runs.json"))
        .expect("the gg corpus");
    let body = String::from_utf8(object.bytes.clone()).unwrap();
    assert!(
        !body.contains("You are a careful reviewer"),
        "free text long enough to be prose never reaches the public object",
    );
    // And the corpus is still a corpus: redaction drops the field, not the document.
    let corpus: serde_json::Value = serde_json::from_slice(&object.bytes).unwrap();
    assert_eq!(corpus["documents"][0]["fields"]["id"], "r1");
}

#[tokio::test]
async fn a_replay_record_never_reaches_the_public_snapshot_even_beside_the_gg_corpus() {
    // Owner decision Q1 is a **hard** boundary, and this milestone is where it is most
    // at risk: the snapshot now carries gg data, so "the run's other gg artifact" is a
    // short step away. A session record is the complete model conversation verbatim; the
    // exported documents are configuration ids and outcome numbers. Only the second
    // travels.
    let (_tmp, store) = empty_store();
    store
        .write_run_artifact("r1", "replay", b"{\"text\":\"the-verbatim-conversation\"}")
        .unwrap();

    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![],
        store,
    )
    .with_gg_documents(vec![gg_doc("r1")])
    .build(now())
    .await
    .unwrap();

    for object in snapshot
        .objects
        .iter()
        .chain(std::iter::once(&snapshot.index))
    {
        assert!(
            !object.key.contains("replay"),
            "a replay artifact was published as `{}`",
            object.key
        );
        assert!(
            !String::from_utf8_lossy(&object.bytes).contains("the-verbatim-conversation"),
            "recorded conversation text leaked into `{}`",
            object.key
        );
    }
}

// --- Validator-rated runs in the snapshot ---------------------------------------

/// [`manifest`] moved onto the engine format, scoring two validated points: `serve`
/// (cap `broken`) and `hud` (cap `great`), both on the `gameplay` domain — so the
/// version is validator-rated and its runs are scored by their validators alone.
fn validator_manifest() -> StoredManifest {
    use crate::store::{StoredReviewItem, StoredReviewValidation};
    use test_cabinet_core::review::FailureCap;
    let point = |id: &str, cap: FailureCap| StoredReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        text: format!("The build satisfies {id}."),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight: 1,
        graded: false,
        domain: None,
        sub_items: vec![],
        validation: Some(StoredReviewValidation {
            script: format!("gameplay/{id}"),
            per_engine: true,
            outputs: vec![],
        }),
        failure_cap: Some(cap),
        domains: vec!["gameplay".to_string()],
    };
    let mut manifest = manifest();
    manifest.engine_format = true;
    manifest.common_review_items = vec![
        point("serve", FailureCap::Broken),
        point("hud", FailureCap::Great),
    ];
    manifest
}

/// [`stored_run`] with one decided validator verdict per `(point, pass)` pair and
/// no reviews at all — a validator-rated run the moment it completed.
fn validator_run(id: &str, published_at: &str, verdicts: &[(&str, bool)]) -> StoredRun {
    use test_cabinet_core::validation::AutoVerdict;
    let mut run = stored_run(id, published_at);
    run.reviews.clear();
    run.validator_rated = true;
    run.record.validation.debug_scripts = verdicts
        .iter()
        .map(|(point, pass)| DebugScriptResult {
            item_id: point.to_string(),
            sub_item_id: None,
            title: point.to_string(),
            category_title: point.to_string(),
            script: format!("gameplay/{point}"),
            gates: true,
            ran: true,
            precondition_unmet: false,
            detail: None,
            verdicts: vec![AutoVerdict {
                id: point.to_string(),
                pass: *pass,
                assertions: vec![],
            }],
            outputs: vec![],
        })
        .collect();
    run
}

#[test]
fn run_summary_score_is_the_validator_score_on_a_validator_rated_version() {
    let manifest = validator_manifest();
    let run = validator_run(
        "r1",
        "2026-06-17T21:40:00Z",
        &[("serve", true), ("hud", false)],
    );

    // Scored with no review at all: one of two points earned, `reviews` is zero.
    let score = run_summary_score(&manifest, &run.record, &run.reviews).unwrap();
    assert_eq!(score.earned, 1.0);
    assert_eq!(score.total, 2);
    assert_eq!(score.reviews, 0);
    assert_eq!(score.overall_grade, None);

    // The same run on the legacy format has no score until someone reviews it.
    let mut legacy = validator_manifest();
    legacy.engine_format = false;
    assert!(run_summary_score(&legacy, &run.record, &run.reviews).is_none());

    // The effective domains resolve from the stored manifest like the items do.
    let domains = domains_for(&manifest, "base");
    assert_eq!(domains.len(), 1);
    assert_eq!(domains[0].id, "gameplay");
}

#[tokio::test]
async fn a_validator_rated_run_is_summarized_by_its_validators_and_its_aesthetic_review() {
    use test_cabinet_core::review::{AestheticRating, DomainAesthetic};
    let (_tmp, store) = empty_store();
    // `r1` is unreviewed; `r2` carries one aesthetic review.
    let unreviewed = validator_run(
        "r1",
        "2026-06-17T21:40:00Z",
        &[("serve", true), ("hud", false)],
    );
    let mut reviewed = validator_run("r2", "2026-06-17T21:41:00Z", &[("serve", false)]);
    reviewed.reviews.push(StoredReview {
        reviewer: crate::db::Reviewer {
            user_id: "u1".to_string(),
            username: "ada".to_string(),
            display_name: "Ada L.".to_string(),
        },
        ratings: vec![],
        aesthetics: vec![DomainAesthetic {
            domain: "gameplay".to_string(),
            rating: AestheticRating::Legendary,
        }],
        writeup: "Breathtaking, even broken.".to_string(),
        checklist: vec![],
        reviewed_at: "2026-06-17T22:00:00Z".to_string(),
        edited_at: None,
        revisions: Vec::new(),
    });
    let snapshot = SnapshotBuilder::new(
        vec![unreviewed, reviewed],
        vec![validator_manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();

    let index = runs_index(&snapshot);
    let by_id = |id: &str| {
        index["runs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|run| run["id"] == id)
            .cloned()
            .unwrap()
    };
    let r1 = by_id("r1");
    assert_eq!(r1["validatorRated"], true);
    assert_eq!(
        r1["rating"], "great",
        "decided by the failing cosmetic point"
    );
    assert_eq!(r1["aesthetic"], serde_json::Value::Null);
    assert_eq!(r1["reviewCount"], 0);
    assert_eq!(r1["score"]["earned"], 1.0);
    assert_eq!(r1["score"]["total"], 2);
    assert_eq!(r1["score"]["reviews"], 0);

    let r2 = by_id("r2");
    assert_eq!(r2["rating"], "broken", "the review does not move it");
    assert_eq!(r2["aesthetic"], "legendary");
    assert_eq!(r2["reviewCount"], 1);

    // The run document carries the review's aesthetic channel, and the case
    // document says the version is on the engine format with each point's cap.
    let document = run_document_json(&snapshot, "r2");
    assert_eq!(
        document["reviews"][0]["aesthetics"][0]["domain"],
        "gameplay"
    );
    assert_eq!(
        document["reviews"][0]["aesthetics"][0]["rating"],
        "legendary"
    );
    assert!(
        document["reviews"][0]
            .get("ratings")
            .is_some_and(|r| r.as_array().unwrap().is_empty())
    );
    let case_obj = snapshot
        .objects
        .iter()
        .find(|o| o.key.ends_with("/cases/pong/v1.0.0.json"))
        .expect("case document");
    let case: serde_json::Value = serde_json::from_slice(&case_obj.bytes).unwrap();
    assert_eq!(case["engineFormat"], true);
    assert_eq!(case["commonReviewItems"][0]["failureCap"], "broken");
    assert_eq!(case["commonReviewItems"][0]["domains"][0], "gameplay");
    assert_eq!(case["commonReviewItems"][1]["failureCap"], "great");
}

#[tokio::test]
async fn a_legacy_run_summary_omits_the_aesthetic_channel() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .await
    .unwrap();
    let summary = runs_index(&snapshot)["runs"][0].clone();
    assert_eq!(summary["validatorRated"], false);
    assert_eq!(summary["aesthetic"], serde_json::Value::Null);
    assert_eq!(summary["rating"], "great");
    let document = run_document_json(&snapshot, "r1");
    assert!(document["reviews"][0].get("aesthetics").is_none());
    let case_obj = snapshot
        .objects
        .iter()
        .find(|o| o.key.ends_with("/cases/pong/v1.0.0.json"))
        .expect("case document");
    let case: serde_json::Value = serde_json::from_slice(&case_obj.bytes).unwrap();
    assert_eq!(case["engineFormat"], false);
}
