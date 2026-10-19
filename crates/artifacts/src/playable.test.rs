//! Tests for discovering and serving a run's playable build and proof media.

use super::*;
use crate::object::collect_body;
use crate::store::testing::{memory_store, seed};

use test_cabinet_contracts::metrics::{Cost, RunMetrics, TokenCounts};
use test_cabinet_contracts::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_contracts::test_case::MediaKind;
use test_cabinet_contracts::validation::{
    AudioGenResult, MaterialGenResult, MaterialMapResult, ParticleGenResult, ProofResult,
    UiElementResult, UiGenResult, ValidationSummary, VoxelGenResult, VoxelPartResult,
};

#[test]
fn asset_request_parses_bare_names_and_per_frame_names() {
    // A single sprite uses bare names (its one frame, index 0); a sprite sheet
    // suffixes each frame with `-<index>`.
    assert_eq!(
        parse_asset_request("regenerated.png"),
        Some(("regenerated", None))
    );
    assert_eq!(parse_asset_request("actions.json"), Some(("actions", None)));
    assert_eq!(
        parse_asset_request("regenerated-3.png"),
        Some(("regenerated", Some(3)))
    );
    assert_eq!(
        parse_asset_request("preview-12.png"),
        Some(("preview", Some(12)))
    );
}

#[tokio::test]
async fn serve_asset_file_resolves_voxel_parts_by_flat_index() {
    // An animated voxel model addresses its parts by declared index: the served
    // `preview-0.png` / `mesh-1.glb` resolve to that part's recorded tree paths,
    // which carry slashes the flat one-segment served name flattens away.
    let part = |name: &str| VoxelPartResult {
        name: name.to_string(),
        mesh: format!("meshes/{name}.glb"),
        preview_image: format!("parts/{name}.png"),
        ops_log: format!("parts/{name}.actions.json"),
        operation_count: 3,
        voxel_count: 10,
        detail: None,
    };
    let voxel = VoxelGenResult {
        parts: vec![part("chassis"), part("turret")],
        // A present `model` marks this an animated run (parts addressed by `-<index>`).
        model: Some(test_cabinet_contracts::test_case::ModelSpec {
            parts: vec![],
            joints: vec![],
            animations: vec![],
        }),
        rig: None,
        skinned: false,
        blender: false,
        detail: None,
    };
    let dir = tree_with_validation(
        ValidationSummary {
            debug_scripts: Vec::new(),
            voxel: Some(voxel),
            ..Default::default()
        },
        &[
            ("meshes/turret.glb", b"glTF turret-mesh-bytes"),
            ("meshes/chassis.glb", b"glTF chassis-mesh-bytes"),
            ("parts/chassis.png", b"\x89PNG chassis-preview"),
        ],
    )
    .await;
    // Part 1 (turret) mesh; part 0 (chassis) mesh + preview. Cheat detection is
    // retired for voxel, so there is no regenerated PNG to serve.
    let served = asset(&dir, "mesh-1.glb").await.expect("mesh");
    assert_eq!(served.content_type, "model/gltf-binary");
    assert_eq!(served.body, b"glTF turret-mesh-bytes");
    // Part 0 (chassis) mesh.glb — the geometry the 3D client renders.
    let served = asset(&dir, "mesh-0.glb").await.expect("mesh");
    assert_eq!(served.content_type, "model/gltf-binary");
    assert_eq!(served.body, b"glTF chassis-mesh-bytes");
    let served = asset(&dir, "preview-0.png").await.expect("preview");
    assert_eq!(served.content_type, "image/png");
    assert_eq!(served.body, b"\x89PNG chassis-preview");
    // A voxel run serves no regenerated PNG.
    assert!(asset(&dir, "regenerated-1.png").await.is_none());
    // An out-of-range part index is a miss (404), not a panic.
    assert!(asset(&dir, "mesh-9.glb").await.is_none());
}

