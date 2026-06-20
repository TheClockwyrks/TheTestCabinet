use super::*;
use tempfile::TempDir;
use test_cabinet_core::metrics::RunMetrics;
use test_cabinet_core::review::{DomainRating, Rating};
use test_cabinet_core::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_core::validation::{AssetGenResult, ValidationSummary};

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
        },
        review: StoredReview {
            ratings: vec![DomainRating {
                domain: "gameplay".to_string(),
                rating: Rating::Great,
            }],
            writeup: "Plays well.".to_string(),
            checklist: vec![],
        },
        links: RunLinks {
            source_repo: Some("https://github.com/x/y".to_string()),
            playable_build: Some("https://abc.pages.dev".to_string()),
        },
        published_at: published_at.to_string(),
        events_json: None,
    }
}

/// An asset-generation variant of [`stored_run`]: its `validation.asset` is
/// populated so the snapshot exports the run's media.
fn asset_run(id: &str, published_at: &str) -> StoredRun {
    let mut run = stored_run(id, published_at);
    run.record.subject.test_type = test_cabinet_core::TestType::AssetGeneration;
    run.record.validation.asset = Some(AssetGenResult {
        regenerated_image: "regenerated.png".to_string(),
        preview_image: "preview.png".to_string(),
        target_image: "target.png".to_string(),
        actions_log: "actions.json".to_string(),
        operation_count: 3,
        target_fidelity: 0.9,
        cheat_divergence: Some(0.05),
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
        max_runtime_seconds: 1800,
        test_type: test_cabinet_core::TestType::EndToEnd,
        build: Some(StoredBuild {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
        }),
        canvas: None,
        tool: None,
        output: None,
        prompt_template: "build it".to_string(),
        common_specs: vec![],
        workspace: vec![],
        init: None,
        assets: vec![],
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: Some("Standard".to_string()),
            specs: vec![],
            workspace: None,
            references: vec![],
            proofs: vec![],
            review_items: vec![],
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
    }
}

fn now() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_718_660_880).unwrap()
}

#[test]
fn snapshot_has_index_runs_per_run_and_case_objects() {
    let runs = vec![stored_run("r1", "2026-06-17T21:40:00Z")];
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(runs, vec![manifest()], store)
        .build(now())
        .unwrap();

    assert_eq!(snapshot.run_count, 1);
    assert_eq!(snapshot.index.key, "index.json");

    let keys: Vec<&str> = snapshot.objects.iter().map(|o| o.key.as_str()).collect();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    assert!(keys.contains(&format!("{prefix}/runs.json").as_str()));
    assert!(keys.contains(&format!("{prefix}/runs/r1.json").as_str()));
    assert!(keys.contains(&format!("{prefix}/cases/pong/v1.0.0.json").as_str()));
}

#[test]
fn index_points_at_the_versioned_prefix() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![],
        store,
    )
    .build(now())
    .unwrap();
    let index: serde_json::Value = serde_json::from_slice(&snapshot.index.bytes).unwrap();
    assert_eq!(index["schemaVersion"], 1);
    assert_eq!(index["runCount"], 1);
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);
    assert_eq!(index["runsKey"], format!("{prefix}/runs.json"));
    assert_eq!(index["runsPrefix"], format!("{prefix}/runs/"));
    assert_eq!(index["casesPrefix"], format!("{prefix}/cases/"));
}

#[test]
fn run_summary_carries_denormalized_case_name_and_camelcase_fields() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
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
    assert_eq!(summary["subject"]["harnessSlug"], "claude");
    assert_eq!(summary["links"]["playableBuild"], "https://abc.pages.dev");
}

#[test]
fn per_run_file_embeds_full_record_review_and_links() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
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
    assert_eq!(parsed["review"]["ratings"][0]["domain"], "gameplay");
    assert_eq!(parsed["review"]["ratings"][0]["rating"], "great");
    assert_eq!(parsed["review"]["writeup"], "Plays well.");
}

