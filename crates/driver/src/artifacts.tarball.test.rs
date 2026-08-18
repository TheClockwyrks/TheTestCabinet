//! Tests for the produced run tree's tarball and its upload (`tar_run_dir`,
//! `upload_run_tree`).
//!
//! These pin the property that decides whether a driver can be given a memory
//! ceiling at all: the archive is assembled on **disk** and read back a chunk at a
//! time, so peak driver memory is a property of the driver rather than of the
//! heaviest run tree it might have to ship. The upload runs after the harness
//! session has finished and before terminal status is posted, so a driver killed
//! here loses a run that has already paid for every one of its API calls — which
//! makes the framing details below (a complete archive, read from byte zero,
//! delivered whole) worth asserting rather than assuming.

use std::io::{Read, Seek};

use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{tar_run_dir, upload_run_tree};

/// The tar end-of-archive trailer: two 512-byte zero blocks.
const TRAILER_LEN: usize = 1024;

/// Write `rel` under `root` with `bytes`, creating parent directories.
fn write_file(root: &std::path::Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("create parents");
    std::fs::write(path, bytes).expect("write file");
}

/// A produced run tree with the shape the artifact service unpacks: the record, a
/// static build under `implementation/`, and the session logs.
fn run_tree(out_dir: &std::path::Path, run_id: &str) {
    let run_dir = out_dir.join(run_id);
    write_file(&run_dir, "run-record.json", br#"{"id":"r"}"#);
    write_file(
        &run_dir,
        "implementation/dist/index.html",
        b"<!doctype html>",
    );
    write_file(&run_dir, "implementation/src/main.ts", b"export {}");
    write_file(&run_dir, "events.jsonl", b"{}\n");
    write_file(&run_dir, "raw.jsonl", b"{}\n");
}

/// Every entry path in `tar`, sorted, so a comparison does not depend on the order
/// the directory walk happened to yield.
fn entry_paths(tar: &[u8]) -> Vec<String> {
    let mut archive = tar::Archive::new(std::io::Cursor::new(tar));
    let mut paths: Vec<String> = archive
        .entries()
        .expect("entries")
        .map(|entry| {
            entry
                .expect("entry")
                .path()
                .expect("path")
                .display()
                .to_string()
        })
        .filter(|path| !path.is_empty() && path != ".")
        .collect();
    paths.sort();
    paths
}

/// Read one entry's contents out of `tar` by path.
fn entry_bytes(tar: &[u8], want: &str) -> Option<Vec<u8>> {
    let mut archive = tar::Archive::new(std::io::Cursor::new(tar));
    for entry in archive.entries().expect("entries") {
        let mut entry = entry.expect("entry");
        if entry.path().expect("path").display().to_string() == want {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).expect("read entry");
            return Some(bytes);
        }
    }
    None
}

/// Read the whole file back from the current cursor position.
fn read_all(file: &mut std::fs::File) -> Vec<u8> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).expect("read tarball");
    bytes
}

#[test]
fn packs_the_run_tree_contents_at_the_archive_root() {
    // The service untars this under `<store-root>/{id}/`, so the archive root must be
    // the run directory's *contents* — a `{run_id}/` prefix would nest every path one
    // level too deep and break every media URL the console resolves.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");

    let mut file = tar_run_dir(&out.path().join("run-1"), out.path()).expect("tar");
    let bytes = read_all(&mut file);

    assert_eq!(
        entry_paths(&bytes),
        vec![
            "events.jsonl",
            // The directory entries `append_dir_all` emits alongside the files. They
            // are what let the service recreate an empty directory, and they carry the
            // tree's modes, so they belong in the archive.
            "implementation",
            "implementation/dist",
            "implementation/dist/index.html",
            "implementation/src",
            "implementation/src/main.ts",
            "raw.jsonl",
            "run-record.json",
        ]
    );
    assert_eq!(
        entry_bytes(&bytes, "implementation/dist/index.html").as_deref(),
        Some(b"<!doctype html>".as_slice())
    );
}

