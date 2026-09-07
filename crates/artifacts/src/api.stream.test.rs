//! Tests for `ChannelWriter`, the sink the two whole-tree downloads write their
//! archive into.
//!
//! The property under test is the sibling of the one `api.spool.test.rs` pins for
//! uploads: a *read* of a stored tree must not set the service's peak allocation
//! either. `archive` is ungated — the console links it as a plain download — so the
//! size of what this service is asked to build is a reviewer's choice, and it used to
//! be held whole in memory before a byte was answered. Two properties make the
//! streaming replacement safe, and both are here: bytes leave in bounded chunks as
//! they are written, and a receiver that has gone away stops the walk instead of
//! being written to forever.

use std::io::Write;

use bytes::Bytes;

use super::{ChannelWriter, STREAM_CHUNK_BYTES};

/// Drive `body` on a blocking thread against a channel, collecting every chunk the
/// writer emits. Answers the chunks and the byte total `finish` reported.
///
/// `blocking_send` panics on an async runtime thread, which is exactly how the writer
/// is used in the service (inside `spawn_blocking`), so the tests drive it the same
/// way rather than calling it inline.
async fn drive(
    capacity: usize,
    body: impl FnOnce(&mut ChannelWriter) + Send + 'static,
) -> (Vec<Bytes>, u64) {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(capacity);
    let writer = tokio::task::spawn_blocking(move || {
        let mut writer = ChannelWriter::new(tx);
        body(&mut writer);
        writer.finish(true)
    });
    let mut chunks = Vec::new();
    while let Some(chunk) = rx.recv().await {
        chunks.push(chunk.expect("the writer only sends Ok chunks"));
    }
    (chunks, writer.await.expect("the writer task"))
}

/// Drive `body` as [`drive`] does, but end it as a walk that FAILED: answer the
/// chunks that reached the body and the error, if any, the stream ended with.
async fn drive_failing(
    body: impl FnOnce(&mut ChannelWriter) + Send + 'static,
) -> (Vec<Bytes>, Option<std::io::Error>) {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);
    let task = tokio::task::spawn_blocking(move || {
        let mut writer = ChannelWriter::new(tx);
        body(&mut writer);
        writer.finish(false)
    });
    let mut chunks = Vec::new();
    let mut failure = None;
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => chunks.push(chunk),
            Err(err) => failure = Some(err),
        }
    }
    task.await.expect("the writer task");
    (chunks, failure)
}

#[tokio::test]
async fn sends_full_chunks_as_they_are_written_and_flushes_the_tail() {
    // A tar walk writes in header- and file-sized pieces, not in chunk-sized ones, so
    // the writer is what turns them into frames. Two full chunks plus a remainder is
    // the shape that catches both an off-by-one at the boundary and a tail dropped on
    // the floor by `finish`.
    let payload = STREAM_CHUNK_BYTES * 2 + 100;
    assert_eq!(payload % 4, 0, "the loop below writes in fours");
    let (chunks, written) = drive(64, move |writer| {
        for _ in 0..payload / 4 {
            writer.write_all(b"abcd").expect("write");
        }
    })
    .await;

    assert_eq!(
        written, payload as u64,
        "every byte written is accounted for"
    );
    assert_eq!(
        chunks.len(),
        3,
        "two full chunks plus the flushed remainder, got {:?}",
        chunks.iter().map(Bytes::len).collect::<Vec<_>>()
    );
    assert_eq!(chunks[0].len(), STREAM_CHUNK_BYTES);
    assert_eq!(chunks[1].len(), STREAM_CHUNK_BYTES);
    assert_eq!(chunks[2].len(), 100);
    assert_eq!(
        chunks.iter().map(Bytes::len).sum::<usize>(),
        payload,
        "the body is the written bytes, in order and whole"
    );
}

#[tokio::test]
async fn a_single_large_write_is_split_into_chunks() {
    // `append_dir_all` hands the tar builder whole file blocks, so one `write` can be
    // far larger than a chunk. Splitting has to happen inside that call rather than
    // between calls, or a large file in a run tree would go out as one frame and put
    // the whole file back in memory.
    let (chunks, written) = drive(64, |writer| {
        writer
            .write_all(&vec![7u8; STREAM_CHUNK_BYTES * 3])
            .expect("write");
    })
    .await;

    assert_eq!(written, (STREAM_CHUNK_BYTES * 3) as u64);
    assert_eq!(chunks.len(), 3);
    assert!(chunks.iter().all(|chunk| chunk.len() == STREAM_CHUNK_BYTES));
}

