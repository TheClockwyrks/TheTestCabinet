//! Streaming an uploaded `tar` archive into objects, one per file, as it
//! arrives.
//!
//! An upload is the far end of the driver's run-end transfer, and its size is
//! set by the run that produced it rather than by this service, so nothing here
//! holds the archive: not in memory, and not on a disk the service does not
//! have. Three parts run at once and hand bytes along bounded channels:
//!
//! - the **pump** reads the request body and counts it against the limit,
//!   cutting the body off with an error the moment the limit is passed;
//! - the **unpacker**, on a blocking thread because the `tar` reader is
//!   synchronous, reads the archive's entries from the pump and hands each
//!   file's bytes on as they are read;
//! - the **writer** writes each file as an object, a few at once, so a tree of
//!   many small files is not one round trip per file in series.
//!
//! Each channel is bounded, so a slow object store slows the unpacker, which
//! slows the pump, which stops reading the request: the peak allocation is a
//! few chunks per file in flight plus the one piece each object write stages,
//! whatever the archive's size.

use bytes::Bytes;
use futures_util::StreamExt as _;
use futures_util::stream::FuturesUnordered;
use tokio::sync::mpsc;

use super::{ObjectStore, StoreError};
use crate::object::ObjectBody;

/// How many chunks of the request body may wait between the pump and the
/// unpacker.
const BODY_CHUNKS: usize = 8;

/// How many chunks of one file may wait between the unpacker and its object
/// write. A file that fits is handed over whole and the unpacker moves on to
/// the next one while it is written.
const FILE_CHUNKS: usize = 16;

/// The size of the reads the unpacker takes a file's bytes in.
const READ_SIZE: usize = 64 * 1024;

/// How many object writes are in flight at once. Each holds at most one staged
/// piece of its object and [`FILE_CHUNKS`] chunks of [`READ_SIZE`].
const CONCURRENT_PUTS: usize = 8;

/// What a stored upload amounted to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoredUpload {
    /// The bytes of the request body read.
    pub bytes: u64,
    /// The files stored.
    pub files: u64,
}

/// One file of the archive on its way to the object store.
struct FileItem {
    /// Its path within the tree, normalized.
    path: String,
    /// Its bytes, as the unpacker reads them.
    chunks: mpsc::Receiver<std::io::Result<Bytes>>,
}

/// How the pump ended.
enum PumpEnd {
    /// The body was read to its end.
    Complete(u64),
    /// The unpacker stopped reading before the body ended: the archive ended,
    /// or the upload failed elsewhere.
    ReaderGone(u64),
    /// The body passed the limit.
    TooLarge,
    /// The body failed to read.
    Failed(std::io::Error),
}

/// Why the unpacker stopped.
enum UnpackError {
    /// An entry's path would leave the tree.
    Traversal(String),
    /// The archive is not one this service stores.
    Archive(String),
    /// Reading the archive failed: a truncated or malformed archive, or the
    /// body behind it cut off.
    Read(std::io::Error),
    /// The writer stopped taking files, because a write failed.
    WriterGone,
}

/// Stream the `tar` archive `body` into objects under `prefix` (one per file,
/// keyed `<prefix><path>`), reading at most `limit` bytes of it.
///
/// Directory entries are skipped (an object store has none), and so are
/// symbolic links, devices and the like, which name no bytes of the tree. An
/// entry whose path leaves the tree is [`StoreError::Traversal`]; a path that
/// appears twice, an archive with no files, or an unreadable archive is
/// [`StoreError::Archive`]; a body over `limit` is [`StoreError::TooLarge`]. On
/// any error some objects under `prefix` may have been written, and the caller
/// discards them.
pub(super) async fn unpack(
    objects: &dyn ObjectStore,
    prefix: &str,
    body: ObjectBody,
    limit: u64,
) -> Result<StoredUpload, StoreError> {
    let (body_tx, body_rx) = mpsc::channel(BODY_CHUNKS);
    let (file_tx, file_rx) = mpsc::channel(1);
    let unpacker =
        tokio::task::spawn_blocking(move || read_entries(ChannelReader::new(body_rx), &file_tx));

    let (pumped, written) = tokio::join!(
        pump(body, body_tx, limit),
        write_files(objects, prefix, file_rx)
    );
    let unpacked = unpacker
        .await
        .map_err(|err| StoreError::Backend(format!("the unpack task failed: {err}").into()))?;

    // The causes are ordered so the response names what the caller did: the
    // body passing the limit or failing is why the archive read failed, and a
    // failed write is why the unpacker found nobody taking its files.
    let bytes = match pumped {
        PumpEnd::TooLarge => return Err(StoreError::TooLarge(limit)),
        PumpEnd::Failed(err) => return Err(StoreError::UploadBody(err)),
        PumpEnd::Complete(bytes) | PumpEnd::ReaderGone(bytes) => bytes,
    };
    written?;
    let files = match unpacked {
        Ok(files) => files,
        Err(UnpackError::Traversal(path)) => return Err(StoreError::Traversal(path)),
        Err(UnpackError::Archive(why)) => return Err(StoreError::Archive(why)),
        Err(UnpackError::Read(err)) => return Err(StoreError::Archive(err.to_string())),
        Err(UnpackError::WriterGone) => {
            return Err(StoreError::Backend(
                "the object writer stopped before the archive ended".into(),
            ));
        }
    };
    Ok(StoredUpload { bytes, files })
}

