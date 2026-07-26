//! Tests for the backend-store mirror uploads (`upload_adversarial_to_backend`,
//! `upload_proofs_to_backend`, and `upload_assets_to_backend`).
//!
//! These pin the behaviour the arena, the replay player, and the published site
//! depend on: a backend-driven run's adversarial controller wasm, every proof
//! replay, every proof-of-implementation media file, and an asset-generation run's
//! per-frame media are POSTed to the backend store at the exact paths the snapshot
//! reads back, read from the produced `implementation/` tree the driver still holds
//! on disk. A run with nothing to mirror (or whose files are absent) makes no
//! request at all.

use std::sync::Arc;
use std::sync::Mutex;

use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use test_cabinet_core::metrics::*;
use test_cabinet_core::run_record::*;
use test_cabinet_core::test_case::{MediaKind, SheetSpec};
use test_cabinet_core::validation::*;

use super::{
    upload_adversarial_to_backend, upload_assets_to_backend, upload_proofs_to_backend,
    upload_validation_to_backend,
};

/// One upload the stub backend received: its request path and body byte length.
#[derive(Debug, Clone)]
struct Upload {
    path: String,
    body_len: usize,
}

/// A stub backend that records each POST the upload makes and answers `204`. It
/// loops per connection so reqwest's keep-alive reuse of one socket for several
/// uploads is recorded in full. Returns its base URL and the recorded uploads.
async fn stub_backend() -> (String, Arc<Mutex<Vec<Upload>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let received = Arc::new(Mutex::new(Vec::new()));
    let sink = received.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let sink = sink.clone();
            tokio::spawn(async move {
                while let Some(upload) = read_request(&mut socket).await {
                    sink.lock().expect("lock").push(upload);
                    if socket
                        .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
                        .await
                        .is_err()
                    {
                        return;
                    }
                    let _ = socket.flush().await;
                }
            });
        }
    });
    (format!("http://{addr}"), received)
}

/// A stub backend that rejects every asset POST (the run-replay path) with `413`
/// but accepts the controller upload with `204` — modelling a backend whose body
/// limit is too small for an oversized replay. Records each request it sees (the
/// rejected ones included) and returns its base URL and that log.
async fn stub_backend_rejecting_assets() -> (String, Arc<Mutex<Vec<Upload>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let received = Arc::new(Mutex::new(Vec::new()));
    let sink = received.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let sink = sink.clone();
            tokio::spawn(async move {
                while let Some(upload) = read_request(&mut socket).await {
                    let response: &[u8] = if upload.path.contains("/asset/") {
                        b"HTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\n\r\n"
                    } else {
                        b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"
                    };
                    sink.lock().expect("lock").push(upload);
                    if socket.write_all(response).await.is_err() {
                        return;
                    }
                    let _ = socket.flush().await;
                }
            });
        }
    });
    (format!("http://{addr}"), received)
}

