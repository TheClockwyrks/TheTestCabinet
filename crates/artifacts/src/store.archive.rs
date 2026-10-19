//! Building a `tar` (or gzip `tar`) of a stored tree as its objects are read.
//!
//! The two whole-tree downloads are written to the response as the archive is
//! built, never assembled first: `archive.tar.gz` is any reviewer's to ask for,
//! so the size of what it builds is a caller's choice and must not set the
//! service's peak allocation. Two parts run at once:
//!
//! - the **feeder**, a task on the runtime, lists the tree and reads each object
//!   it selects, handing its bytes on along a bounded channel;
//! - the **writer**, on a blocking thread because the `tar` and gzip encoders are
//!   synchronous (and compressing is CPU work the runtime should not carry),
//!   frames each object as an entry into the response's sink.
//!
//! Both channels are bounded and the sink back-pressures, so a client on a slow
//! link slows the reads down. The writer holds each entry to the size the store
//! reported for it, because the `tar` builder pads whatever it is given: an
//! object cut short would otherwise become a well-formed entry with the wrong
//! bytes in it. And the writer finishes the archive only on the feeder's
//! explicit end, so a feeder that failed or panicked part-way leaves an error,
//! never a shorter archive that looks whole.

use std::io::Write;

use bytes::Bytes;
use flate2::Compression;
use flate2::write::GzEncoder;
use futures_util::StreamExt as _;
use tokio::sync::mpsc;

use super::{RunTree, StoreError};

/// Which archive of a tree to build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveShape {
    /// The publisher's source tree, `tree.tar`: the whole `implementation/`
    /// directory, then `run-record.json` and `events.jsonl` when present, as a
    /// plain `tar` whose paths are relative to the run root, the layout the
    /// driver uploaded. The proof, asset and validation media beside
    /// `implementation/` and `raw.jsonl` are not part of it.
    Source,
    /// The reviewer's download, `archive.tar.gz`: every file of the tree under a
    /// `<run-id>/` prefix, so it unpacks into its own directory, gzip-framed.
    Whole,
}

/// How many chunks of one object may wait between the feeder and the writer.
const ENTRY_CHUNKS: usize = 8;

/// One message from the feeder to the writer.
enum FeedItem {
    /// The next entry and its bytes.
    Entry {
        /// The entry's path in the archive.
        path: String,
        /// The object's size, which the entry's bytes are held to.
        size: u64,
        /// The object's last-modified time, seconds since the epoch.
        mtime: u64,
        /// Its bytes, as they are read.
        chunks: mpsc::Receiver<std::io::Result<Bytes>>,
    },
    /// Every entry has been sent.
    End,
}

/// An archive of a tree being built, from [`start_archive`].
pub struct ArchiveFeed {
    shape: ArchiveShape,
    feed: mpsc::Receiver<std::io::Result<FeedItem>>,
}

/// Start reading the objects of `tree` that `shape` selects. The returned feed
/// is written into a sink by [`write_archive`], on a blocking thread. Must be
/// called within the runtime, which the feeder is spawned on.
pub fn start_archive(tree: RunTree, shape: ArchiveShape) -> ArchiveFeed {
    let (tx, feed) = mpsc::channel(1);
    tokio::spawn(async move {
        if let Err(err) = feed_entries(&tree, shape, &tx).await {
            // A writer that already went away has no one to tell.
            let _ = tx.send(Err(std::io::Error::other(err.to_string()))).await;
        }
    });
    ArchiveFeed { shape, feed }
}

/// The paths of `tree` that `shape` selects, in archive order, and the prefix
/// each is archived under.
async fn select(tree: &RunTree, shape: ArchiveShape) -> Result<(Vec<String>, String), StoreError> {
    let all = tree.list("").await?;
    Ok(match shape {
        ArchiveShape::Source => {
            let mut paths: Vec<String> = all
                .iter()
                .filter(|object| object.path.starts_with("implementation/"))
                .map(|object| object.path.clone())
                .collect();
            for file in ["run-record.json", "events.jsonl"] {
                if all.iter().any(|object| object.path == file) {
                    paths.push(file.to_string());
                }
            }
            (paths, String::new())
        }
        ArchiveShape::Whole => (
            all.into_iter().map(|object| object.path).collect(),
            format!("{}/", tree.id()),
        ),
    })
}

