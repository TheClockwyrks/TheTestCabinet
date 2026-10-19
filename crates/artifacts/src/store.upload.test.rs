//! Tests for the upload pipeline's parts: the pump that reads the body against
//! the limit, the blocking reader over it, and the entry-path rule.
//!
//! The property the pump holds is the one that decides whether this service's
//! memory ceiling can be sized at all: an upload's size must never determine the
//! service's peak allocation. The limit is exercised through `pump`'s parameter
//! rather than the real 2 GiB `MAX_UPLOAD_BYTES`, which no test can reasonably
//! send.

use std::io::Read;
use std::path::Path;

use bytes::Bytes;
use tokio::sync::mpsc;

use super::{ChannelReader, PumpEnd, UnpackError, pump, tree_path};
use crate::object::{ObjectBody, body_from_bytes};

/// Drain `rx` into the bytes it carried and the error, if any, it ended with.
async fn drain(
    mut rx: mpsc::Receiver<std::io::Result<Bytes>>,
) -> (Vec<u8>, Option<std::io::Error>) {
    let mut bytes = Vec::new();
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => bytes.extend_from_slice(&chunk),
            Err(err) => return (bytes, Some(err)),
        }
    }
    (bytes, None)
}

#[tokio::test]
async fn the_pump_reassembles_a_body_delivered_in_many_chunks() {
    // The driver streams its upload, so the body arrives chunked and the pump is
    // what hands it on in order. A body that round-trips whole through several
    // frames is the thing that would break if the loop dropped or reordered one.
    let chunks: Vec<std::io::Result<Bytes>> =
        (0..64u8).map(|i| Ok(Bytes::from(vec![i; 1024]))).collect();
    let expected: Vec<u8> = (0..64u8).flat_map(|i| vec![i; 1024]).collect();
    let body: ObjectBody = Box::pin(futures_util::stream::iter(chunks));
    let (tx, rx) = mpsc::channel(4);

    let (end, (bytes, failure)) = tokio::join!(pump(body, tx, 1024 * 1024), drain(rx));
    assert!(matches!(end, PumpEnd::Complete(65536)));
    assert!(failure.is_none());
    assert_eq!(bytes, expected);
}

#[tokio::test]
async fn the_pump_refuses_a_body_over_the_limit_and_tells_the_reader() {
    let (tx, rx) = mpsc::channel(4);
    let (end, (_, failure)) = tokio::join!(pump(body_from_bytes(vec![0u8; 64]), tx, 16), drain(rx));
    assert!(matches!(end, PumpEnd::TooLarge));
    assert!(
        failure.is_some(),
        "the reader sees an error, so the archive read fails rather than ending short"
    );
}

#[tokio::test]
async fn the_pump_stops_at_the_limit_rather_than_after_the_whole_body() {
    // The limit has to bite while reading, not once the body is fully read: an
    // endless stream can only end by the limit firing.
    let endless = futures_util::stream::repeat_with(|| Ok(Bytes::from(vec![7u8; 4096])));
    let (tx, rx) = mpsc::channel(4);
    let (end, (bytes, _)) = tokio::join!(pump(Box::pin(endless), tx, 64 * 1024), drain(rx));
    assert!(matches!(end, PumpEnd::TooLarge));
    assert!(
        bytes.len() <= 64 * 1024,
        "nothing past the limit was handed on"
    );
}

#[tokio::test]
async fn the_pump_passes_a_failed_body_on() {
    let body = futures_util::stream::iter(vec![
        Ok(Bytes::from_static(b"part")),
        Err(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "gone",
        )),
    ]);
    let (tx, rx) = mpsc::channel(4);
    let (end, (bytes, failure)) = tokio::join!(pump(Box::pin(body), tx, 1024), drain(rx));
    assert!(
        matches!(end, PumpEnd::Failed(ref err) if err.kind() == std::io::ErrorKind::ConnectionReset)
    );
    assert_eq!(bytes, b"part");
    assert_eq!(
        failure.map(|err| err.kind()),
        Some(std::io::ErrorKind::ConnectionReset)
    );
}

#[tokio::test]
async fn the_pump_stops_when_the_reader_goes_away() {
    // The archive ended (or the upload failed elsewhere): reading the rest of the
    // body would be work for nobody.
    let endless = futures_util::stream::repeat_with(|| Ok(Bytes::from(vec![1u8; 1024])));
    let (tx, rx) = mpsc::channel(1);
    drop(rx);
    assert!(matches!(
        pump(Box::pin(endless), tx, u64::MAX).await,
        PumpEnd::ReaderGone(1024)
    ));
}

#[tokio::test]
async fn the_reader_reads_across_chunks_and_returns_the_pumps_verdict() {
    let (tx, rx) = mpsc::channel(8);
    tx.send(Ok(Bytes::from_static(b"hello "))).await.unwrap();
    tx.send(Ok(Bytes::new())).await.unwrap();
    tx.send(Ok(Bytes::from_static(b"world"))).await.unwrap();
    tx.send(Err(std::io::Error::other("over the limit")))
        .await
        .unwrap();
    drop(tx);
    let (text, err) = tokio::task::spawn_blocking(move || {
        let mut reader = ChannelReader::new(rx);
        let mut text = Vec::new();
        let mut buffer = [0u8; 4];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return (text, None),
                Ok(n) => text.extend_from_slice(&buffer[..n]),
                Err(err) => return (text, Some(err)),
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(text, b"hello world");
    assert_eq!(
        err.map(|err| err.to_string()).as_deref(),
        Some("over the limit")
    );
}

#[test]
fn an_entry_path_keeps_its_normal_segments() {
    assert!(matches!(
        tree_path(Path::new("implementation/dist/index.html")),
        Ok(path) if path == "implementation/dist/index.html"
    ));
    // A leading `./` is harmless and stripped.
    assert!(
        matches!(tree_path(Path::new("./run-record.json")), Ok(path) if path == "run-record.json")
    );
    // The archive root a driver's `append_dir_all("")` writes names nothing.
    assert!(matches!(tree_path(Path::new("")), Ok(path) if path.is_empty()));
}

#[test]
fn an_entry_path_that_leaves_the_tree_is_refused() {
    for path in [
        "../escape.txt",
        "implementation/../../escape.txt",
        "/etc/passwd",
    ] {
        assert!(
            matches!(tree_path(Path::new(path)), Err(UnpackError::Traversal(_))),
            "`{path}` must be refused"
        );
    }
}