/// Read one HTTP request from `socket`, returning its path and body length, or
/// `None` at end of stream. Drains the full `Content-Length` body so the next
/// keep-alive request on the same socket starts at a request boundary.
async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<Upload> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = socket.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let request_line = head.lines().next()?;
    let path = request_line.split_whitespace().nth(1)?.to_string();
    let content_length = head
        .lines()
        .find_map(|line| {
            let lower = line.to_ascii_lowercase();
            lower
                .strip_prefix("content-length:")
                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
        })
        .unwrap_or(0);
    while buf.len() < header_end + content_length {
        let n = socket.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    Some(Upload {
        path,
        body_len: content_length,
    })
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// A produced run record with the given adversarial result (or none).
fn record(adversarial: Option<AdversarialResult>) -> RunRecord {
    RunRecord {
        id: "run-1".into(),
        started_at: "2026-06-14T10:00:00Z".into(),
        finished_at: "2026-06-14T10:05:00Z".into(),
        subject: RunSubject {
            test_case_slug: "adversarial-pacman".into(),
            test_case_version: "v1.0.0".into(),
            test_type: test_cabinet_core::test_case::TestType::Adversarial,
            variant: "base".into(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            orchestrator_slug: "one-shot".into(),
            model_id: "anthropic/claude-opus-4".into(),
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "linux".into(),
            container_image: "img".into(),
            node_version: None,
            auth_mode: AuthMode::ApiKey,
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
        validation: ValidationSummary {
            debug_scripts: Vec::new(),
            adversarial,
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
        game_jam_readme: None,
    }
}

fn replay_entry(opponent: &str, file: &str) -> AdversarialReplay {
    AdversarialReplay {
        opponent: opponent.into(),
        replay_json: file.into(),
        winner: Some(AdversarialTeam::Red),
        red_score: 20,
        blue_score: 0,
        ended: "swept".into(),
        ticks: 100,
        outcome: AdversarialOutcome::Win,
        scored: true,
    }
}

/// Write `bytes` to `{out_dir}/run-1/implementation/{rel}`.
fn write_impl_file(out_dir: &std::path::Path, rel: &str, bytes: &[u8]) {
    let path = out_dir.join("run-1").join("implementation").join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

#[tokio::test]
async fn uploads_controller_and_every_replay_to_their_backend_paths() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    write_impl_file(out.path(), "replay.json", b"{\"v\":1}");
    write_impl_file(out.path(), "replay-1.json", b"{\"v\":1,\"x\":2}");
    write_impl_file(out.path(), "build/controller.wasm", b"\0asm-bytes");

    let rec = record(Some(AdversarialResult {
        replay_json: "replay.json".into(),
        opponent: "border-soldier".into(),
        submission_team: AdversarialTeam::Red,
        winner: Some(AdversarialTeam::Red),
        red_score: 20,
        blue_score: 0,
        ended: "swept".into(),
        ticks: 100,
        outcome: AdversarialOutcome::Win,
        detail: None,
        controller_module: "build/controller.wasm".into(),
        replays: vec![
            replay_entry("border-soldier", "replay.json"),
            replay_entry("greedy-raider", "replay-1.json"),
        ],
    }));

    upload_adversarial_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let uploads = received.lock().unwrap().clone();
    let paths: Vec<&str> = uploads.iter().map(|u| u.path.as_str()).collect();
    assert!(
        paths.contains(&"/runs/run-1/asset/replay.json"),
        "canonical replay uploaded to its asset path; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/asset/replay-1.json"),
        "second opponent's replay uploaded too; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/controller.wasm"),
        "controller wasm uploaded to the backend store; got {paths:?}",
    );
    // The controller upload carries the on-disk wasm bytes verbatim.
    let controller = uploads
        .iter()
        .find(|u| u.path == "/runs/run-1/controller.wasm")
        .unwrap();
    assert_eq!(controller.body_len, b"\0asm-bytes".len());
}

#[tokio::test]
async fn controller_uploads_before_replays_so_a_rejected_replay_cannot_drop_it() {
    // The arena gates a run's pushed-controller listing on the controller wasm being
    // in the backend store, so it must land even when a replay upload is rejected
    // (an oversized replay hitting the backend body limit was the original cause of
    // completed runs never appearing in Quick Match / tournaments). The controller is
    // uploaded ahead of the replays for exactly this reason.
    let (backend_url, received) = stub_backend_rejecting_assets().await;
    let out = TempDir::new().unwrap();

    write_impl_file(out.path(), "replay.json", b"{\"v\":1}");
    write_impl_file(out.path(), "build/controller.wasm", b"\0asm-bytes");

    let rec = record(Some(AdversarialResult {
        replay_json: "replay.json".into(),
        opponent: "border-soldier".into(),
        submission_team: AdversarialTeam::Red,
        winner: Some(AdversarialTeam::Red),
        red_score: 20,
        blue_score: 0,
        ended: "swept".into(),
        ticks: 100,
        outcome: AdversarialOutcome::Win,
        detail: None,
        controller_module: "build/controller.wasm".into(),
        replays: vec![replay_entry("border-soldier", "replay.json")],
    }));

    // The rejected replay surfaces as an error (the driver logs it), but the
    // controller was already uploaded before the replay was attempted.
    let result = upload_adversarial_to_backend(&backend_url, &rec, out.path()).await;
    assert!(result.is_err(), "the rejected replay surfaces as an error");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert!(
        paths.contains(&"/runs/run-1/controller.wasm".to_string()),
        "the controller landed despite the replay rejection; got {paths:?}",
    );
    assert!(
        paths.first().map(String::as_str) == Some("/runs/run-1/controller.wasm"),
        "the controller is uploaded first, before any replay; got {paths:?}",
    );
}

#[tokio::test]
async fn non_adversarial_run_uploads_nothing() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    upload_adversarial_to_backend(&backend_url, &record(None), out.path())
        .await
        .expect("no-op succeeds");

    assert!(
        received.lock().unwrap().is_empty(),
        "a non-adversarial run makes no backend upload",
    );
}

#[tokio::test]
async fn missing_files_are_skipped_without_failing() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // The record names a replay and a controller, but neither was written to disk
    // (a partial/forfeit tree). Each missing file is skipped, not an error.
    let rec = record(Some(AdversarialResult {
        replay_json: "replay.json".into(),
        opponent: "border-soldier".into(),
        submission_team: AdversarialTeam::Red,
        winner: None,
        red_score: 0,
        blue_score: 0,
        ended: "forfeit".into(),
        ticks: 0,
        outcome: AdversarialOutcome::Forfeit,
        detail: None,
        controller_module: "build/controller.wasm".into(),
        replays: vec![replay_entry("border-soldier", "replay.json")],
    }));

    upload_adversarial_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("missing files are skipped, not fatal");

    assert!(
        received.lock().unwrap().is_empty(),
        "nothing on disk means nothing to upload",
    );
}