#[test]
fn per_run_file_includes_events_when_present_and_omits_them_when_absent() {
    let (_tmp, store) = empty_store();
    let mut with_events = stored_run("r1", "2026-06-17T21:40:00Z");
    with_events.events_json =
        Some(r#"[{"timestamp":"2026-06-17T20:41:00Z","type":"agent","message":"hi"}]"#.to_string());
    let without_events = stored_run("r2", "2026-06-17T21:41:00Z");
    let snapshot = SnapshotBuilder::new(vec![with_events, without_events], vec![manifest()], store)
        .build(now())
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

#[test]
fn per_run_file_exports_asset_media_and_names_it_by_key() {
    let (_tmp, store) = empty_store();
    // Stage the asset media the run uploaded; one of the four (target.png) is
    // deliberately absent to prove a missing file is skipped, not fatal.
    store
        .write_run_asset("a1", "regenerated.png", b"png:regen")
        .unwrap();
    store
        .write_run_asset("a1", "preview.png", b"png:preview")
        .unwrap();
    store.write_run_asset("a1", "actions.json", b"[]").unwrap();

    let snapshot = SnapshotBuilder::new(
        vec![asset_run("a1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
    .unwrap();
    let prefix = format!("snapshots/{}", snapshot.snapshot_id);

    // The staged bytes are exported under the run's asset prefix with a content
    // type that follows the extension.
    let regen_key = format!("{prefix}/runs/a1/asset/regenerated.png");
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
        .find(|o| o.key == format!("{prefix}/runs/a1/asset/actions.json"))
        .expect("action log exported");
    assert_eq!(actions.content_type, "application/json");

    // The per-run document names each present file by its served name + key; the
    // missing target.png is omitted.
    let per_run = snapshot
        .objects
        .iter()
        .find(|o| o.key == format!("{prefix}/runs/a1.json"))
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&per_run.bytes).unwrap();
    let media = parsed["assetMedia"].as_array().unwrap();
    let files: Vec<&str> = media.iter().map(|m| m["file"].as_str().unwrap()).collect();
    assert_eq!(
        files,
        vec!["regenerated.png", "preview.png", "actions.json"]
    );
    let regen_meta = media
        .iter()
        .find(|m| m["file"] == "regenerated.png")
        .unwrap();
    assert_eq!(regen_meta["key"], regen_key);
}

#[test]
fn per_run_file_omits_asset_media_for_a_non_asset_run() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(
        vec![stored_run("r1", "2026-06-17T21:40:00Z")],
        vec![manifest()],
        store,
    )
    .build(now())
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

#[test]
fn case_metadata_omits_specs_and_inlines_description() {
    let (_tmp, store) = empty_store();
    let snapshot = SnapshotBuilder::new(vec![], vec![manifest()], store)
        .build(now())
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
    assert_eq!(parsed["variants"][0]["slug"], "base");
    assert_eq!(parsed["checks"][0]["referenceView"], "title");
    // No spec bodies or prompt template leak into case metadata.
    assert!(parsed.get("commonSpecs").is_none());
    assert!(parsed.get("promptTemplate").is_none());
}

#[test]
fn case_metadata_exports_reference_baselines_and_names_them_by_key() {
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

    let snapshot = SnapshotBuilder::new(vec![], vec![m], store)
        .build(now())
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

#[test]
fn snapshot_id_changes_with_the_run_set() {
    let (_tmp_a, store_a) = empty_store();
    let a = SnapshotBuilder::new(vec![stored_run("r1", "t")], vec![], store_a)
        .build(now())
        .unwrap();
    let (_tmp_b, store_b) = empty_store();
    let b = SnapshotBuilder::new(
        vec![stored_run("r1", "t"), stored_run("r2", "t")],
        vec![],
        store_b,
    )
    .build(now())
    .unwrap();
    assert_ne!(a.snapshot_id, b.snapshot_id);
}