#[tokio::test]
async fn serve_asset_file_resolves_performance_scenarios_by_case_index() {
    // Browser playback fetches a run's scored scenario over the same
    // `/asset/{file}` path everything else uses, addressed by case index:
    // `scenario.json` is case 0, `scenario-<i>.json` selects case `i`.
    let case = |input: &str, scenario: Option<&str>| {
        test_cabinet_contracts::validation::PerformanceCaseResult {
            input: input.to_string(),
            kind: test_cabinet_contracts::validation::PerformanceCaseKind::Stress,
            correct: scenario.is_some(),
            over_ceiling: false,
            skipped: false,
            fuel: Some(10),
            first_mismatch_tick: None,
            detail: None,
            snapshots: Vec::new(),
            scenario_json: scenario.map(|s| s.to_string()),
        }
    };
    let performance = test_cabinet_contracts::validation::PerformanceResult {
        correct: false,
        total_fuel: None,
        fuel_limit: Some(5_000_000_000),
        cases: vec![
            case("cases/small.json", Some("performance/small.scenario.json")),
            case(
                "cases/medium.json",
                Some("performance/medium.scenario.json"),
            ),
            // A failing case records no scenario, so it has nothing to serve.
            case("cases/large.json", None),
        ],
        module_wasm: Some("engine.wasm".to_string()),
        detail: None,
    };
    let dir = tree_with_validation(
        ValidationSummary {
            performance: Some(performance),
            ..Default::default()
        },
        &[
            (
                "performance/small.scenario.json",
                b"{\"version\":1,\"n\":0}",
            ),
            (
                "performance/medium.scenario.json",
                b"{\"version\":1,\"n\":1}",
            ),
            // The run's engine module, uploaded under its `module_wasm` name — a
            // minimal wasm header is enough to prove the bytes round-trip.
            ("engine.wasm", b"\0asm\x01\0\0\0"),
        ],
    )
    .await;

    let served = asset(&dir, "scenario.json").await.expect("case 0");
    assert_eq!(served.content_type, "application/json");
    assert_eq!(served.body, b"{\"version\":1,\"n\":0}");
    let served = asset(&dir, "scenario-1.json").await.expect("case 1");
    assert_eq!(served.body, b"{\"version\":1,\"n\":1}");
    // The engine module is served under `engine.wasm` (parsed as kind `engine`)
    // with the wasm content type, so browser playback can load and step it.
    let served = asset(&dir, "engine.wasm").await.expect("engine module");
    assert_eq!(served.content_type, "application/wasm");
    assert_eq!(served.body, b"\0asm\x01\0\0\0");
    // A case that recorded no scenario is a miss, not a panic.
    assert!(asset(&dir, "scenario-2.json").await.is_none());
    // So is an out-of-range case index.
    assert!(asset(&dir, "scenario-9.json").await.is_none());
    // A performance run serves nothing else through this path.
    assert!(asset(&dir, "regenerated.png").await.is_none());
}

#[tokio::test]
async fn serve_asset_file_resolves_static_voxel_under_bare_names() {
    // A static model has one part served under bare names (frame `None`).
    let voxel = VoxelGenResult {
        parts: vec![VoxelPartResult {
            name: "model".to_string(),
            mesh: "mesh.glb".to_string(),
            preview_image: "model.png".to_string(),
            ops_log: "actions.json".to_string(),
            operation_count: 5,
            voxel_count: 20,
            detail: None,
        }],
        model: None,
        rig: None,
        skinned: false,
        blender: false,
        detail: None,
    };
    let dir = tree_with_validation(
        ValidationSummary {
            debug_scripts: Vec::new(),
            voxel: Some(voxel),
            ..Default::default()
        },
        &[
            ("mesh.glb", b"glTF static-mesh-bytes"),
            ("model.png", b"\x89PNG static-preview"),
        ],
    )
    .await;
    let served = asset(&dir, "mesh.glb").await.expect("mesh");
    assert_eq!(served.body, b"glTF static-mesh-bytes");
    let served = asset(&dir, "preview.png").await.expect("preview");
    assert_eq!(served.body, b"\x89PNG static-preview");
}

