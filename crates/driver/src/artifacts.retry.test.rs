//! Tests for the run-tree upload against a stub artifact service: whose failure
//! each failed upload is (`UploadError::kind`), what an attempt sends, and what a
//! run reports about its tree (`store_run_tree`). The pacing of the shared policy
//! is pinned in `retry.test.rs`.
//!
//! The driver's copy of a run tree is the only one until the artifact service
//! acknowledges it, and the pod is discarded once the run is reported. These pin
//! that a failed attempt does not lose the tree, that a failure which is the run's
//! own is not waited on, and that a tree which could not be stored is reported as
//! such rather than advertised through a build link nothing serves.
//!
//! These talk to real sockets, so none of them depends on a clock: every policy
//! here either waits nothing between attempts under a bound no test reaches, or
//! makes a single attempt. The wait itself (its bound, its reports, its
//! cancellation) is tested on a paused clock in `artifacts.wait.test.rs`.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{
    TreeStore, Unattended, UploadEnd, UploadError, UploadFailureKind, UploadRetry, store_run_tree,
    upload_run_tree_with,
};

/// A produced run tree for run `run_id` under `out_dir`: the record and a static
/// build, which is what makes the run carry a playable-build link.
fn run_tree(out_dir: &std::path::Path, run_id: &str) {
    let run_dir = out_dir.join(run_id);
    let build = run_dir.join("implementation").join("dist");
    std::fs::create_dir_all(&build).expect("create the build dir");
    std::fs::write(build.join("index.html"), b"<!doctype html>").expect("write the build");
    std::fs::write(run_dir.join("run-record.json"), br#"{"id":"r"}"#).expect("write the record");
}

/// A stub artifact service that answers the upload attempts it receives with
/// `statuses`, in order, repeating the last one once they run out. Each request's
/// chunked body is drained before it is answered, so the driver sees a status and
/// never a reset connection. Returns its base URL and the body length of every
/// attempt it received.
async fn scripted_artifacts(statuses: &[u16]) -> (String, Arc<Mutex<Vec<usize>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let received = Arc::new(Mutex::new(Vec::new()));
    let sink = received.clone();
    let statuses = statuses.to_vec();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let Some(body_len) = drain_chunked_request(&mut socket).await else {
                continue;
            };
            let status = {
                let mut received = sink.lock().expect("lock");
                received.push(body_len);
                let index = (received.len() - 1).min(statuses.len() - 1);
                statuses[index]
            };
            let body = if status == 200 { "" } else { "no space left" };
            let response = format!(
                "HTTP/1.1 {status} Stub\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;
        }
    });
    (format!("http://{addr}"), received)
}

/// Read one chunked request off `socket` to its terminating zero chunk and return
/// the decoded body length. `None` when the peer hung up first.
async fn drain_chunked_request(socket: &mut tokio::net::TcpStream) -> Option<usize> {
    read_chunked_request(socket).await.map(|body| body.len())
}

/// Read one chunked request off `socket` to its terminating zero chunk and return
/// the decoded body. `None` when the peer hung up first.
async fn read_chunked_request(socket: &mut tokio::net::TcpStream) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        let n = socket.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let mut rest = buf[header_end..].to_vec();
    let mut body = Vec::new();
    loop {
        let Some(line_end) = rest.windows(2).position(|w| w == b"\r\n") else {
            let n = socket.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            rest.extend_from_slice(&chunk[..n]);
            continue;
        };
        let size =
            usize::from_str_radix(String::from_utf8_lossy(&rest[..line_end]).trim(), 16).ok()?;
        if size == 0 {
            return Some(body);
        }
        let need = line_end + 2 + size + 2;
        while rest.len() < need {
            let n = socket.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            rest.extend_from_slice(&chunk[..n]);
        }
        body.extend_from_slice(&rest[line_end + 2..line_end + 2 + size]);
        rest.drain(..need);
    }
}

/// A policy that retries at once, under a bound no test reaches: the number of
/// attempts is then decided by the stub's script alone.
fn quick() -> UploadRetry {
    UploadRetry {
        give_up_after: Duration::from_secs(3600),
        delays: vec![Duration::ZERO],
        ..UploadRetry::default()
    }
}

