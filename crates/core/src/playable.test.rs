//! Tests for discovering and serving a run's playable build and proof media.

use super::*;
use std::fs;
use tempfile::TempDir;

use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use crate::test_case::MediaKind;
use crate::validation::{
    AudioGenResult, MaterialGenResult, MaterialMapResult, ParticleGenResult, ProofResult,
    UiElementResult, UiGenResult, ValidationSummary, VoxelGenResult, VoxelPartResult,
};

/// Build a fake implementation directory containing one named build output with
/// the given files (path within the build → contents).
fn impl_with_build(output: &str, files: &[(&str, &str)]) -> TempDir {
    let dir = TempDir::new().expect("temp dir");
    let build = dir.path().join("implementation").join(output);
    for (rel, contents) in files {
        let target = build.join(rel);
        fs::create_dir_all(target.parent().unwrap()).expect("create dirs");
        fs::write(target, contents).expect("write file");
    }
    dir
}

#[test]
fn find_build_output_prefers_dist_then_build_then_out() {
    let dir = impl_with_build("out", &[("index.html", "<html></html>")]);
    let impl_dir = dir.path().join("implementation");
    assert_eq!(find_build_output(&impl_dir), Some(impl_dir.join("out")));

    // `dist` wins when several exist, matching BUILD_OUTPUTS priority.
    fs::create_dir_all(impl_dir.join("build")).unwrap();
    fs::create_dir_all(impl_dir.join("dist")).unwrap();
    assert_eq!(find_build_output(&impl_dir), Some(impl_dir.join("dist")));
}

#[test]
fn find_build_output_is_none_without_a_build() {
    let dir = TempDir::new().unwrap();
    let impl_dir = dir.path().join("implementation");
    fs::create_dir_all(&impl_dir).unwrap();
    assert_eq!(find_build_output(&impl_dir), None);
}

#[test]
fn empty_path_serves_index_html() {
    let dir = impl_with_build("dist", &[("index.html", "<html><head></head></html>")]);
    let build = dir.path().join("implementation").join("dist");
    let served = serve_build_file(&build, "", "/runs/abc/build/").expect("index served");
    assert!(served.content_type.starts_with("text/html"));
    assert!(String::from_utf8(served.body).unwrap().contains("<base"));
}

#[test]
fn html_is_relocated_under_the_base() {
    let html = "<html><head>\n<script type=\"module\" src=\"/assets/index-AAA.js\"></script>\
        </head><body></body></html>";
    let dir = impl_with_build("dist", &[("index.html", html)]);
    let build = dir.path().join("implementation").join("dist");
    let served = serve_build_file(&build, "index.html", "/runs/abc/build/").unwrap();
    let body = String::from_utf8(served.body).unwrap();
    // The base is injected and the absolute asset reference is de-absolutized so
    // the base applies to it.
    assert!(body.contains("<base href=\"/runs/abc/build/\">"));
    assert!(body.contains("src=\"assets/index-AAA.js\""));
    assert!(!body.contains("src=\"/assets/index-AAA.js\""));
}

#[test]
fn protocol_relative_and_scheme_urls_are_left_alone() {
    let html = "<head></head><body>\
        <img src=\"//cdn.example/x.png\"><a href=\"https://example.com\">x</a></body>";
    let dir = impl_with_build("dist", &[("index.html", html)]);
    let build = dir.path().join("implementation").join("dist");
    let body = serve_build_file(&build, "", "/b/").unwrap().body;
    let body = String::from_utf8(body).unwrap();
    assert!(body.contains("src=\"//cdn.example/x.png\""));
    assert!(body.contains("href=\"https://example.com\""));
}

#[test]
fn non_html_assets_are_served_verbatim_with_a_mime_type() {
    let dir = impl_with_build(
        "dist",
        &[("assets/index-AAA.js", "console.log('/not/rewritten')")],
    );
    let build = dir.path().join("implementation").join("dist");
    let served = serve_build_file(&build, "assets/index-AAA.js", "/b/").unwrap();
    assert!(served.content_type.starts_with("text/javascript"));
    // JS is byte-for-byte: an absolute path in a string literal is not touched.
    assert_eq!(served.body, b"console.log('/not/rewritten')");
}

#[test]
fn traversal_outside_the_build_is_refused() {
    let dir = impl_with_build("dist", &[("index.html", "<html></html>")]);
    // A secret beside (not inside) the build.
    fs::write(dir.path().join("implementation").join("secret"), "nope").unwrap();
    let build = dir.path().join("implementation").join("dist");
    assert_eq!(serve_build_file(&build, "../secret", "/b/"), None);
}

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