/// A produced run record carrying the given proof results (and no adversarial).
fn record_with_proofs(proofs: Vec<ProofResult>) -> RunRecord {
    let mut rec = record(None);
    rec.validation.proofs = proofs;
    rec
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

#[tokio::test]
async fn uploads_each_present_proof_under_its_served_file_name() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // An image and a video, each produced at its declared dest. The served name is
    // `<proof-id>.<ext>` with the extension taken from the dest — the same name the
    // snapshot keys on and the gallery requests.
    write_impl_file(out.path(), "proof/title-screen.png", b"\x89PNG-bytes");
    write_impl_file(out.path(), "proof/gameplay.mp4", b"\0\0\0\x18ftyp-bytes");

    let rec = record_with_proofs(vec![
        proof(
            "title-screen",
            "proof/title-screen.png",
            MediaKind::Image,
            true,
        ),
        proof("gameplay", "proof/gameplay.mp4", MediaKind::Video, true),
    ]);

    upload_proofs_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let uploads = received.lock().unwrap().clone();
    let paths: Vec<&str> = uploads.iter().map(|u| u.path.as_str()).collect();
    assert!(
        paths.contains(&"/runs/run-1/proof/title-screen.png"),
        "the image proof uploaded under its served name; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/proof/gameplay.mp4"),
        "the video proof uploaded under its served name; got {paths:?}",
    );
    let image = uploads
        .iter()
        .find(|u| u.path == "/runs/run-1/proof/title-screen.png")
        .unwrap();
    assert_eq!(
        image.body_len,
        b"\x89PNG-bytes".len(),
        "the proof upload carries the on-disk media bytes verbatim",
    );
}

/// A record carrying one debug script with the given outputs, driving the
/// `upload_validation_to_backend` mirror.
fn record_with_debug_scripts(outputs: Vec<DebugScriptOutput>) -> RunRecord {
    let mut rec = record(None);
    rec.validation.debug_scripts = vec![DebugScriptResult {
        item_id: "spin".to_string(),
        sub_item_id: None,
        title: "Ball spin".to_string(),
        category_title: "Ball spin".to_string(),
        script: "validation/spin.mjs".to_string(),
        gates: true,
        ran: true,
        precondition_unmet: false,
        detail: None,
        verdicts: vec![],
        outputs,
    }];
    rec
}

#[tokio::test]
async fn uploads_each_present_validation_output_under_its_flat_name() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // The synthesized actual media lands under the collected tree's
    // `.tcab/validation/` dir, named `<item>__<output>.<ext>` (png/webm) — the same
    // flat name the snapshot keys on and the gallery requests.
    write_impl_file(out.path(), ".tcab/validation/spin__still.png", b"png-bytes");
    write_impl_file(
        out.path(),
        ".tcab/validation/spin__rally.webm",
        b"webm-bytes",
    );

    let rec = record_with_debug_scripts(vec![
        DebugScriptOutput {
            id: "still".to_string(),
            name: "Still".to_string(),
            kind: MediaKind::Image,
            actual_present: true,
        },
        DebugScriptOutput {
            id: "rally".to_string(),
            name: "Rally".to_string(),
            kind: MediaKind::Video,
            actual_present: true,
        },
    ]);

    upload_validation_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert!(
        paths.contains(&"/runs/run-1/validation/spin__still.png".to_string()),
        "the image output uploaded under its flat name; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/validation/spin__rally.webm".to_string()),
        "the video output uploaded as the captured webm; got {paths:?}",
    );
}