#[tokio::test]
async fn serve_asset_file_resolves_the_new_asset_families() {
    // UI kit: per-element PNGs by declared index, plus the `ui.json` manifest.
    let element = |name: &str, image: &str| UiElementResult {
        name: name.to_string(),
        image: image.to_string(),
        width: 512,
        height: 320,
        nine_slice: None,
        detail: None,
    };
    let dir = tree_with_validation(
        ValidationSummary {
            debug_scripts: Vec::new(),
            ui: Some(UiGenResult {
                elements: vec![
                    element("panel", "elements/panel.png"),
                    element("button", "elements/button.png"),
                ],
                detail: None,
            }),
            ..Default::default()
        },
        &[
            ("elements/panel.png", b"\x89PNG panel"),
            ("elements/button.png", b"\x89PNG button"),
            ("ui.json", b"{\"elements\":[]}"),
        ],
    )
    .await;
    assert_eq!(
        asset(&dir, "element-1.png").await.expect("element").body,
        b"\x89PNG button"
    );
    let served = asset(&dir, "ui.json").await.expect("ui.json");
    assert_eq!(served.content_type, "application/json");
    assert_eq!(served.body, b"{\"elements\":[]}");
    // An out-of-range element index is a miss (404), not a panic.
    assert!(asset(&dir, "element-9.png").await.is_none());

    // Material: each map by its declared index, plus `material.json`.
    let dir = tree_with_validation(
        ValidationSummary {
            debug_scripts: Vec::new(),
            material: Some(MaterialGenResult {
                maps: vec![
                    MaterialMapResult {
                        name: "base-color".to_string(),
                        image: "maps/base-color.png".to_string(),
                        color_space: "srgb".to_string(),
                        detail: None,
                    },
                    MaterialMapResult {
                        name: "normal".to_string(),
                        image: "maps/normal.png".to_string(),
                        color_space: "linear".to_string(),
                        detail: None,
                    },
                ],
                size: 512,
                tiling: Some(1.0),
                detail: None,
            }),
            ..Default::default()
        },
        &[
            ("maps/base-color.png", b"\x89PNG base"),
            ("maps/normal.png", b"\x89PNG norm"),
        ],
    )
    .await;
    assert_eq!(
        asset(&dir, "map-0.png").await.expect("map").body,
        b"\x89PNG base"
    );
    assert_eq!(
        asset(&dir, "map-1.png").await.expect("map").body,
        b"\x89PNG norm"
    );

    // Particle: the authored `system.json` and the preview GIF (new content type).
    let dir = tree_with_validation(
        ValidationSummary {
            debug_scripts: Vec::new(),
            particle: Some(ParticleGenResult {
                system: "system.json".to_string(),
                preview: Some("effect.gif".to_string()),
                emitter_count: 2,
                detail: None,
            }),
            ..Default::default()
        },
        &[
            ("system.json", b"{\"emitters\":[]}"),
            ("effect.gif", b"GIF89a-bytes"),
        ],
    )
    .await;
    let served = asset(&dir, "system.json").await.expect("system");
    assert_eq!(served.content_type, "application/json");
    let served = asset(&dir, "preview.gif").await.expect("gif");
    assert_eq!(served.content_type, "image/gif");
    assert_eq!(served.body, b"GIF89a-bytes");

    // Audio: `clip.wav`, the music-only `score.mid`, and the waveform preview PNG.
    let dir = tree_with_validation(
        ValidationSummary {
            debug_scripts: Vec::new(),
            audio: Some(AudioGenResult {
                clip: "clip.wav".to_string(),
                midi: Some("clip.mid".to_string()),
                preview: Some("waveform.png".to_string()),
                sample_rate: 44100,
                channels: 2,
                duration_ms: 1200,
                detail: None,
            }),
            ..Default::default()
        },
        &[
            ("clip.wav", b"RIFF-wav-bytes"),
            ("clip.mid", b"MThd-midi-bytes"),
            ("waveform.png", b"\x89PNG wave"),
        ],
    )
    .await;
    let served = asset(&dir, "clip.wav").await.expect("wav");
    assert_eq!(served.content_type, "audio/wav");
    assert_eq!(served.body, b"RIFF-wav-bytes");
    let served = asset(&dir, "score.mid").await.expect("mid");
    assert_eq!(served.content_type, "audio/midi");
    assert_eq!(served.body, b"MThd-midi-bytes");
    assert_eq!(
        asset(&dir, "preview.png").await.expect("preview").body,
        b"\x89PNG wave"
    );
}

