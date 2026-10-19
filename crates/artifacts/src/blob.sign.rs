//! Shared Key signing for the Blob REST API: the string-to-sign Azure Storage
//! defines for version 2009-09-19 and later, and its HMAC-SHA256 signature.
//!
//! The string-to-sign is the verb, eleven standard headers in a fixed order (an
//! absent one, and a `Content-Length` of `0`, as an empty line), every `x-ms-*`
//! header sorted by name, and the canonicalized resource: `/<account>` followed
//! by the request's encoded URL path and each query parameter, lower-cased by
//! name, sorted, as `\n<name>:<decoded value>`. For a path-style endpoint such as
//! Azurite's (`http://host:10000/devstoreaccount1`) the URL path already starts
//! with the account, so the account appears twice, which is what the emulator
//! expects.

use base64::Engine as _;
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// The standard headers the string-to-sign carries, in order, one line each.
const STANDARD_HEADERS: [&str; 11] = [
    "content-encoding",
    "content-language",
    "content-length",
    "content-md5",
    "content-type",
    "date",
    "if-modified-since",
    "if-match",
    "if-none-match",
    "if-unmodified-since",
    "range",
];

/// One request, as Shared Key signs it.
pub(crate) struct SignedRequest<'a> {
    /// The HTTP verb, upper case.
    pub method: &'a str,
    /// Every header the request is sent with, names lower case.
    pub headers: &'a [(String, String)],
    /// The storage account the key belongs to.
    pub account: &'a str,
    /// The request URL's path, percent-encoded exactly as it is sent.
    pub path: &'a str,
    /// The query parameters, names as sent, values decoded.
    pub query: &'a [(String, String)],
}

/// The Shared Key string-to-sign of a request.
pub(crate) fn string_to_sign(request: &SignedRequest<'_>) -> String {
    let header = |name: &str| {
        request
            .headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
            .unwrap_or("")
    };
    let mut out = String::new();
    out.push_str(request.method);
    out.push('\n');
    for name in STANDARD_HEADERS {
        let value = header(name);
        // From version 2015-02-21 a zero length is signed as an empty line.
        if !(name == "content-length" && value == "0") {
            out.push_str(value);
        }
        out.push('\n');
    }

    let mut ms_headers: Vec<(&str, &str)> = request
        .headers
        .iter()
        .filter(|(name, _)| name.starts_with("x-ms-"))
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    ms_headers.sort_by(|a, b| a.0.cmp(b.0));
    for (name, value) in ms_headers {
        out.push_str(name);
        out.push(':');
        out.push_str(value.trim());
        out.push('\n');
    }

    out.push('/');
    out.push_str(request.account);
    out.push_str(request.path);
    let mut query: Vec<(String, &str)> = request
        .query
        .iter()
        .map(|(name, value)| (name.to_ascii_lowercase(), value.as_str()))
        .collect();
    query.sort();
    let mut index = 0;
    while index < query.len() {
        let name = &query[index].0;
        let mut values = vec![query[index].1];
        let mut next = index + 1;
        while next < query.len() && query[next].0 == *name {
            values.push(query[next].1);
            next += 1;
        }
        out.push('\n');
        out.push_str(name);
        out.push(':');
        out.push_str(&values.join(","));
        index = next;
    }
    out
}

/// The base64 HMAC-SHA256 of `string_to_sign` under the decoded account key.
pub(crate) fn signature(key: &[u8], string_to_sign: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts a key of any length");
    mac.update(string_to_sign.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

/// Percent-encode `input` per RFC 3986, leaving the unreserved characters and,
/// when `keep_slash`, the `/` path separator.
pub(crate) fn encode(input: &str, keep_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char);
            }
            b'/' if keep_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
#[path = "blob.sign.test.rs"]
mod tests;
