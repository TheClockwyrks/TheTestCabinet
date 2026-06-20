//! Tests for discovering and serving a run's playable build and proof media.

use super::*;
use std::fs;
use tempfile::TempDir;

use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use crate::test_case::MediaKind;
use crate::validation::{ProofResult, ValidationSummary};

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
fn missing_file_is_none() {
    let dir = impl_with_build("dist", &[("index.html", "<html></html>")]);
    let build = dir.path().join("implementation").join("dist");
    assert_eq!(serve_build_file(&build, "does-not-exist.js", "/b/"), None);
}

/// Build a run output directory holding a `run-record.json` whose validation
/// declares the given proofs (id, dest), plus the named media files under
/// `implementation/`.
fn run_dir_with_proofs(proofs: &[(&str, &str, MediaKind)], media: &[(&str, &[u8])]) -> TempDir {
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
                comparable: 0.0,
                actual: 0.0,
            },
        },
        validation: ValidationSummary {
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
        },
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