/// Build a run output directory holding a `run-record.json` whose validation
/// declares the given proofs (id, dest), plus the named media files under
/// `implementation/`.
async fn tree_with_proofs(proofs: &[(&str, &str, MediaKind)], media: &[(&str, &[u8])]) -> RunTree {
    let validation = ValidationSummary {
        debug_scripts: Vec::new(),
        proofs: proofs
            .iter()
            .map(|(id, dest, kind)| ProofResult {
                id: id.to_string(),
                name: id.to_string(),
                kind: *kind,
                dest: dest.to_string(),
                present: true,
                detail: None,
            })
            .collect(),
        ..Default::default()
    };
    tree_with_validation(validation, media).await
}

/// Build a run output directory holding a `run-record.json` with the given
/// validation summary, plus the named media files under `implementation/`.
async fn tree_with_validation(validation: ValidationSummary, media: &[(&str, &[u8])]) -> RunTree {
    let record = RunRecord {
        id: "run-1".to_string(),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        finished_at: "2026-06-14T10:05:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_contracts::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            orchestrator_slug: "one-shot".to_string(),
            engine_slug: "none".to_string(),
            engine_version: None,
            model_id: "anthropic/claude-opus-4".to_string(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".to_string(),
            container_image: "img:latest".to_string(),
            node_version: None,
            auth_mode: test_cabinet_contracts::run_record::AuthMode::ApiKey,
        },
        metrics: RunMetrics {
            run_time_seconds: 1.0,
            tokens: TokenCounts {
                uncached_input: Some(0),
                cached_input: Some(0),
                output: Some(0),
                reasoning: Some(0),
            },
            cost: Cost {
                comparable: Some(0.0),
                actual: Some(0.0),
            },
            ..RunMetrics::default()
        },
        validation,
        links: RunLinks {
            source_repo: None,
            playable_build: None,
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
    };
    let record = serde_json::to_vec(&record).expect("serialize record");
    let paths: Vec<String> = media
        .iter()
        .map(|(rel, _)| format!("implementation/{rel}"))
        .collect();
    let mut entries: Vec<(&str, &[u8])> = vec![("run-record.json", &record)];
    entries.extend(
        paths
            .iter()
            .map(String::as_str)
            .zip(media.iter().map(|(_, bytes)| *bytes)),
    );
    tree_of(&entries).await
}

/// A stored tree of `entries`, as run `run-1`.
async fn tree_of(entries: &[(&str, &[u8])]) -> RunTree {
    let (store, _objects) = memory_store();
    seed(&store, "run-1", entries).await;
    store.run_tree("run-1").await.expect("the tree")
}

/// What a resolver served, collected.
#[derive(Debug, PartialEq, Eq)]
struct Got {
    content_type: &'static str,
    content_encoding: Option<&'static str>,
    body: Vec<u8>,
}

/// Collect `served`, holding its declared length to its body.
async fn got(served: Result<Option<Served>, StoreError>) -> Option<Got> {
    let served = served.expect("the store answered")?;
    let length = served.content_length;
    let body = collect_body(served.body).await.expect("the body");
    assert_eq!(
        length,
        Some(body.len() as u64),
        "the declared length is the body's"
    );
    Some(Got {
        content_type: served.content_type,
        content_encoding: served.content_encoding,
        body,
    })
}

async fn proof(tree: &RunTree, file: &str) -> Option<Got> {
    got(serve_proof_file(tree, file).await).await
}

async fn asset(tree: &RunTree, file: &str) -> Option<Got> {
    got(serve_asset_file(tree, file).await).await
}

async fn validation(tree: &RunTree, file: &str) -> Option<Got> {
    got(serve_validation_file(tree, file).await).await
}

async fn showcase(tree: &RunTree, file: &str) -> Option<Got> {
    got(serve_showcase_file(tree, file).await).await
}

#[tokio::test]
async fn serves_proof_media_by_id_at_its_recorded_dest() {
    // The request file is `<proof-id>.<ext>`; the media lives at the proof's
    // recorded `dest`, which need not match the request extension.
    let dir = tree_with_proofs(
        &[("rally", "evidence/clip.mp4", MediaKind::Video)],
        &[("evidence/clip.mp4", b"\x00\x00\x00 ftypisom")],
    )
    .await;
    let served = proof(&dir, "rally.mp4").await.expect("proof served");
    assert_eq!(served.content_type, "video/mp4");
    assert_eq!(served.body, b"\x00\x00\x00 ftypisom");
}

#[tokio::test]
async fn proof_labels_follow_the_recorded_dest() {
    let dir = tree_with_proofs(
        &[("title", "proof/title.png", MediaKind::Image)],
        &[("proof/title.png", b"\x89PNG\r\n")],
    )
    .await;
    let served = proof(&dir, "title.png").await.unwrap();
    assert_eq!(served.content_type, "image/png");
    assert_eq!(served.content_encoding, None);
}

#[tokio::test]
async fn a_proof_recording_keeps_its_compound_suffix_through_the_labels() {
    // A proof is addressed as `<id>.<ext>`, which keeps only the last extension, so
    // the request name alone says `gz` and cannot tell a framed document from a gzip
    // one. The recorded dest carries the whole `.json.gz`, and that is what decides.
    let dir = tree_with_proofs(
        &[("rally", "proof/rally.json.gz", MediaKind::Replay)],
        &[("proof/rally.json.gz", &[0x1f, 0x8b, 0x08, 0x00])],
    )
    .await;
    let served = proof(&dir, "rally.gz").await.expect("proof served");
    assert_eq!(served.content_type, "application/json");
    assert_eq!(served.content_encoding, Some("gzip"));
}

#[tokio::test]
async fn serves_a_webm_clip_verbatim_from_the_tree() {
    // A run captures its clip as webm; the live path serves it as-is (only the
    // public snapshot transcodes to mp4).
    let dir = tree_with_proofs(
        &[("rally", "proof/rally.webm", MediaKind::Video)],
        &[("proof/rally.webm", b"\x1aE\xdf\xa3webm")],
    )
    .await;
    let served = proof(&dir, "rally.webm").await.expect("proof served");
    assert_eq!(served.content_type, "video/webm");
    assert_eq!(served.body, b"\x1aE\xdf\xa3webm");
}

#[tokio::test]
async fn unknown_proof_id_is_none() {
    let dir = tree_with_proofs(
        &[("title", "proof/title.png", MediaKind::Image)],
        &[("proof/title.png", b"x")],
    )
    .await;
    assert_eq!(proof(&dir, "missing.png").await, None);
}

#[tokio::test]
async fn declared_proof_with_no_media_on_disk_is_none() {
    // The proof is declared but its file was never written (a missing proof).
    let dir = tree_with_proofs(&[("title", "proof/title.png", MediaKind::Image)], &[]).await;
    assert_eq!(proof(&dir, "title.png").await, None);
}

#[tokio::test]
async fn proof_without_a_record_is_none() {
    let dir = tree_of(&[("implementation/proof/title.png", b"x")]).await;
    assert_eq!(proof(&dir, "title.png").await, None);
}

#[tokio::test]
async fn serves_synthesized_validation_media_from_the_collected_tree() {
    // Validation media is stored flat under `.vendor/validation/` and served by its
    // exact addressable name — actual and its `.baseline` sibling.
    let dir = tree_with_validation(
        ValidationSummary::default(),
        &[
            (".vendor/validation/spin__rally.webm", b"webm-bytes"),
            (
                ".vendor/validation/spin__rally.baseline.webm",
                b"baseline-bytes",
            ),
        ],
    )
    .await;
    let actual = validation(&dir, "spin__rally.webm")
        .await
        .expect("actual served");
    assert_eq!(actual.content_type, "video/webm");
    assert_eq!(actual.body, b"webm-bytes");
    let baseline = validation(&dir, "spin__rally.baseline.webm")
        .await
        .expect("baseline served");
    assert_eq!(baseline.body, b"baseline-bytes");
}

#[tokio::test]
async fn serves_validation_media_a_run_collected_under_the_previous_host_namespace() {
    // Trees collected before the host namespace was renamed to `.vendor` hold the same
    // media under `.tcab/`. Those runs are immutable, so the rename must not turn a
    // reviewer's already-recorded proof into a 404.
    let dir = tree_with_validation(
        ValidationSummary::default(),
        &[(".tcab/validation/spin__rally.webm", b"legacy-bytes")],
    )
    .await;
    let served = validation(&dir, "spin__rally.webm")
        .await
        .expect("legacy served");
    assert_eq!(served.content_type, "video/webm");
    assert_eq!(served.body, b"legacy-bytes");
}

#[tokio::test]
async fn a_served_recording_is_labelled_as_the_framed_json_it_is() {
    // A recording is stored and served compressed. The bytes travel exactly as they
    // are stored, and the response says both what the resource is and how the body
    // is framed, so the browser inflates it and the player parses JSON.
    let dir = tree_with_validation(
        ValidationSummary::default(),
        &[(
            ".vendor/validation/no-tunnel__serve.json.gz",
            &[0x1f, 0x8b, 0x08, 0x00],
        )],
    )
    .await;
    let served = validation(&dir, "no-tunnel__serve.json.gz")
        .await
        .expect("recording served");
    assert_eq!(served.content_type, "application/json");
    assert_eq!(served.content_encoding, Some("gzip"));
    assert_eq!(served.body, vec![0x1f, 0x8b, 0x08, 0x00]);
}

#[tokio::test]
async fn a_served_still_declares_no_framing() {
    let dir = tree_with_validation(
        ValidationSummary::default(),
        &[(".vendor/validation/no-tunnel__serve.png", b"png-bytes")],
    )
    .await;
    let served = validation(&dir, "no-tunnel__serve.png")
        .await
        .expect("still served");
    assert_eq!(served.content_type, "image/png");
    assert_eq!(served.content_encoding, None);
}

#[tokio::test]
async fn a_recordings_shared_image_store_is_served_from_the_same_flat_namespace() {
    // The store is what a recording's image entries name instead of carrying base64
    // of their pixels, and it is deliberately *not* a new kind of resource: the files
    // sit in the validation media directory under flat single-segment names, so this
    // route serves them with no change and the console resolves them through the very
    // lookup it resolved the recording with.
    let dir = tree_with_validation(
        ValidationSummary::default(),
        &[
            (".vendor/validation/img.9f2c1ab4.png", b"\x89PNG-sprite"),
            (".vendor/validation/img.7ee01d33.bin", b"\x01\x02\x03\x04"),
        ],
    )
    .await;

    let bitmap = validation(&dir, "img.9f2c1ab4.png")
        .await
        .expect("bitmap served");
    assert_eq!(bitmap.content_type, "image/png");
    assert_eq!(bitmap.content_encoding, None);

    // A pixel buffer is four raw bytes per pixel with no header of its own — the
    // entry that names it carries the dimensions — so it is served as the opaque
    // stream it is, unframed, and the player reads its length against those.
    let pixels = validation(&dir, "img.7ee01d33.bin")
        .await
        .expect("pixels served");
    assert_eq!(pixels.content_type, "application/octet-stream");
    assert_eq!(pixels.content_encoding, None);
    assert_eq!(pixels.body, b"\x01\x02\x03\x04".to_vec());
}

#[tokio::test]
async fn validation_media_requests_cannot_escape_the_dir() {
    let dir = tree_with_validation(ValidationSummary::default(), &[]).await;
    // A traversal or nested path is refused; a missing file is a plain miss.
    assert!(validation(&dir, "../run-record.json").await.is_none());
    assert!(validation(&dir, "sub/inner.png").await.is_none());
    assert!(validation(&dir, "missing.png").await.is_none());
}

#[tokio::test]
async fn serves_showcase_files_from_the_collected_tree() {
    // Showcase files are stored flat under `implementation/showcase/` and served by
    // their plain names — the carousel media, an image the description references,
    // and the description file itself. The manifest is refused: it is capture-side
    // input, already folded into the record, and the backend store never holds it.
    let dir = tree_of(&[
        ("implementation/showcase/title.png", b"png-bytes"),
        ("implementation/showcase/showcase.md", b"# My Game"),
        ("implementation/showcase/showcase.toml", b"[[media]]"),
        (
            "implementation/showcase/clip.json.gz",
            &[0x1f, 0x8b, 0x08, 0x00],
        ),
    ])
    .await;

    let image = showcase(&dir, "title.png").await.expect("image served");
    assert_eq!(image.content_type, "image/png");
    assert_eq!(image.body, b"png-bytes");
    let description = showcase(&dir, "showcase.md")
        .await
        .expect("description served");
    assert_eq!(description.content_type, "text/markdown; charset=utf-8");
    // A showcase replay is a JSON document travelling gzip-framed, exactly as a
    // validation recording is, so the browser inflates it before the player sees it.
    let replay = showcase(&dir, "clip.json.gz").await.expect("replay served");
    assert_eq!(replay.content_type, "application/json");
    assert_eq!(replay.content_encoding, Some("gzip"));
    assert_eq!(replay.body, vec![0x1f, 0x8b, 0x08, 0x00]);

    assert!(showcase(&dir, "showcase.toml").await.is_none());
    // A traversal or nested path is refused; a missing file is a plain miss.
    assert!(showcase(&dir, "../run-record.json").await.is_none());
    assert!(showcase(&dir, "sub/inner.png").await.is_none());
    assert!(showcase(&dir, "missing.png").await.is_none());
}

#[tokio::test]
async fn the_build_output_is_chosen_by_the_contracts_priority() {
    // `dist` outranks `build`, which outranks `out`; a file named like an output is
    // not a directory, and other directories are ignored.
    let tree = tree_of(&[
        ("implementation/out/index.html", b"out"),
        ("implementation/build/index.html", b"build"),
        ("implementation/dist", b"a file, not a build"),
        ("implementation/src/main.ts", b"ts"),
    ])
    .await;
    assert_eq!(find_build_output(&tree).await.unwrap(), Some("build"));

    let tree = tree_of(&[("implementation/src/main.ts", b"ts")]).await;
    assert_eq!(find_build_output(&tree).await.unwrap(), None);
}

/// The build files a golden comparison serves, relative to the build root.
const BUILD_FILES: &[(&str, &[u8])] = &[
    (
        "index.html",
        b"<html><head><script src=\"/assets/app.js\"></script></head><body>hi</body></html>",
    ),
    (
        "sub/index.html",
        b"<html><head></head><body><img src=\"/a.png\"></body></html>",
    ),
    ("assets/app.js", b"console.log('/assets/x')"),
    ("assets/style.CSS", b"body{}"),
    ("a.png", b"\x89PNG"),
    ("data.bin", &[0, 1, 2, 3]),
];

#[tokio::test]
async fn a_build_is_served_from_objects_exactly_as_contracts_serves_it_from_files() {
    // The rule is the contracts crate's; this holds the object-keyed serving to it
    // end to end: the same file chosen for every request path (the root and a
    // directory serve their `index.html`, a `..` is refused), the same content
    // type, and the same relocated HTML, byte for byte.
    let dir = tempfile::TempDir::new().unwrap();
    for (rel, bytes) in BUILD_FILES {
        let target = dir.path().join("dist").join(rel);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, bytes).unwrap();
    }
    let entries: Vec<(String, &[u8])> = BUILD_FILES
        .iter()
        .map(|(rel, bytes)| (format!("implementation/dist/{rel}"), *bytes))
        .collect();
    let entries: Vec<(&str, &[u8])> = entries
        .iter()
        .map(|(path, bytes)| (path.as_str(), *bytes))
        .collect();
    let tree = tree_of(&entries).await;
    let build = find_build_output(&tree).await.unwrap().expect("a build");
    assert_eq!(build, "dist");

    let base = "/artifacts/runs/run-1/build/";
    for request in [
        "",
        "/",
        ".",
        "index.html",
        "./index.html",
        "sub",
        "sub/",
        "sub//index.html",
        "assets/app.js",
        "assets/style.CSS",
        "a.png",
        "data.bin",
        "assets",
        "missing.js",
        "../x",
        "sub/../index.html",
        "../../etc/passwd",
    ] {
        let expected = test_cabinet_contracts::layout::serve_build_file(
            &dir.path().join("dist"),
            request,
            base,
        )
        .map(|file| (file.content_type, file.body));
        let served = serve_build_file(&tree, build, request, base).await.unwrap();
        let actual = match served {
            Some(served) => {
                assert_eq!(served.content_encoding, None);
                let length = served.content_length;
                let body = collect_body(served.body).await.unwrap();
                assert_eq!(length, Some(body.len() as u64));
                Some((served.content_type, body))
            }
            None => None,
        };
        assert_eq!(actual, expected, "request `{request}`");
    }
}