fn status_error(status: u16) -> UploadError {
    UploadError::Status {
        status: reqwest::StatusCode::from_u16(status).expect("a status"),
        body: String::new(),
    }
}

#[test]
fn only_a_failure_about_this_tree_is_the_runs_own() {
    // A tree over the size cap, a path the store refuses, and bytes the store
    // cannot read as an archive.
    for status in [413, 400, 422] {
        assert_eq!(
            status_error(status).kind(),
            UploadFailureKind::RunsOwn,
            "HTTP {status} is about this tree"
        );
    }
    // A full or faulted volume, an unverifiable token, a missing route, throttling,
    // and statuses nothing expects: none says the tree is at fault.
    for status in [500, 502, 503, 504, 507, 401, 403, 404, 408, 409, 429, 418] {
        assert_eq!(
            status_error(status).kind(),
            UploadFailureKind::StoreCondition,
            "HTTP {status} is a condition of the store"
        );
    }
    let tar = UploadError::Tar {
        path: "out/run-1".into(),
        source: std::io::Error::other("unreadable"),
    };
    assert_eq!(tar.kind(), UploadFailureKind::RunsOwn);
    assert_eq!(
        UploadError::Stalled(Duration::from_secs(300)).kind(),
        UploadFailureKind::StoreCondition
    );
}

#[tokio::test]
async fn a_transport_failure_is_a_store_condition() {
    // A listener bound and dropped leaves a port nothing answers on.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(listener);
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");

    let failure = upload_run_tree_with(
        &UploadRetry::single_attempt(),
        &Unattended,
        &format!("http://{addr}"),
        "run-1",
        "job-9",
        out.path(),
        "tok-1",
    )
    .await
    .expect_err("nothing is listening");

    assert!(
        matches!(failure.error, Some(UploadError::Transport(_))),
        "got {failure:?}"
    );
    assert_eq!(
        failure.error.as_ref().map(UploadError::kind),
        Some(UploadFailureKind::StoreCondition)
    );
    assert_eq!(failure.end, UploadEnd::GaveUp);
}

/// A stub artifact service that answers its first upload attempt `500` the moment
/// the request's head has arrived, with most of the body still unread, and takes
/// the whole of the second. That is what a full volume does: the service fails on
/// the first chunk it cannot spool. Returns its base URL and the decoded body of
/// the second attempt.
async fn answers_early_then_accepts() -> (String, tokio::sync::oneshot::Receiver<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let (sender, receiver) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        // The first attempt: read to the end of the head, answer, and hang up.
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = socket.read(&mut chunk).await.expect("read the head");
            assert!(n > 0, "the driver hung up before sending a head");
            buf.extend_from_slice(&chunk[..n]);
        }
        let _ = socket
            .write_all(b"HTTP/1.1 500 Stub\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
            .await;
        drop(socket);

        // The second: take every byte.
        let (mut socket, _) = listener.accept().await.expect("accept");
        let body = read_chunked_request(&mut socket)
            .await
            .expect("a whole body");
        let _ = socket
            .write_all(b"HTTP/1.1 200 Stub\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
            .await;
        let _ = sender.send(body);
    });
    (format!("http://{addr}"), receiver)
}

