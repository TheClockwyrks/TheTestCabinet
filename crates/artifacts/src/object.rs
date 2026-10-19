//! The shapes both object stores answer in, shared by the [Blob](crate::blob)
//! and [R2](crate::r2) clients and the [public store](crate::public) over them.
//!
//! A read hands back an [`ObjectStream`]: the object's [`ObjectProperties`] and
//! its body as a stream of chunks, so a caller relays an object of any size with
//! a bounded buffer. A write takes an [`ObjectBody`] in the same shape and is cut
//! into fixed-size pieces by a [`Chunker`]: an object that fits one piece is
//! written in one request, and a larger one is staged piece by piece (Blob
//! blocks, S3 multipart parts) and committed whole, so a reader never sees a
//! partial object and the writer never holds more than one piece.

use std::pin::Pin;

use bytes::{Bytes, BytesMut};
use futures_util::{Stream, StreamExt as _};
use time::OffsetDateTime;
use time::format_description::FormatItem;
use time::macros::format_description;

/// An object's body as a stream of byte chunks. A transport or read failure
/// surfaces as an `io::Error` item, after which the stream yields nothing more.
pub type ObjectBody = Pin<Box<dyn Stream<Item = std::io::Result<Bytes>> + Send>>;

/// Wrap an in-memory buffer as a one-chunk [`ObjectBody`].
pub fn body_from_bytes(bytes: impl Into<Bytes>) -> ObjectBody {
    let bytes = bytes.into();
    Box::pin(futures_util::stream::iter(
        (!bytes.is_empty()).then_some(Ok(bytes)),
    ))
}

/// Collect an [`ObjectBody`] into one buffer. For tests and small objects only:
/// a body of unbounded size is relayed chunk by chunk instead.
pub async fn collect_body(mut body: ObjectBody) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    while let Some(chunk) = body.next().await {
        out.extend_from_slice(&chunk?);
    }
    Ok(out)
}

/// What a store reports about one object, as read from a response's headers or
/// a listing entry.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ObjectProperties {
    /// The length of the body the response carries: the whole object, or the
    /// requested range of it.
    pub content_length: u64,
    /// The media type stored on the object, when one was.
    pub content_type: Option<String>,
    /// The content encoding stored on the object, when one was.
    pub content_encoding: Option<String>,
    /// When the object was last written.
    pub last_modified: Option<OffsetDateTime>,
    /// The store's entity tag for the object's current content.
    pub etag: Option<String>,
}

/// An object being read: its properties and its body.
pub struct ObjectStream {
    /// The object's properties, from the response headers.
    pub properties: ObjectProperties,
    /// The body, streamed as it arrives.
    pub body: ObjectBody,
}

impl std::fmt::Debug for ObjectStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ObjectStream")
            .field("properties", &self.properties)
            .finish_non_exhaustive()
    }
}

/// A byte range of an object to read, inclusive at both ends as HTTP ranges
/// are. `end: None` reads to the end of the object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    /// The first byte to read.
    pub start: u64,
    /// The last byte to read, or `None` for the rest of the object.
    pub end: Option<u64>,
}

impl ByteRange {
    /// The range as an HTTP `bytes=` range value.
    pub fn header_value(&self) -> String {
        match self.end {
            Some(end) => format!("bytes={}-{end}", self.start),
            None => format!("bytes={}-", self.start),
        }
    }
}

/// The size of the pieces a write is cut into: the single-request threshold and
/// the size of every staged block or part but the last. Large enough that a
/// 2 GiB object stays far below both stores' piece-count caps (50,000 Blob
/// blocks, 10,000 S3 parts), small enough that the one piece a writer holds is a
/// modest allocation.
pub const PIECE_SIZE: usize = 8 * 1024 * 1024;

/// Cuts an [`ObjectBody`] into pieces of exactly `size` bytes, the last piece
/// excepted, holding at most one piece plus one incoming chunk.
pub struct Chunker {
    body: ObjectBody,
    buffer: BytesMut,
    size: usize,
    done: bool,
}

impl Chunker {
    /// Cut `body` into pieces of `size` bytes.
    pub fn new(body: ObjectBody, size: usize) -> Self {
        Self {
            body,
            buffer: BytesMut::new(),
            size: size.max(1),
            done: false,
        }
    }

    /// The next piece: exactly `size` bytes, or fewer when the body ended, or
    /// `None` when nothing is left.
    pub async fn next_piece(&mut self) -> std::io::Result<Option<Bytes>> {
        while !self.done && self.buffer.len() < self.size {
            match self.body.next().await {
                Some(chunk) => self.buffer.extend_from_slice(&chunk?),
                None => self.done = true,
            }
        }
        if self.buffer.is_empty() {
            return Ok(None);
        }
        let take = self.buffer.len().min(self.size);
        Ok(Some(self.buffer.split_to(take).freeze()))
    }
}

/// How a write is shaped once its first pieces are read: one request, or staged.
pub enum Pieces {
    /// The whole body, which fits one request (possibly empty).
    Single(Bytes),
    /// The first two pieces of a body that needs staging, and the chunker the
    /// rest comes from.
    Staged {
        /// The first piece, `size` bytes.
        first: Bytes,
        /// The second piece.
        second: Bytes,
        /// The rest of the body.
        rest: Chunker,
    },
}

/// Read enough of `body` to decide whether it is written in one request or
/// staged. A body of at most one piece is [`Pieces::Single`].
pub async fn first_pieces(body: ObjectBody, size: usize) -> std::io::Result<Pieces> {
    let mut chunker = Chunker::new(body, size);
    let Some(first) = chunker.next_piece().await? else {
        return Ok(Pieces::Single(Bytes::new()));
    };
    if first.len() < chunker.size {
        return Ok(Pieces::Single(first));
    }
    match chunker.next_piece().await? {
        None => Ok(Pieces::Single(first)),
        Some(second) => Ok(Pieces::Staged {
            first,
            second,
            rest: chunker,
        }),
    }
}

/// `Sun, 06 Nov 1994 08:49:37 GMT`, the HTTP date (RFC 9110 IMF-fixdate) both
/// stores answer `Last-Modified` in and Blob's `x-ms-date` is sent in.
const HTTP_DATE: &[FormatItem<'_>] = format_description!(
    "[weekday repr:short], [day] [month repr:short] [year] [hour]:[minute]:[second] GMT"
);

/// Format a time as an HTTP date.
pub fn format_http_date(at: OffsetDateTime) -> String {
    at.to_offset(time::UtcOffset::UTC)
        .format(HTTP_DATE)
        .unwrap_or_default()
}

/// Parse an HTTP date, `None` when it is not one.
pub fn parse_http_date(text: &str) -> Option<OffsetDateTime> {
    time::PrimitiveDateTime::parse(text.trim(), HTTP_DATE)
        .ok()
        .map(time::PrimitiveDateTime::assume_utc)
}

/// Read an object's properties from a response's headers.
pub(crate) fn properties_from_headers(headers: &reqwest::header::HeaderMap) -> ObjectProperties {
    let text = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    ObjectProperties {
        content_length: text("content-length")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        content_type: text("content-type"),
        content_encoding: text("content-encoding"),
        last_modified: text("last-modified").and_then(|value| parse_http_date(&value)),
        etag: text("etag"),
    }
}

/// A response body as an [`ObjectBody`].
pub(crate) fn response_body(response: reqwest::Response) -> ObjectBody {
    Box::pin(
        response
            .bytes_stream()
            .map(|chunk| chunk.map_err(std::io::Error::other)),
    )
}

#[cfg(test)]
#[path = "object.test.rs"]
mod tests;
