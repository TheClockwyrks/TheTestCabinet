//! Tests for the backend-store mirror upload (`upload_adversarial_to_backend`).
//!
//! These pin the behaviour the arena and the replay player depend on: a
//! backend-driven adversarial run's controller wasm and every proof replay are
//! POSTed to the backend store at the exact paths the CLI push uses, read from the
//! produced `implementation/` tree the driver still holds on disk. A non-adversarial
//! run (or a forfeit with no files) makes no request at all.

use std::sync::Arc;
use std::sync::Mutex;

use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use test_cabinet_core::metrics::*;
use test_cabinet_core::run_record::*;
use test_cabinet_core::validation::*;

use super::upload_adversarial_to_backend;

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
                comparable: 0.0,
                actual: 0.0,
            },
        },
        validation: ValidationSummary {
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