#[test]
fn serve_asset_file_resolves_voxel_parts_by_flat_index() {
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
        model: Some(crate::test_case::ModelSpec {
            parts: vec![],
            joints: vec![],
            animations: vec![],
        }),
        rig: None,
        skinned: false,
        detail: None,
    };
    let dir = run_dir_with_validation(
        ValidationSummary {
            voxel: Some(voxel),
            ..Default::default()
        },
        &[
            ("meshes/turret.glb", b"glTF turret-mesh-bytes"),
            ("meshes/chassis.glb", b"glTF chassis-mesh-bytes"),
            ("parts/chassis.png", b"\x89PNG chassis-preview"),
        ],
    );
    // Part 1 (turret) mesh; part 0 (chassis) mesh + preview. Cheat detection is
    // retired for voxel, so there is no regenerated PNG to serve.
    let served = serve_asset_file(dir.path(), "mesh-1.glb").expect("mesh");
    assert_eq!(served.content_type, "model/gltf-binary");
    assert_eq!(served.body, b"glTF turret-mesh-bytes");
    // Part 0 (chassis) mesh.glb — the geometry the 3D client renders.
    let served = serve_asset_file(dir.path(), "mesh-0.glb").expect("mesh");
    assert_eq!(served.content_type, "model/gltf-binary");
    assert_eq!(served.body, b"glTF chassis-mesh-bytes");
    let served = serve_asset_file(dir.path(), "preview-0.png").expect("preview");
    assert_eq!(served.content_type, "image/png");
    assert_eq!(served.body, b"\x89PNG chassis-preview");
    // A voxel run serves no regenerated PNG.
    assert!(serve_asset_file(dir.path(), "regenerated-1.png").is_none());
    // An out-of-range part index is a miss (404), not a panic.
    assert!(serve_asset_file(dir.path(), "mesh-9.glb").is_none());
}

#[test]
fn serve_asset_file_resolves_static_voxel_under_bare_names() {
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
        detail: None,
    };
    let dir = run_dir_with_validation(
        ValidationSummary {
            voxel: Some(voxel),
            ..Default::default()
        },
        &[
            ("mesh.glb", b"glTF static-mesh-bytes"),
            ("model.png", b"\x89PNG static-preview"),
        ],
    );
    let served = serve_asset_file(dir.path(), "mesh.glb").expect("mesh");
    assert_eq!(served.body, b"glTF static-mesh-bytes");
    let served = serve_asset_file(dir.path(), "preview.png").expect("preview");
    assert_eq!(served.body, b"\x89PNG static-preview");
}

