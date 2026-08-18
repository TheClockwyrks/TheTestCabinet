//! Tests for `spool_to_disk`, the upload's write-to-disk path.
//!
//! The property under test is the one that decides whether this service's memory
//! ceiling can be sized at all: an upload's size must never determine the service's
//! peak allocation. `upload` is the only handler here whose input size is chosen by
//! a *caller* rather than by the service's own work, and it is a long-lived shared
//! pod — so a body held in memory made its high-water mark a function of whatever
//! the heaviest run happened to produce.
//!
//! The cap is exercised through the `max_bytes` parameter rather than the real 2 GiB
//! `MAX_UPLOAD_BYTES`, which no test can reasonably send.

use std::io::Read;

use axum::body::Body;
use tempfile::TempDir;

use super::spool_to_disk;

/// Read a spooled file back in full from its current position.
fn read_back(file: &mut std::fs::File) -> Vec<u8> {
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).expect("read the spool file");
    bytes
}

/// Names of the entries directly inside `dir`.
fn entries(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .expect("read scratch dir")
        .map(|entry| entry.expect("entry").file_name().display().to_string())
        .collect()
}

#[tokio::test]
async fn writes_the_body_and_hands_back_a_rewound_file() {
    let scratch = TempDir::new().expect("tempdir");

    let (mut file, written) =
        spool_to_disk(Body::from("hello tarball"), scratch.path().into(), 1024)
            .await
            .expect("spool should succeed");

    assert_eq!(written, 13);
    // Rewound: the caller unpacks from byte zero. Returning the file at the write
    // cursor would unpack an empty archive — a silently empty run, not an error.
    assert_eq!(read_back(&mut file), b"hello tarball");
}

#[tokio::test]
async fn reassembles_a_body_delivered_in_many_chunks() {
    // The driver streams its upload, so the body arrives chunked and the write loop
    // is what puts it back together in order. A body that round-trips whole through
    // several frames is the thing that would break if the loop dropped or reordered
    // one.
    let scratch = TempDir::new().expect("tempdir");
    let chunks: Vec<Result<Vec<u8>, std::io::Error>> =
        (0..64u8).map(|i| Ok(vec![i; 1024])).collect();
    let expected: Vec<u8> = (0..64u8).flat_map(|i| vec![i; 1024]).collect();
    let body = Body::from_stream(futures_util::stream::iter(chunks));

    let (mut file, written) = spool_to_disk(body, scratch.path().into(), 1024 * 1024)
        .await
        .expect("spool should succeed");

    assert_eq!(written, 64 * 1024);
    assert_eq!(read_back(&mut file), expected);
}

#[tokio::test]
async fn refuses_a_body_over_the_cap() {
    let scratch = TempDir::new().expect("tempdir");

    let err = spool_to_disk(Body::from(vec![0u8; 64]), scratch.path().into(), 16)
        .await
        .expect_err("a body over the cap must be refused");

    assert_eq!(err.status, axum::http::StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn stops_at_the_cap_rather_than_after_the_whole_body() {
    // The cap has to bite while writing, not once the body is fully read — otherwise
    // an oversized upload still lands on disk in full before being rejected, which is
    // the disk-exhaustion version of the memory problem this replaced. Feeding an
    // endless stream makes that concrete: it can only terminate by the cap firing.
    let scratch = TempDir::new().expect("tempdir");
    let endless = futures_util::stream::repeat_with(|| Ok::<_, std::io::Error>(vec![7u8; 4096]));
    let body = Body::from_stream(endless);

    let err = spool_to_disk(body, scratch.path().into(), 64 * 1024)
        .await
        .expect_err("an endless body must be cut off by the cap");

    assert_eq!(err.status, axum::http::StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn leaves_nothing_behind_in_the_scratch_dir() {
    // The spool file is unnamed, so neither a completed upload nor a refused one adds
    // an entry the store could later mistake for a run tree, and no failure path has
    // to remember to remove it.
    let scratch = TempDir::new().expect("tempdir");

    let (file, _) = spool_to_disk(Body::from("kept open"), scratch.path().into(), 1024)
        .await
        .expect("spool should succeed");
    assert!(
        entries(scratch.path()).is_empty(),
        "an in-flight upload must not be visible in the store root"
    );
    drop(file);

    let _ = spool_to_disk(Body::from(vec![0u8; 64]), scratch.path().into(), 16)
        .await
        .expect_err("over the cap");
    assert!(
        entries(scratch.path()).is_empty(),
        "a refused upload must leave no partial file behind"
    );
}

#[tokio::test]
async fn an_empty_body_spools_to_an_empty_file() {
    // Not a special case in the loop, but the boundary worth pinning: it must be an
    // empty archive the store then rejects, not an error raised here.
    let scratch = TempDir::new().expect("tempdir");

    let (mut file, written) = spool_to_disk(Body::empty(), scratch.path().into(), 1024)
        .await
        .expect("an empty body is not itself an error");

    assert_eq!(written, 0);
    assert!(read_back(&mut file).is_empty());
}