#[tokio::test]
async fn nothing_written_sends_nothing() {
    // An empty run tree still produces a tar (its terminating blocks), but the writer
    // itself must not invent a frame — a zero-length chunk is a legal but pointless
    // body frame, and `flush` is called unconditionally by `finish`.
    let (chunks, written) = drive(64, |_writer| {}).await;

    assert!(chunks.is_empty(), "no bytes written, no frames sent");
    assert_eq!(written, 0);
}

#[tokio::test]
async fn a_walk_that_failed_ends_the_body_with_an_error_and_drops_its_tail() {
    // THE DEFECT THIS PINS. `tar::Builder` writes an archive's two terminating zero
    // blocks from its own `Drop`, and `GzEncoder` writes a gzip trailer from its —
    // both on the way out of a walk that returned `Err`. So the bytes of a truncated
    // archive are a *complete* archive: the publisher's `unpack` succeeds, `tar -tzf`
    // exits 0, and a run is released with files missing and nothing said anywhere. The
    // signal cannot live in the framing, so it lives in the body: the tail written
    // after the fault is withheld, and the stream ends with an error, which aborts the
    // chunked response instead of closing it.
    let (chunks, failure) = drive_failing(|writer| {
        writer.write_all(b"a file that made it").expect("write");
        // What the tar builder's `Drop` contributes on its way out of the failure.
        writer.write_all(&[0u8; 1024]).expect("write");
    })
    .await;

    assert!(
        chunks.is_empty(),
        "the buffered tail — the terminator included — is not sent"
    );
    let failure = failure.expect("the body ends with an error, not with a clean close");
    assert_eq!(failure.kind(), std::io::ErrorKind::Other);
}

#[tokio::test]
async fn a_walk_that_panicked_ends_the_body_with_an_error() {
    // The `Result` path above cannot cover this one: a panic inside the blocking task
    // unwinds past `finish` entirely. The writer's `Drop` runs either way, which is
    // why the signal is put there rather than in `streamed_archive`'s match.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);
    let task = tokio::task::spawn_blocking(move || {
        let mut writer = ChannelWriter::new(tx);
        writer.write_all(b"part of a tree").expect("write");
        panic!("the walk fell over");
    });

    let mut failure = None;
    while let Some(item) = rx.recv().await {
        if let Err(err) = item {
            failure = Some(err);
        }
    }
    assert!(task.await.is_err(), "the task panicked");
    assert!(
        failure.is_some(),
        "an unwinding walk still aborts the body rather than ending it"
    );
}

#[tokio::test]
async fn a_receiver_that_hung_up_surfaces_as_a_broken_pipe() {
    // This is the abort path: a reviewer cancelling a download must stop the tar walk,
    // not merely have its bytes discarded. The store surfaces the error and gives up
    // the walk (see `a_sink_that_fails_aborts_the_walk_rather_than_finishing_it`), so
    // the writer's job is to raise it at all.
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(1);
    drop(rx);

    let err = tokio::task::spawn_blocking(move || {
        let mut writer = ChannelWriter::new(tx);
        writer
            .write_all(&vec![0u8; STREAM_CHUNK_BYTES])
            .unwrap_err()
    })
    .await
    .expect("the writer task");

    assert_eq!(err.kind(), std::io::ErrorKind::BrokenPipe);
}

#[tokio::test]
async fn a_slow_reader_back_pressures_the_writer() {
    // The bound on this service's memory *is* the channel: a walk that outran a slow
    // client would put the tree back in the queue an armful at a time. With a
    // one-chunk buffer the writer can complete at most one send beyond what the reader
    // has taken, and that ceiling is an invariant of `blocking_send`, not a timing
    // guess — so it can be asserted without a sleep.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(1);
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let writer = tokio::task::spawn_blocking(move || {
        let mut writer = ChannelWriter::new(tx);
        for _ in 0..4 {
            writer
                .write_all(&vec![1u8; STREAM_CHUNK_BYTES])
                .expect("write");
            let _ = progress_tx.send(());
        }
        writer.finish(true)
    });

    let mut read = 0usize;
    let mut done = 0usize;
    while let Some(chunk) = rx.recv().await {
        read += chunk.expect("chunk").len() / STREAM_CHUNK_BYTES;
        while progress_rx.try_recv().is_ok() {
            done += 1;
        }
        assert!(
            done <= read + 1,
            "the walk ran {done} chunks ahead of a reader that has taken {read}"
        );
    }

    assert_eq!(read, 4);
    assert_eq!(
        writer.await.expect("the writer task"),
        (STREAM_CHUNK_BYTES * 4) as u64
    );
}