#[test]
fn returns_the_file_rewound_so_the_upload_reads_from_byte_zero() {
    // `append_dir_all` leaves the cursor at the end of the archive. Streaming from
    // there would send an empty body and the service would store an empty run — a
    // silent loss, not an error, which is why this is asserted on its own.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");

    let mut file = tar_run_dir(&out.path().join("run-1"), out.path()).expect("tar");

    assert_eq!(
        file.stream_position().expect("position"),
        0,
        "the tarball must be handed back rewound"
    );
    assert!(!read_all(&mut file).is_empty());
}

#[test]
fn writes_the_end_of_archive_trailer() {
    // Without `finish()` the archive has no terminating zero blocks, and the service
    // sees a truncated tar. `tar::Archive` is lenient enough to still yield the
    // entries, so a round-trip alone would not catch this.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");

    let mut file = tar_run_dir(&out.path().join("run-1"), out.path()).expect("tar");
    let bytes = read_all(&mut file);

    assert!(bytes.len() > TRAILER_LEN);
    assert!(
        bytes[bytes.len() - TRAILER_LEN..].iter().all(|b| *b == 0),
        "the archive must end with the two zero blocks that terminate a tar"
    );
}

#[test]
fn leaves_nothing_behind_in_the_scratch_dir() {
    // The tarball is created with `tempfile_in`, so it has no directory entry: the
    // kernel reclaims it when the descriptor closes, including when the driver is
    // killed mid-upload. Nothing needs cleaning up on any error path, and a later run
    // cannot trip over a previous one's archive.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");

    let file = tar_run_dir(&out.path().join("run-1"), out.path()).expect("tar");

    let names: Vec<String> = std::fs::read_dir(out.path())
        .expect("read scratch")
        .map(|entry| entry.expect("entry").file_name().display().to_string())
        .collect();
    assert_eq!(
        names,
        vec!["run-1"],
        "the scratch dir must hold only the run tree, never the archive of it"
    );
    drop(file);
}

#[test]
fn a_missing_run_dir_is_an_error_rather_than_an_empty_archive() {
    // An empty upload would be stored as a successful run with no artifacts. Failing
    // is what lets the caller log it and leave the record's media simply absent.
    let out = TempDir::new().expect("tempdir");

    assert!(tar_run_dir(&out.path().join("absent"), out.path()).is_err());
}

/// One upload the stub artifact service received.
#[derive(Debug, Clone)]
struct Received {
    path: String,
    head: String,
    body: Vec<u8>,
}

/// A stub artifact service that reads ONE request — de-chunking the body, since the
/// driver streams it and so frames it `Transfer-Encoding: chunked` — answers with
/// `status`, and hands back what it saw. Returns its base URL and a handle to the
/// captured request.
async fn stub_artifacts(status: u16) -> (String, tokio::task::JoinHandle<Option<Received>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let handle = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.ok()?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        // Headers first.
        let header_end = loop {
            let n = socket.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos + 4;
            }
        };
        let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
        let path = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or_default()
            .to_string();

        // Then the chunked body: `<len-hex>\r\n<bytes>\r\n`, terminated by a 0 chunk.
        let mut rest = buf[header_end..].to_vec();
        let mut body = Vec::new();
        loop {
            let line_end = match rest.windows(2).position(|w| w == b"\r\n") {
                Some(pos) => pos,
                None => {
                    let n = socket.read(&mut chunk).await.ok()?;
                    if n == 0 {
                        break;
                    }
                    rest.extend_from_slice(&chunk[..n]);
                    continue;
                }
            };
            let size = usize::from_str_radix(String::from_utf8_lossy(&rest[..line_end]).trim(), 16)
                .unwrap_or(0);
            if size == 0 {
                break;
            }
            // `\r\n` after the size line, `size` bytes, then a trailing `\r\n`.
            let need = line_end + 2 + size + 2;
            while rest.len() < need {
                let n = socket.read(&mut chunk).await.ok()?;
                if n == 0 {
                    break;
                }
                rest.extend_from_slice(&chunk[..n]);
            }
            if rest.len() < need {
                break;
            }
            body.extend_from_slice(&rest[line_end + 2..line_end + 2 + size]);
            rest = rest[need..].to_vec();
        }

        let reason = if status == 200 { "OK" } else { "Error" };
        let response =
            format!("HTTP/1.1 {status} {reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
        socket.write_all(response.as_bytes()).await.ok()?;
        socket.flush().await.ok()?;
        Some(Received { path, head, body })
    });
    (format!("http://{addr}"), handle)
}