#[test]
fn serve_asset_file_resolves_the_new_asset_families() {
    // UI kit: per-element PNGs by declared index, plus the `ui.json` manifest.
    let element = |name: &str, image: &str| UiElementResult {
        name: name.to_string(),
        image: image.to_string(),
        width: 512,
        height: 320,
        nine_slice: None,
        detail: None,
    };
    let dir = run_dir_with_validation(
        ValidationSummary {
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
    );
    assert_eq!(
        serve_asset_file(dir.path(), "element-1.png")
            .expect("element")
            .body,
        b"\x89PNG button"
    );
    let served = serve_asset_file(dir.path(), "ui.json").expect("ui.json");
    assert_eq!(served.content_type, "application/json");
    assert_eq!(served.body, b"{\"elements\":[]}");
    // An out-of-range element index is a miss (404), not a panic.
    assert!(serve_asset_file(dir.path(), "element-9.png").is_none());

    // Material: each map by its declared index, plus `material.json`.
    let dir = run_dir_with_validation(
        ValidationSummary {
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
    );
    assert_eq!(
        serve_asset_file(dir.path(), "map-0.png").expect("map").body,
        b"\x89PNG base"
    );
    assert_eq!(
        serve_asset_file(dir.path(), "map-1.png").expect("map").body,
        b"\x89PNG norm"
    );

    // Particle: the authored `system.json` and the preview GIF (new content type).
    let dir = run_dir_with_validation(
        ValidationSummary {
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
    );
    let served = serve_asset_file(dir.path(), "system.json").expect("system");
    assert_eq!(served.content_type, "application/json");
    let served = serve_asset_file(dir.path(), "preview.gif").expect("gif");
    assert_eq!(served.content_type, "image/gif");
    assert_eq!(served.body, b"GIF89a-bytes");

    // Audio: `clip.wav`, the music-only `score.mid`, and the waveform preview PNG.
    let dir = run_dir_with_validation(
        ValidationSummary {
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
    );
    let served = serve_asset_file(dir.path(), "clip.wav").expect("wav");
    assert_eq!(served.content_type, "audio/wav");
    assert_eq!(served.body, b"RIFF-wav-bytes");
    let served = serve_asset_file(dir.path(), "score.mid").expect("mid");
    assert_eq!(served.content_type, "audio/midi");
    assert_eq!(served.body, b"MThd-midi-bytes");
    assert_eq!(
        serve_asset_file(dir.path(), "preview.png")
            .expect("preview")
            .body,
        b"\x89PNG wave"
    );
}

#[test]
fn missing_file_is_none() {
    let dir = impl_with_build("dist", &[("index.html", "<html></html>")]);
    let build = dir.path().join("implementation").join("dist");
    assert_eq!(serve_build_file(&build, "does-not-exist.js", "/b/"), None);
}

/// Build a run output directory holding a `run-record.json` whose validation
/// declares the given proofs (id, dest), plus the named media files under
/// `implementation/`.
fn run_dir_with_proofs(proofs: &[(&str, &str, MediaKind)], media: &[(&str, &[u8])]) -> TempDir {
    let validation = ValidationSummary {
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
    run_dir_with_validation(validation, media)
}

/// Build a run output directory holding a `run-record.json` with the given
/// validation summary, plus the named media files under `implementation/`.
fn run_dir_with_validation(validation: ValidationSummary, media: &[(&str, &[u8])]) -> TempDir {
    let dir = TempDir::new().expect("temp dir");
    let record = RunRecord {
        id: "run-1".to_string(),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        finished_at: "2026-06-14T10:05:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: crate::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            orchestrator_slug: "one-shot".to_string(),
            model_id: "anthropic/claude-opus-4".to_string(),
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".to_string(),
            container_image: "img:latest".to_string(),
            node_version: None,
            auth_mode: crate::run_record::AuthMode::ApiKey,
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
    };
    fs::write(
        dir.path().join("run-record.json"),
        serde_json::to_string(&record).expect("serialize record"),
    )
    .expect("write record");
    for (rel, bytes) in media {
        let target = dir.path().join("implementation").join(rel);
        fs::create_dir_all(target.parent().unwrap()).expect("create dirs");
        fs::write(target, bytes).expect("write media");
    }
    dir
}

#[test]
fn serves_proof_media_by_id_at_its_recorded_dest() {
    // The request file is `<proof-id>.<ext>`; the media lives at the proof's
    // recorded `dest`, which need not match the request extension.
    let dir = run_dir_with_proofs(
        &[("rally", "evidence/clip.mp4", MediaKind::Video)],
        &[("evidence/clip.mp4", b"\x00\x00\x00 ftypisom")],
    );
    let served = serve_proof_file(dir.path(), "rally.mp4").expect("proof served");
    assert_eq!(served.content_type, "video/mp4");
    assert_eq!(served.body, b"\x00\x00\x00 ftypisom");
}

#[test]
fn proof_content_type_follows_the_request_extension() {
    let dir = run_dir_with_proofs(
        &[("title", "proof/title.png", MediaKind::Image)],
        &[("proof/title.png", b"\x89PNG\r\n")],
    );
    let served = serve_proof_file(dir.path(), "title.png").unwrap();
    assert_eq!(served.content_type, "image/png");
}

#[test]
fn serves_a_webm_clip_verbatim_from_the_tree() {
    // A run captures its clip as webm; the live path serves it as-is (only the
    // public snapshot transcodes to mp4).
    let dir = run_dir_with_proofs(
        &[("rally", "proof/rally.webm", MediaKind::Video)],
        &[("proof/rally.webm", b"\x1aE\xdf\xa3webm")],
    );
    let served = serve_proof_file(dir.path(), "rally.webm").expect("proof served");
    assert_eq!(served.content_type, "video/webm");
    assert_eq!(served.body, b"\x1aE\xdf\xa3webm");
}

#[test]
fn published_extension_is_mp4_for_video_and_verbatim_for_images() {
    // The public snapshot serves a video proof as mp4 (transcoded from webm)
    // regardless of the captured extension; an image keeps its own extension.
    assert_eq!(
        proof_published_extension(MediaKind::Video, "proof/rally.webm"),
        "mp4"
    );
    assert_eq!(
        proof_published_extension(MediaKind::Video, "proof/rally.mp4"),
        "mp4"
    );
    assert_eq!(
        proof_published_extension(MediaKind::Image, "proof/title.png"),
        "png"
    );
}

#[test]
fn unknown_proof_id_is_none() {
    let dir = run_dir_with_proofs(
        &[("title", "proof/title.png", MediaKind::Image)],
        &[("proof/title.png", b"x")],
    );
    assert_eq!(serve_proof_file(dir.path(), "missing.png"), None);
}

#[test]
fn declared_proof_with_no_media_on_disk_is_none() {
    // The proof is declared but its file was never written (a missing proof).
    let dir = run_dir_with_proofs(&[("title", "proof/title.png", MediaKind::Image)], &[]);
    assert_eq!(serve_proof_file(dir.path(), "title.png"), None);
}

#[test]
fn proof_without_a_record_is_none() {
    let dir = TempDir::new().unwrap();
    assert_eq!(serve_proof_file(dir.path(), "title.png"), None);
}