/// Read every selected object and hand it to the writer, ending with
/// [`FeedItem::End`]. Returns early, quietly, when the writer has gone away.
async fn feed_entries(
    tree: &RunTree,
    shape: ArchiveShape,
    tx: &mpsc::Sender<std::io::Result<FeedItem>>,
) -> Result<(), StoreError> {
    let (paths, prefix) = select(tree, shape).await?;
    for path in paths {
        // An object listed but gone by the time it is read was replaced or
        // deleted under the walk; the archive cannot be whole.
        let object = tree
            .get(&path)
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("{}/{path}", tree.id())))?;
        let (chunk_tx, chunks) = mpsc::channel(ENTRY_CHUNKS);
        let entry = FeedItem::Entry {
            path: format!("{prefix}{path}"),
            size: object.properties.content_length,
            mtime: object
                .properties
                .last_modified
                .map_or(0, |at| u64::try_from(at.unix_timestamp()).unwrap_or(0)),
            chunks,
        };
        if tx.send(Ok(entry)).await.is_err() {
            return Ok(());
        }
        let mut body = object.body;
        while let Some(chunk) = body.next().await {
            let failed = chunk.is_err();
            if chunk_tx.send(chunk).await.is_err() {
                return Ok(());
            }
            if failed {
                return Ok(());
            }
        }
    }
    let _ = tx.send(Ok(FeedItem::End)).await;
    Ok(())
}

/// Write `feed`'s archive into `out` as its objects arrive. Blocking: run it on
/// the blocking pool.
///
/// An `Err` means the archive in `out` is PARTIAL, and the caller must make its
/// reader see that. It cannot be inferred from the bytes: the `tar` builder and
/// the gzip encoder terminate their framing from their own `Drop` on the way out
/// of a failing walk, so a truncated archive is a well-formed one. The streaming
/// caller answers it by aborting the response body (see `ChannelWriter` in
/// `api.rs`). A sink that fails (a client that hung up) aborts the walk with
/// that error rather than finishing an archive nobody is reading.
pub fn write_archive(mut feed: ArchiveFeed, out: &mut dyn Write) -> Result<(), StoreError> {
    match feed.shape {
        ArchiveShape::Source => {
            let mut builder = tar::Builder::new(out);
            append_entries(&mut feed.feed, &mut builder)?;
            // `finish` writes the two zero blocks that terminate a tar. Calling it
            // explicitly, rather than leaving it to `Drop` (which swallows the
            // result), is what makes a sink failure on the last write reach the
            // caller.
            builder.finish().map_err(StoreError::Body)?;
        }
        ArchiveShape::Whole => {
            // Compress into the sink as the archive is built, so neither the tar
            // nor its compressed form is ever held whole.
            let encoder = GzEncoder::new(out, Compression::default());
            let mut builder = tar::Builder::new(encoder);
            append_entries(&mut feed.feed, &mut builder)?;
            builder.finish().map_err(StoreError::Body)?;
            builder
                .into_inner()
                .and_then(GzEncoder::finish)
                .map_err(StoreError::Body)?;
        }
    }
    Ok(())
}

/// Append every entry of `feed` to `builder`, until the feeder's end.
fn append_entries<W: Write>(
    feed: &mut mpsc::Receiver<std::io::Result<FeedItem>>,
    builder: &mut tar::Builder<W>,
) -> Result<(), StoreError> {
    loop {
        match feed.blocking_recv() {
            Some(Ok(FeedItem::Entry {
                path,
                size,
                mtime,
                chunks,
            })) => {
                let mut header = tar::Header::new_gnu();
                header.set_entry_type(tar::EntryType::Regular);
                header.set_size(size);
                header.set_mode(0o644);
                header.set_mtime(mtime);
                let reader = ExactReader {
                    rx: chunks,
                    current: Bytes::new(),
                    remaining: size,
                };
                builder
                    .append_data(&mut header, &path, reader)
                    .map_err(StoreError::Body)?;
            }
            Some(Ok(FeedItem::End)) => return Ok(()),
            Some(Err(err)) => return Err(StoreError::Body(err)),
            // The feeder stopped without saying it was done: it panicked, or the
            // runtime is shutting down. The archive is not whole.
            None => {
                return Err(StoreError::Body(std::io::Error::other(
                    "the archive's objects stopped before the tree had been read",
                )));
            }
        }
    }
}

/// A blocking reader of one entry's bytes, held to exactly `remaining` bytes:
/// fewer is an `UnexpectedEof`, more is `InvalidData`.
struct ExactReader {
    rx: mpsc::Receiver<std::io::Result<Bytes>>,
    current: Bytes,
    remaining: u64,
}

impl std::io::Read for ExactReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.remaining == 0 {
            return Ok(0);
        }
        while self.current.is_empty() {
            match self.rx.blocking_recv() {
                Some(Ok(chunk)) => self.current = chunk,
                Some(Err(err)) => return Err(err),
                None => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        format!("an object ended {} bytes short", self.remaining),
                    ));
                }
            }
        }
        if self.current.len() as u64 > self.remaining {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "an object is longer than its listed size",
            ));
        }
        let n = buf.len().min(self.current.len());
        buf[..n].copy_from_slice(&self.current.split_to(n));
        self.remaining -= n as u64;
        Ok(n)
    }
}

#[cfg(test)]
#[path = "store.archive.test.rs"]
mod tests;