#[tokio::test]
async fn an_attempt_after_an_early_answer_sends_the_whole_archive() {
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    // A tree far larger than a socket buffer, so the first attempt's body is still
    // mostly unsent when the stub answers it.
    let media: Vec<u8> = (0..8 * 1024 * 1024u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(out.path().join("run-1").join("media.bin"), &media).expect("write media");
    let (base, second_body) = answers_early_then_accepts().await;

    upload_run_tree_with(
        &quick(),
        &Unattended,
        &base,
        "run-1",
        "job-9",
        out.path(),
        "tok-1",
    )
    .await
    .expect("the second attempt succeeds");

    // The second attempt carried the archive from its first byte, every file whole.
    let body = second_body.await.expect("the stub saw the second attempt");
    let unpacked = TempDir::new().expect("tempdir");
    tar::Archive::new(body.as_slice())
        .unpack(unpacked.path())
        .expect("the body is a whole tar archive");
    assert_eq!(
        std::fs::read(unpacked.path().join("media.bin")).expect("media"),
        media
    );
    assert_eq!(
        std::fs::read(unpacked.path().join("run-record.json")).expect("record"),
        br#"{"id":"r"}"#
    );
    assert!(
        unpacked
            .path()
            .join("implementation/dist/index.html")
            .is_file()
    );
}

#[tokio::test]
async fn an_attempt_the_service_never_answers_is_abandoned_as_stalled() {
    // A service that accepts the connection and then does nothing at all. However
    // long the machine takes to connect, no answer ever comes, so the outcome does
    // not depend on timing; only how long the test runs does.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let held = tokio::spawn(async move {
        let mut sockets = Vec::new();
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                return;
            };
            sockets.push(socket);
        }
    });
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let retry = UploadRetry {
        stall_limit: Duration::from_millis(20),
        ..UploadRetry::single_attempt()
    };

    let failure = upload_run_tree_with(
        &retry,
        &Unattended,
        &format!("http://{addr}"),
        "run-1",
        "job-9",
        out.path(),
        "tok-1",
    )
    .await
    .expect_err("the attempt is never answered");

    assert!(
        matches!(failure.error, Some(UploadError::Stalled(_))),
        "got {failure:?}"
    );
    // A stall says nothing about the tree, so it is the store's to wait on.
    assert_eq!(
        failure.error.as_ref().map(UploadError::kind),
        Some(UploadFailureKind::StoreCondition)
    );
    held.abort();
}

#[tokio::test]
async fn an_upload_that_fails_then_succeeds_is_stored() {
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    // A full volume, a token the service could not verify, then room.
    let (base, received) = scripted_artifacts(&[500, 401, 200]).await;

    upload_run_tree_with(
        &quick(),
        &Unattended,
        &base,
        "run-1",
        "job-9",
        out.path(),
        "tok-1",
    )
    .await
    .expect("the third attempt succeeds");

    let received = received.lock().expect("lock").clone();
    assert_eq!(received.len(), 3, "two failures and the success");
    // Every attempt carried the whole archive from its first byte: a retry that
    // sent the file from where the last attempt left it would send nothing.
    assert!(received[0] > 0);
    assert!(
        received.iter().all(|len| *len == received[0]),
        "each attempt sends the same archive: {received:?}"
    );
}

#[tokio::test]
async fn an_upload_over_the_size_cap_is_not_waited_on() {
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let (base, received) = scripted_artifacts(&[413]).await;

    let failure = upload_run_tree_with(
        &quick(),
        &Unattended,
        &base,
        "run-1",
        "job-9",
        out.path(),
        "tok-1",
    )
    .await
    .expect_err("a 413 is the run's own");

    assert_eq!(failure.end, UploadEnd::RunsOwn);
    match failure.error {
        Some(UploadError::Status { status, body }) => {
            assert_eq!(status.as_u16(), 413);
            assert_eq!(body, "no space left", "the service's body is kept");
        }
        other => panic!("expected a status error, got {other:?}"),
    }
    assert_eq!(received.lock().expect("lock").len(), 1);
}

