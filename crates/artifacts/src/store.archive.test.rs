//! Tests for the archive writer's guards: an entry held to the size the store
//! reported, and an archive finished only on the feeder's explicit end.

use bytes::Bytes;
use tokio::sync::mpsc;

use super::{ArchiveFeed, ArchiveShape, FeedItem, write_archive};
use crate::store::StoreError;

/// A feed of one entry claiming `size` bytes and carrying `body`, ended with
/// [`FeedItem::End`] when `end` is set.
fn feed(size: u64, body: &'static [u8], end: bool) -> ArchiveFeed {
    let (tx, rx) = mpsc::channel(4);
    let (chunk_tx, chunks) = mpsc::channel(4);
    chunk_tx.try_send(Ok(Bytes::from_static(body))).unwrap();
    drop(chunk_tx);
    tx.try_send(Ok(FeedItem::Entry {
        path: "a.bin".to_string(),
        size,
        mtime: 0,
        chunks,
    }))
    .unwrap();
    if end {
        tx.try_send(Ok(FeedItem::End)).unwrap();
    }
    ArchiveFeed {
        shape: ArchiveShape::Source,
        feed: rx,
    }
}

/// Write `feed` into a buffer on a blocking thread.
async fn write(feed: ArchiveFeed) -> Result<Vec<u8>, StoreError> {
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        write_archive(feed, &mut out).map(|()| out)
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn a_whole_feed_is_a_whole_archive() {
    let archive = write(feed(5, b"hello", true)).await.expect("archive");
    let mut reader = tar::Archive::new(&archive[..]);
    let mut entries = reader.entries().unwrap();
    let mut entry = entries.next().unwrap().unwrap();
    let mut body = Vec::new();
    std::io::Read::read_to_end(&mut entry, &mut body).unwrap();
    assert_eq!(body, b"hello");
}

#[tokio::test]
async fn an_object_shorter_than_its_size_fails_the_archive() {
    // The tar builder pads whatever it is given, so without the size check a short
    // object would become a well-formed entry with the wrong bytes in it.
    let err = write(feed(10, b"hello", true)).await.expect_err("short");
    assert!(
        matches!(err, StoreError::Body(ref io) if io.kind() == std::io::ErrorKind::UnexpectedEof),
        "got {err:?}"
    );
}

#[tokio::test]
async fn an_object_longer_than_its_size_fails_the_archive() {
    let err = write(feed(2, b"hello", true)).await.expect_err("long");
    assert!(
        matches!(err, StoreError::Body(ref io) if io.kind() == std::io::ErrorKind::InvalidData),
        "got {err:?}"
    );
}

#[tokio::test]
async fn a_feed_that_stops_without_its_end_fails_the_archive() {
    // A feeder that panicked or was dropped closes the channel without saying it is
    // done; finishing the archive then would hand out a shorter one that looks whole.
    let err = write(feed(5, b"hello", false)).await.expect_err("no end");
    assert!(matches!(err, StoreError::Body(_)), "got {err:?}");
}
