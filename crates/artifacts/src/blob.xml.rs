//! The two XML documents the Blob client exchanges: the `List Blobs` response it
//! reads and the `Put Block List` body it writes.
//!
//! Both are flat and fixed in shape, so they are scanned and written directly
//! rather than through an XML library: a listing is a run of `<Blob>` and
//! `<BlobPrefix>` elements and a `<NextMarker>`, and a block list is a run of
//! `<Latest>` ids.

use crate::object::{ObjectProperties, parse_http_date};

use super::{ListPage, ListedBlob};

/// Parse one `List Blobs` response page.
pub(crate) fn parse_list(xml: &str) -> ListPage {
    let blobs = elements(xml, "Blob")
        .map(|blob| {
            let properties = element(blob, "Properties").unwrap_or("");
            let text = |name: &str| element(properties, name).map(unescape);
            ListedBlob {
                name: element(blob, "Name").map(unescape).unwrap_or_default(),
                properties: ObjectProperties {
                    content_length: text("Content-Length")
                        .and_then(|value| value.trim().parse().ok())
                        .unwrap_or(0),
                    content_type: text("Content-Type").filter(|value| !value.is_empty()),
                    content_encoding: text("Content-Encoding").filter(|value| !value.is_empty()),
                    last_modified: text("Last-Modified").and_then(|value| parse_http_date(&value)),
                    etag: text("Etag").filter(|value| !value.is_empty()),
                },
            }
        })
        .collect();
    let prefixes = elements(xml, "BlobPrefix")
        .filter_map(|prefix| element(prefix, "Name").map(unescape))
        .collect();
    let next_marker = element(xml, "NextMarker")
        .map(unescape)
        .filter(|marker| !marker.is_empty());
    ListPage {
        blobs,
        prefixes,
        next_marker,
    }
}

/// The `Put Block List` body committing `ids`, in order, from the uncommitted
/// (latest) blocks.
pub(crate) fn block_list(ids: &[String]) -> String {
    let mut body = String::from(r#"<?xml version="1.0" encoding="utf-8"?><BlockList>"#);
    for id in ids {
        body.push_str("<Latest>");
        body.push_str(&escape(id));
        body.push_str("</Latest>");
    }
    body.push_str("</BlockList>");
    body
}

/// The text of the first `<name>` element in `xml` (attributes allowed), or
/// `None` when there is none. A self-closing `<name/>` is empty text.
fn element<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    elements(xml, name).next()
}

/// The text of every top-level `<name>` element in `xml`, in order.
fn elements<'a>(xml: &'a str, name: &str) -> impl Iterator<Item = &'a str> + use<'a> {
    let open = format!("<{name}");
    let close = format!("</{name}>");
    let mut rest = xml;
    std::iter::from_fn(move || {
        loop {
            let start = rest.find(&open)?;
            let after_name = &rest[start + open.len()..];
            // `<Blob` also begins `<BlobPrefix>` and `<Blobs>`: only a `>`, `/`
            // or whitespace ends this element's name.
            let next = after_name.chars().next()?;
            if !(next == '>' || next == '/' || next.is_whitespace()) {
                rest = after_name;
                continue;
            }
            let tag_end = after_name.find('>')?;
            if after_name[..tag_end].ends_with('/') {
                rest = &after_name[tag_end + 1..];
                return Some("");
            }
            let body = &after_name[tag_end + 1..];
            let end = body.find(&close)?;
            rest = &body[end + close.len()..];
            return Some(&body[..end]);
        }
    })
}

/// Escape text for an XML element.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Decode the predefined XML entities; `&amp;` last so `&amp;lt;` stays `&lt;`.
fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
#[path = "blob.xml.test.rs"]
mod tests;