#[tokio::test]
async fn a_tree_that_cannot_be_tarred_is_the_runs_own_and_sends_nothing() {
    let out = TempDir::new().expect("tempdir");
    let (base, received) = scripted_artifacts(&[200]).await;

    let failure = upload_run_tree_with(
        &quick(),
        &Unattended,
        &base,
        "absent-run",
        "job-9",
        out.path(),
        "tok-1",
    )
    .await
    .expect_err("there is no tree to tar");

    assert_eq!(failure.end, UploadEnd::RunsOwn);
    assert!(matches!(failure.error, Some(UploadError::Tar { .. })));
    assert!(received.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_stored_tree_is_reported_and_its_build_link_stamped() {
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let (base, _received) = scripted_artifacts(&[200]).await;
    let mut record = super::tests::record(None);

    let tree = store_run_tree(
        &quick(),
        &Unattended,
        Some(&base),
        &mut record,
        "job-9",
        out.path(),
        "tok-1",
    )
    .await;

    assert_eq!(tree, TreeStore::Stored);
    assert_eq!(tree.artifacts_stored(), Some(true));
    assert!(!tree.canceled_during_upload());
    assert_eq!(tree.store_fault(), None);
    assert_eq!(
        record.links.playable_build.as_deref(),
        Some("/runs/run-1/build/")
    );
}

#[tokio::test]
async fn a_tree_that_could_not_be_stored_is_reported_without_a_build_link() {
    // The run built a playable build, but the service never took the tree. The
    // record must not advertise a build nothing serves, and the run's own state is
    // left exactly as the run reached it.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let (base, received) = scripted_artifacts(&[500]).await;
    let mut record = super::tests::record(None);
    let state_before = record.status.state;

    let tree = store_run_tree(
        &UploadRetry::single_attempt(),
        &Unattended,
        Some(&base),
        &mut record,
        "job-9",
        out.path(),
        "tok-1",
    )
    .await;

    assert!(
        matches!(
            tree,
            TreeStore::NotStored {
                end: UploadEnd::GaveUp,
                ..
            }
        ),
        "{tree:?}"
    );
    assert_eq!(tree.artifacts_stored(), Some(false));
    // A `500` is the store's failure, and the report says so.
    assert!(
        tree.store_fault()
            .is_some_and(|fault| fault.contains("HTTP 500")),
        "{tree:?}"
    );
    assert_eq!(record.links.playable_build, None);
    assert_eq!(record.status.state, state_before);
    assert_eq!(received.lock().expect("lock").len(), 1);
}

#[tokio::test]
async fn with_no_artifact_service_nothing_is_uploaded_or_reported() {
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let mut record = super::tests::record(None);

    let tree = store_run_tree(
        &quick(),
        &Unattended,
        None,
        &mut record,
        "job-9",
        out.path(),
        "tok-1",
    )
    .await;

    assert_eq!(tree, TreeStore::NoService);
    assert_eq!(tree.artifacts_stored(), None);
    assert_eq!(record.links.playable_build, None);
}

/// A tree that was not stored, having ended as `end`.
fn not_stored(end: UploadEnd) -> TreeStore {
    TreeStore::NotStored {
        end,
        store_fault: None,
    }
}

#[test]
fn only_a_cancellation_during_the_upload_reads_as_canceled() {
    assert!(not_stored(UploadEnd::Canceled).canceled_during_upload());
    for other in [
        TreeStore::NoService,
        TreeStore::Stored,
        not_stored(UploadEnd::GaveUp),
        not_stored(UploadEnd::RunsOwn),
    ] {
        assert!(!other.canceled_during_upload(), "{other:?}");
    }
}

#[test]
fn a_run_reports_canceled_when_it_or_its_upload_was() {
    // The run itself was canceled: whatever became of its tree, the job is
    // terminally `canceled` and takes no other status.
    for tree in [
        TreeStore::NoService,
        TreeStore::Stored,
        not_stored(UploadEnd::GaveUp),
        not_stored(UploadEnd::Canceled),
    ] {
        assert!(tree.reports_canceled(true), "{tree:?}");
    }
    // The run finished and was canceled while its tree was uploading: the same.
    assert!(not_stored(UploadEnd::Canceled).reports_canceled(false));
    // Otherwise the run reports the outcome it reached.
    for tree in [
        TreeStore::NoService,
        TreeStore::Stored,
        not_stored(UploadEnd::GaveUp),
        not_stored(UploadEnd::RunsOwn),
    ] {
        assert!(!tree.reports_canceled(false), "{tree:?}");
    }
}

#[tokio::test]
async fn a_refusal_of_the_tree_is_reported_without_naming_the_store() {
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let (base, _received) = scripted_artifacts(&[422]).await;
    let mut record = super::tests::record(None);

    let tree = store_run_tree(
        &quick(),
        &Unattended,
        Some(&base),
        &mut record,
        "job-9",
        out.path(),
        "tok-1",
    )
    .await;

    assert_eq!(tree, not_stored(UploadEnd::RunsOwn));
    assert_eq!(tree.store_fault(), None);
}