#[tokio::test]
async fn uploads_a_sub_item_output_under_its_composite_verdict_name() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // A per-sub-item driver's media is keyed by the composite verdict id
    // `<item>.<sub>`, so it lands on disk (and uploads) as `<item>.<sub>__<output>`.
    write_impl_file(
        out.path(),
        ".tcab/validation/ball-spin.stationary__straight.webm",
        b"webm-bytes",
    );

    let mut rec = record(None);
    rec.validation.debug_scripts = vec![DebugScriptResult {
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
            id: "straight".to_string(),
            name: "Straight return".to_string(),
            kind: MediaKind::Video,
            actual_present: true,
        }],
    }];

    upload_validation_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert!(
        paths.contains(&"/runs/run-1/validation/ball-spin.stationary__straight.webm".to_string()),
        "the sub-item output uploaded under its composite verdict name; got {paths:?}",
    );
}

#[tokio::test]
async fn skips_validation_outputs_the_build_did_not_produce() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // Only the present output's file exists; the absent one must not be uploaded.
    write_impl_file(out.path(), ".tcab/validation/spin__still.png", b"png");

    let rec = record_with_debug_scripts(vec![
        DebugScriptOutput {
            id: "still".to_string(),
            name: "Still".to_string(),
            kind: MediaKind::Image,
            actual_present: true,
        },
        DebugScriptOutput {
            id: "rally".to_string(),
            name: "Rally".to_string(),
            kind: MediaKind::Video,
            actual_present: false,
        },
    ]);

    upload_validation_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert_eq!(
        paths,
        vec!["/runs/run-1/validation/spin__still.png".to_string()],
        "only the produced output is uploaded; got {paths:?}",
    );
}

#[tokio::test]
async fn served_name_extension_lowercases_and_defaults_to_png() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // An uppercase extension is normalised, and a dest with no usable extension
    // falls back to `png` — matching the gallery's `extensionFor` so the key lines up.
    write_impl_file(out.path(), "proof/Shot.PNG", b"png");
    write_impl_file(out.path(), "proof/screenshot", b"raw");

    let rec = record_with_proofs(vec![
        proof("shot", "proof/Shot.PNG", MediaKind::Image, true),
        proof("screenshot", "proof/screenshot", MediaKind::Image, true),
    ]);

    upload_proofs_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert!(
        paths.contains(&"/runs/run-1/proof/shot.png".to_string()),
        "the uppercase extension is lowercased; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/proof/screenshot.png".to_string()),
        "a dest with no extension defaults to png; got {paths:?}",
    );
}

#[tokio::test]
async fn skips_proofs_the_agent_did_not_produce() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // Only the present proof's file exists on disk; the absent one is recorded as
    // not produced and must not be uploaded (nor fail the mirror).
    write_impl_file(out.path(), "proof/title-screen.png", b"png");

    let rec = record_with_proofs(vec![
        proof(
            "title-screen",
            "proof/title-screen.png",
            MediaKind::Image,
            true,
        ),
        proof("gameplay", "proof/gameplay.mp4", MediaKind::Video, false),
    ]);

    upload_proofs_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert_eq!(
        paths,
        vec!["/runs/run-1/proof/title-screen.png".to_string()],
        "only the produced proof is uploaded; got {paths:?}",
    );
}

#[tokio::test]
async fn present_proof_missing_on_disk_is_skipped_without_failing() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // The record marks the proof present, but its file is absent from the produced
    // tree (a truncated upload tree). It is skipped rather than failing the mirror.
    let rec = record_with_proofs(vec![proof(
        "title-screen",
        "proof/title-screen.png",
        MediaKind::Image,
        true,
    )]);

    upload_proofs_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("a missing-on-disk proof is skipped, not fatal");

    assert!(
        received.lock().unwrap().is_empty(),
        "nothing on disk means nothing to upload",
    );
}

#[tokio::test]
async fn run_with_no_proofs_uploads_nothing() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    upload_proofs_to_backend(&backend_url, &record_with_proofs(vec![]), out.path())
        .await
        .expect("no-op succeeds");

    assert!(
        received.lock().unwrap().is_empty(),
        "a run with no proofs makes no backend upload",
    );
}

/// A produced run record carrying the given asset-generation result (and no
/// adversarial). The recorded on-disk paths can differ from the served names, which
/// the mirror computes itself.
fn record_with_asset(asset: AssetGenResult) -> RunRecord {
    let mut rec = record(None);
    rec.subject.test_type = test_cabinet_core::test_case::TestType::AssetGeneration;
    rec.validation.asset = Some(asset);
    rec
}

/// An asset frame whose three artifacts live at the given run-root-relative paths.
fn asset_frame(index: u32, regenerated: &str, preview: &str, actions: &str) -> AssetFrameResult {
    AssetFrameResult {
        index,
        regenerated_image: regenerated.into(),
        preview_image: preview.into(),
        actions_log: actions.into(),
        operation_count: 3,
        cheat_divergence: Some(0.05),
        detail: None,
    }
}

