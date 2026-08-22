//! How a stored file's bytes are labelled on an HTTP response.
//!
//! Every service that hands a stored file to a browser answers the same two
//! questions about it: what the resource *is* (`Content-Type`) and how the bytes
//! travelling in the body are framed (`Content-Encoding`). A name ending `.gz` is
//! the only case where those two answers come apart, and it comes apart in two
//! different directions, so the rule lives here once and every serving route reads
//! it from here.

/// The `Content-Type` and `Content-Encoding` a file is served under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentLabels {
    /// The media type of the *resource*, which is what a client decides how to
    /// parse from.
    pub content_type: &'static str,
    /// The codec the *body* is framed in, `None` when the bytes on the wire are
    /// already the resource itself.
    pub content_encoding: Option<&'static str>,
}

impl ContentLabels {
    /// Labels for bytes that are the resource, unframed.
    pub const fn plain(content_type: &'static str) -> Self {
        Self {
            content_type,
            content_encoding: None,
        }
    }

    /// Labels for a `content_type` resource travelling gzip-framed.
    pub const fn gzipped(content_type: &'static str) -> Self {
        Self {
            content_type,
            content_encoding: Some("gzip"),
        }
    }
}

/// The labels for a file whose name ends `.gz`, which is one of two different
/// resources depending on the suffix *before* the `.gz`.
///
/// A `.json.gz` is a JSON document that travels compressed — the draw-command
/// recordings a validator captures, whose format restates each frame's inherited
/// drawing state so any frame can be drawn on its own, and which therefore
/// compresses to a fraction of itself. The resource is the JSON, so it is labelled
/// as JSON with `Content-Encoding: gzip` and a browser inflates the body before any
/// script sees it.
///
/// Anything else ending `.gz` is a gzip document in its own right — `archive.tar.gz`
/// is the run archive a reviewer downloads, and the gzip *is* what was asked for.
/// It is labelled `application/gzip` with no content encoding, so nothing between
/// the store and the reviewer's disk unwraps it.
///
/// The distinction turns on the compound suffix, never on the last extension alone:
/// the single extension of both names is `gz`, which cannot tell them apart.
pub fn for_gz(file: &str) -> ContentLabels {
    let lowercased = file.to_ascii_lowercase();
    if lowercased.ends_with(".json.gz") {
        ContentLabels::gzipped("application/json")
    } else {
        ContentLabels::plain("application/gzip")
    }
}

#[cfg(test)]
#[path = "content_labels.test.rs"]
mod tests;