#[tokio::test]
async fn streams_the_whole_tarball_to_the_service() {
    // The end-to-end framing check. A streamed body has no size hint, so reqwest
    // frames it `chunked`; what the service must end up with is nonetheless the exact
    // archive, trailer included. This is the assertion that would fail if the body
    // were ever declared with a `Content-Length` alongside chunked framing, or sent
    // from an un-rewound file.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let (base, server) = stub_artifacts(200).await;

    upload_run_tree(&base, "run-1", "job-9", out.path(), "tok-1")
        .await
        .expect("upload should succeed");

    let got = server.await.expect("join").expect("a request");
    assert_eq!(got.path, "/runs/run-1/artifacts");

    let lower = got.head.to_ascii_lowercase();
    assert!(
        lower.contains("transfer-encoding: chunked"),
        "a streamed body is framed chunked, not buffered: {}",
        got.head
    );
    assert!(
        !lower.contains("content-length:"),
        "declaring a length alongside chunked framing can truncate the upload: {}",
        got.head
    );
    assert!(lower.contains("authorization: bearer tok-1"));
    assert!(lower.contains("x-tcab-job-id: job-9"));
    assert!(lower.contains("content-type: application/x-tar"));

    // The body is the archive, whole.
    assert_eq!(
        entry_paths(&got.body),
        vec![
            "events.jsonl",
            // The directory entries `append_dir_all` emits alongside the files. They
            // are what let the service recreate an empty directory, and they carry the
            // tree's modes, so they belong in the archive.
            "implementation",
            "implementation/dist",
            "implementation/dist/index.html",
            "implementation/src",
            "implementation/src/main.ts",
            "raw.jsonl",
            "run-record.json",
        ]
    );
    assert_eq!(
        entry_bytes(&got.body, "run-record.json").as_deref(),
        Some(br#"{"id":"r"}"#.as_slice())
    );
    assert!(
        got.body[got.body.len() - TRAILER_LEN..]
            .iter()
            .all(|b| *b == 0),
        "the service must receive the terminating zero blocks too"
    );
}

#[tokio::test]
async fn a_rejected_upload_is_surfaced_as_a_status_error() {
    // The caller logs this and leaves the run's media absent rather than aborting —
    // the record itself is still reported — so the error has to carry the status.
    let out = TempDir::new().expect("tempdir");
    run_tree(out.path(), "run-1");
    let (base, server) = stub_artifacts(413).await;

    let err = upload_run_tree(&base, "run-1", "job-9", out.path(), "tok-1")
        .await
        .expect_err("a 413 should not be reported as success");

    match err {
        super::UploadError::Status { status, .. } => {
            assert_eq!(status.as_u16(), 413);
        }
        other => panic!("expected a status error, got {other:?}"),
    }
    let _ = server.await;
}

#[tokio::test]
async fn a_missing_run_tree_fails_before_any_request() {
    // Tarring happens on the blocking pool, so its failure arrives through a
    // `JoinHandle`; it must still surface as `Tar` and name the directory rather than
    // reaching the service with an empty body.
    let out = TempDir::new().expect("tempdir");
    let (base, server) = stub_artifacts(200).await;

    let err = upload_run_tree(&base, "absent-run", "job-9", out.path(), "tok-1")
        .await
        .expect_err("a missing run tree cannot be uploaded");

    match err {
        super::UploadError::Tar { path, .. } => assert!(path.ends_with("absent-run")),
        other => panic!("expected a tar error, got {other:?}"),
    }
    server.abort();
}