#[tokio::test]
async fn uploads_a_single_sprite_under_bare_served_names() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // The recorded on-disk paths are deliberately not the served names: the mirror
    // reads from the recorded path and uploads under the canonical served name.
    write_impl_file(out.path(), "draw/regen.png", b"regen-bytes");
    write_impl_file(out.path(), "draw/prev.png", b"prev-bytes");
    write_impl_file(out.path(), "draw/acts.json", b"[]");

    let rec = record_with_asset(AssetGenResult {
        frames: vec![asset_frame(
            0,
            "draw/regen.png",
            "draw/prev.png",
            "draw/acts.json",
        )],
        sheet: None,
        detail: None,
    });

    upload_assets_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let uploads = received.lock().unwrap().clone();
    let paths: Vec<&str> = uploads.iter().map(|u| u.path.as_str()).collect();
    assert!(
        paths.contains(&"/runs/run-1/asset/regenerated.png"),
        "the regenerated image serves under its bare name; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/asset/preview.png"),
        "the preview serves under its bare name; got {paths:?}",
    );
    assert!(
        paths.contains(&"/runs/run-1/asset/actions.json"),
        "the action log serves under its bare name; got {paths:?}",
    );
    let regen = uploads
        .iter()
        .find(|u| u.path == "/runs/run-1/asset/regenerated.png")
        .unwrap();
    assert_eq!(
        regen.body_len,
        b"regen-bytes".len(),
        "the upload carries the recorded on-disk bytes verbatim",
    );
}

#[tokio::test]
async fn uploads_a_sprite_sheet_with_per_frame_index_suffixes() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    for index in [0u32, 1] {
        write_impl_file(out.path(), &format!("f{index}-regen.png"), b"r");
        write_impl_file(out.path(), &format!("f{index}-prev.png"), b"p");
        write_impl_file(out.path(), &format!("f{index}-acts.json"), b"[]");
    }

    let rec = record_with_asset(AssetGenResult {
        frames: vec![
            asset_frame(0, "f0-regen.png", "f0-prev.png", "f0-acts.json"),
            asset_frame(1, "f1-regen.png", "f1-prev.png", "f1-acts.json"),
        ],
        // Any `Some(sheet)` selects the per-frame `-<index>` naming; its contents
        // are not read by the mirror.
        sheet: Some(SheetSpec {
            frame_width: 16,
            frame_height: 16,
            frames: vec![0, 1],
            sequences: vec![],
        }),
        detail: None,
    });

    upload_assets_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("upload succeeds");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    for expected in [
        "/runs/run-1/asset/regenerated-0.png",
        "/runs/run-1/asset/preview-0.png",
        "/runs/run-1/asset/actions-0.json",
        "/runs/run-1/asset/regenerated-1.png",
        "/runs/run-1/asset/preview-1.png",
        "/runs/run-1/asset/actions-1.json",
    ] {
        assert!(
            paths.contains(&expected.to_string()),
            "sheet frame artifact {expected} uploaded with its index suffix; got {paths:?}",
        );
    }
}

#[tokio::test]
async fn asset_frame_artifacts_missing_on_disk_are_skipped_without_failing() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // Only the regenerated image exists; the preview and action log were not written
    // (a truncated tree). The present file uploads, the absent ones are skipped.
    write_impl_file(out.path(), "draw/regen.png", b"regen-bytes");

    let rec = record_with_asset(AssetGenResult {
        frames: vec![asset_frame(
            0,
            "draw/regen.png",
            "draw/prev.png",
            "draw/acts.json",
        )],
        sheet: None,
        detail: None,
    });

    upload_assets_to_backend(&backend_url, &rec, out.path())
        .await
        .expect("missing frame artifacts are skipped, not fatal");

    let paths: Vec<String> = received
        .lock()
        .unwrap()
        .iter()
        .map(|u| u.path.clone())
        .collect();
    assert_eq!(
        paths,
        vec!["/runs/run-1/asset/regenerated.png".to_string()],
        "only the present artifact is uploaded; got {paths:?}",
    );
}

#[tokio::test]
async fn non_asset_run_uploads_no_asset_media() {
    let (backend_url, received) = stub_backend().await;
    let out = TempDir::new().unwrap();

    // A run with no `validation.asset` (here, a plain non-asset record) is a no-op —
    // an adversarial run's replays are mirrored separately.
    upload_assets_to_backend(&backend_url, &record(None), out.path())
        .await
        .expect("no-op succeeds");

    assert!(
        received.lock().unwrap().is_empty(),
        "a non-asset-generation run makes no asset upload",
    );
}