/// Read `body` into `tx`, refusing it once more than `limit` bytes have been
/// read. The limit is applied per chunk rather than from a `Content-Length`,
/// which a chunked request does not carry and a hostile one may understate.
async fn pump(
    mut body: ObjectBody,
    tx: mpsc::Sender<std::io::Result<Bytes>>,
    limit: u64,
) -> PumpEnd {
    let mut read: u64 = 0;
    while let Some(chunk) = body.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                let _ = tx
                    .send(Err(std::io::Error::new(err.kind(), err.to_string())))
                    .await;
                return PumpEnd::Failed(err);
            }
        };
        read = read.saturating_add(chunk.len() as u64);
        if read > limit {
            let _ = tx
                .send(Err(std::io::Error::other(format!(
                    "the upload exceeds the {limit} byte limit"
                ))))
                .await;
            return PumpEnd::TooLarge;
        }
        if tx.send(Ok(chunk)).await.is_err() {
            return PumpEnd::ReaderGone(read);
        }
    }
    PumpEnd::Complete(read)
}

/// Write each file `rx` hands over as an object under `prefix`, keeping up to
/// [`CONCURRENT_PUTS`] writes in flight. Stops at the first failed write.
async fn write_files(
    objects: &dyn ObjectStore,
    prefix: &str,
    mut rx: mpsc::Receiver<FileItem>,
) -> Result<(), StoreError> {
    let mut in_flight = FuturesUnordered::new();
    let mut open = true;
    loop {
        tokio::select! {
            item = rx.recv(), if open && in_flight.len() < CONCURRENT_PUTS => match item {
                Some(item) => in_flight.push(put_file(objects, prefix, item)),
                None => open = false,
            },
            Some(result) = in_flight.next(), if !in_flight.is_empty() => {
                result?;
            }
            else => return Ok(()),
        }
    }
}

/// Write one file as an object.
async fn put_file(
    objects: &dyn ObjectStore,
    prefix: &str,
    item: FileItem,
) -> Result<u64, StoreError> {
    let key = format!("{prefix}{}", item.path);
    let content_type = test_cabinet_contracts::layout::content_type_for(&item.path);
    let body: ObjectBody = Box::pin(futures_util::stream::unfold(
        item.chunks,
        |mut rx| async move { rx.recv().await.map(|chunk| (chunk, rx)) },
    ));
    objects.put(&key, body, content_type).await
}

/// Read the archive's entries from `reader`, handing each file to `files`.
/// Answers how many files were handed over.
fn read_entries(reader: ChannelReader, files: &mpsc::Sender<FileItem>) -> Result<u64, UnpackError> {
    let mut archive = tar::Archive::new(reader);
    let mut seen = std::collections::HashSet::new();
    let mut count: u64 = 0;
    for entry in archive.entries().map_err(UnpackError::Read)? {
        let mut entry = entry.map_err(UnpackError::Read)?;
        let raw = entry.path().map_err(UnpackError::Read)?.into_owned();
        // The path is checked before the entry's type, so an archive carrying a
        // traversal is refused whatever kind of entry carries it.
        let path = tree_path(&raw)?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        if path.is_empty() {
            return Err(UnpackError::Archive(
                "a file entry has an empty path".to_string(),
            ));
        }
        if !seen.insert(path.clone()) {
            return Err(UnpackError::Archive(format!("`{path}` appears twice")));
        }

        let (tx, chunks) = mpsc::channel(FILE_CHUNKS);
        files
            .blocking_send(FileItem { path, chunks })
            .map_err(|_| UnpackError::WriterGone)?;
        let mut buffer = vec![0u8; READ_SIZE];
        loop {
            match std::io::Read::read(&mut entry, &mut buffer) {
                Ok(0) => break,
                Ok(n) => tx
                    .blocking_send(Ok(Bytes::copy_from_slice(&buffer[..n])))
                    .map_err(|_| UnpackError::WriterGone)?,
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
                Err(err) => {
                    // Fail the object's write too, so a file cut short is never
                    // stored as if it were whole.
                    let _ = tx.blocking_send(Err(std::io::Error::new(err.kind(), err.to_string())));
                    return Err(UnpackError::Read(err));
                }
            }
        }
        count += 1;
    }
    if count == 0 {
        return Err(UnpackError::Archive(
            "the archive holds no files".to_string(),
        ));
    }
    Ok(count)
}

/// An entry's path as a path within the tree: its normal segments joined by
/// `/`, `.` segments dropped. A `..` segment, an absolute path or a drive
/// prefix would leave the tree and is refused; a segment that is not UTF-8
/// cannot be a key.
fn tree_path(raw: &std::path::Path) -> Result<String, UnpackError> {
    use std::path::Component;
    let mut segments = Vec::new();
    for component in raw.components() {
        match component {
            Component::Normal(segment) => segments.push(segment.to_str().ok_or_else(|| {
                UnpackError::Archive(format!("`{}` is not a UTF-8 path", raw.display()))
            })?),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(UnpackError::Traversal(raw.display().to_string()));
            }
        }
    }
    Ok(segments.join("/"))
}

/// A blocking [`std::io::Read`] over the chunks the pump hands along. An error
/// item is the pump's verdict on the body, returned to the reader as is; the
/// channel closing is the end of the body.
struct ChannelReader {
    rx: mpsc::Receiver<std::io::Result<Bytes>>,
    current: Bytes,
}

impl ChannelReader {
    fn new(rx: mpsc::Receiver<std::io::Result<Bytes>>) -> Self {
        Self {
            rx,
            current: Bytes::new(),
        }
    }
}

impl std::io::Read for ChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        while self.current.is_empty() {
            match self.rx.blocking_recv() {
                Some(Ok(chunk)) => self.current = chunk,
                Some(Err(err)) => return Err(err),
                None => return Ok(0),
            }
        }
        let n = buf.len().min(self.current.len());
        buf[..n].copy_from_slice(&self.current.split_to(n));
        Ok(n)
    }
}

#[cfg(test)]
#[path = "store.upload.test.rs"]
mod tests;
