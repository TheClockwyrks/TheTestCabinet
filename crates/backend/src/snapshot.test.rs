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
use crate::store::{StoredBuild, StoredCheck, StoredManifest, StoredReference, StoredVariant};

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
                model_id: "claude-sonnet-4-5".to_string(),
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
            writeup: "Plays well.".to_string(),
            checklist: vec![],
            reviewed_at: "2026-06-17T22:00:00Z".to_string(),
            edited_at: None,
            revisions: Vec::new(),
        }],
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
        workspace: vec![],
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
    assert!(keys.contains(&format!("{prefix}/runs/r1.json").as_str()));
    assert!(keys.contains(&format!("{prefix}/cases/pong/v1.0.0.json").as_str()));
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
    assert_eq!(index["schemaVersion"], 1);
    assert_eq!(index["runCount"], 1);
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    assert_eq!(index["runsKey"], format!("{prefix}/runs.json"));
    assert_eq!(index["runsPrefix"], format!("{prefix}/runs/"));
    assert_eq!(index["casesPrefix"], format!("{prefix}/cases/"));
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/r1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/r1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/r1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    let find = |id: &str| -> serde_json::Value {
        let object = snapshot
            .objects
            .iter()
            .find(|o| o.key == format!("{prefix}/runs/{id}.json"))
            .unwrap();
        serde_json::from_slice(&object.bytes).unwrap()
    };

    // The recorded event stream is re-emitted verbatim into the per-run file.
    let r1 = find("r1");
    assert_eq!(r1["events"][0]["type"], "agent");
    assert_eq!(r1["events"][0]["message"], "hi");

    // A run that captured no events omits the field entirely.
    let r2 = find("r2");
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

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
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/a1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/r1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
    // An end-to-end run carries an empty assetMedia list and exports no asset objects.
    assert_eq!(parsed["assetMedia"].as_array().unwrap().len(), 0);
    assert!(!snapshot.objects.iter().any(|o| o.key.contains("/asset/")));
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
    // The seeded spec bodies are inlined: common ones at the case level, the
    // variant's own on the variant, each carrying its dest path and text.
    assert_eq!(parsed["commonSeededInputs"][0]["path"], "spec/rules.md");
    assert_eq!(parsed["commonSeededInputs"][0]["text"], "# Rules");
    // A common spec with no explicit role defaults to "spec".
    assert_eq!(parsed["commonSeededInputs"][0]["kind"], "spec");
    assert_eq!(parsed["variants"][0]["seededInputs"][0]["path"], "build.py");
    assert_eq!(parsed["variants"][0]["seededInputs"][0]["text"], "# build");
    // The script role survives ingest → snapshot, so the Inputs tab tags it "Script".
    assert_eq!(parsed["variants"][0]["seededInputs"][0]["kind"], "script");
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

    // The PNG bytes are exported under the case prefix with an image content type.
    let common_key = format!("{prefix}/cases/pong/v1.0.0/references/_common/gameplay.png");
    let common_obj = snapshot
        .objects
        .iter()
        .find(|o| o.key == common_key)
        .expect("common baseline exported");
    assert_eq!(common_obj.content_type, "image/png");
    assert_eq!(common_obj.bytes, b"png:_common/gameplay");
    let variant_key = format!("{prefix}/cases/pong/v1.0.0/references/base/title.png");
    assert!(snapshot.objects.iter().any(|o| o.key == variant_key));

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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

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
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/p1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

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
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/v1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "spin__still.png");
    assert_eq!(media[0]["key"], "media/runs/v1/validation/spin__still.png");
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    assert!(
        snapshot
            .objects
            .iter()
            .any(|o| o.key == "media/runs/v1/validation/ball-spin.stationary__still.png"),
        "the sub-item's media is exported under the composite verdict-id name"
    );
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/v1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
    let media = parsed["validationMedia"].as_array().unwrap();
    assert_eq!(media.len(), 1);
    assert_eq!(media[0]["file"], "ball-spin.stationary__still.png");
}

#[tokio::test]
async fn case_metadata_exports_validation_baselines_keyed_by_variant_and_file() {
    // A committed baseline still under the version's `validation-baseline/<variant>/`
    // dir (copied into the store verbatim at ingest).
    let m = manifest();
    let (_tmp, store) = empty_store();
    let baseline_dir = store
        .version_dir(&m.slug, &m.version)
        .join(test_cabinet_core::VALIDATION_BASELINE_DIR)
        .join("base");
    std::fs::create_dir_all(&baseline_dir).unwrap();
    std::fs::write(baseline_dir.join("spin__still.png"), b"png:baseline-still").unwrap();

    // The case is only emitted when a published run built it.
    let snapshot = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![m], store)
        .build(now())
        .await
        .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    // The PNG bytes are exported case-scoped under the version's baseline prefix.
    let key = format!("{prefix}/cases/pong/v1.0.0/validation-baseline/base/spin__still.png");
    let obj = snapshot
        .objects
        .iter()
        .find(|o| o.key == key)
        .expect("baseline validation media exported");
    assert_eq!(obj.content_type, "image/png");
    assert_eq!(obj.bytes, b"png:baseline-still");

    // The case metadata names it, carrying the variant and the flat requested name.
    let case = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/cases/pong/v1.0.0.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&case.bytes).unwrap();
    let baselines = parsed["validationBaselines"].as_array().unwrap();
    assert_eq!(baselines.len(), 1);
    assert_eq!(baselines[0]["variant"], "base");
    assert_eq!(baselines[0]["file"], "spin__still.png");
    assert_eq!(baselines[0]["key"], key);
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

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
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/p1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

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
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/v1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/p1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
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
async fn a_variant_carries_its_reference_build_url_when_one_is_supplied() {
    // The reference-implementation URL lives in the `case_reference_build` table
    // (written out-of-band by `tcab publish-reference`), not the manifest, so the
    // caller hands the builder a `(slug, version)` → (variant → URL) map. It must
    // land on the matching variant's `referenceBuild`, and a variant absent from the
    // map (here there is none — the case has a single `base` variant) exports null.
    let (_tmp, store) = empty_store();
    let mut builds = std::collections::HashMap::new();
    builds.insert(
        ("pong".to_string(), "v1.0.0".to_string()),
        std::collections::HashMap::from([(
            "base".to_string(),
            "https://carom-v1-0-0-base.test-cabinet-references.pages.dev".to_string(),
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
        parsed["variants"][0]["referenceBuild"],
        "https://carom-v1-0-0-base.test-cabinet-references.pages.dev"
    );
}

#[tokio::test]
async fn a_variant_without_a_reference_build_exports_null() {
    // No reference build supplied for this case → the variant's `referenceBuild` is
    // serialized as JSON null (the default), never omitted, so the site can rely on
    // the key's presence.
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
    assert!(parsed["variants"][0]["referenceBuild"].is_null());
}
