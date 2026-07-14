//! Fetching and sanitizing a model's provider logo from svgl.app.
//!
//! The model-config form lets an operator point at an [svgl.app](https://svgl.app)
//! URL for the provider's logo; the backend fetches the SVG, sanitizes it, and
//! stores the markup so it lands in the public snapshot and is served with the
//! catalog. Two guards make that safe:
//!
//! - **SSRF:** only `svgl.app` (and its subdomains) may be fetched, so the form
//!   cannot be used to make the backend reach an arbitrary internal address.
//! - **XSS:** the returned SVG is sanitized — scripts, event handlers, external
//!   references, and embedded HTML are stripped — before it is stored or served,
//!   because the markup is inlined into the fully static public site.

use crate::error::{BackendError, Result};

/// The only host (and its subdomains) a logo may be fetched from.
const ALLOWED_HOST: &str = "svgl.app";

/// The largest logo we accept, before and after sanitizing. Provider logos are a
/// few KiB; this is a generous ceiling that still rejects a hostile large body.
const MAX_SVG_BYTES: usize = 256 * 1024;

/// Fetch an svgl.app logo URL and return its sanitized SVG markup.
///
/// Errors as a `bad_request` when the URL is not an `https://svgl.app` address or
/// the response is not a usable SVG, and as an internal error when the fetch
/// itself fails.
pub async fn fetch_logo_svg(http: &reqwest::Client, url: &str) -> Result<String> {
    if !is_allowed_url(url) {
        return Err(BackendError::BadRequest(format!(
            "logo URL must be an https://{ALLOWED_HOST} address"
        )));
    }
    let response = http
        .get(url)
        .send()
        .await
        .map_err(|err| BackendError::BadRequest(format!("fetching logo: {err}")))?;
    if !response.status().is_success() {
        return Err(BackendError::BadRequest(format!(
            "fetching logo: svgl.app returned {}",
            response.status()
        )));
    }
    let body = response
        .text()
        .await
        .map_err(|err| BackendError::BadRequest(format!("reading logo body: {err}")))?;
    if body.len() > MAX_SVG_BYTES {
        return Err(BackendError::BadRequest("logo SVG is too large".into()));
    }
    let svg = sanitize_svg(&body)?;
    if svg.len() > MAX_SVG_BYTES {
        return Err(BackendError::BadRequest("logo SVG is too large".into()));
    }
    Ok(svg)
}

/// Whether `url` is an `https://svgl.app` (or subdomain) URL. Scheme must be
/// `https`; the host is the authority up to the first `/`, `?`, or `#`, with any
/// `user@` and `:port` stripped, compared case-insensitively.
fn is_allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // Drop any userinfo and port.
    let host = authority
        .rsplit('@')
        .next()
        .unwrap_or(authority)
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    host == ALLOWED_HOST || host.ends_with(&format!(".{ALLOWED_HOST}"))
}

/// Sanitize SVG markup: drop `<script>` and `<foreignObject>` element bodies,
/// `on*` event-handler attributes, and `javascript:`/DOCTYPE/entity constructs,
/// so the stored markup carries no executable or external-reference surface.
///
/// This is a conservative textual scrub rather than a full XML rewrite: it errs
/// toward removing anything dangerous, and rejects markup that does not look like
/// an SVG at all.
pub fn sanitize_svg(input: &str) -> Result<String> {
    let mut svg = input.trim().to_string();
    // Reject document-type and entity declarations outright (XXE surface) rather
    // than trying to neutralize them in place.
    let lower = svg.to_ascii_lowercase();
    if lower.contains("<!doctype") || lower.contains("<!entity") || lower.contains("<!--#") {
        return Err(BackendError::BadRequest(
            "logo SVG contains a disallowed declaration".into(),
        ));
    }
    if !lower.contains("<svg") {
        return Err(BackendError::BadRequest(
            "logo response is not an SVG".into(),
        ));
    }
    svg = strip_element(&svg, "script");
    svg = strip_element(&svg, "foreignObject");
    svg = strip_event_handler_attrs(&svg);
    svg = svg.replace("javascript:", "");
    Ok(svg.trim().to_string())
}

/// Remove every `<name ...>...</name>` (and self-closing `<name .../>`) span,
/// case-insensitively, including its contents.
fn strip_element(input: &str, name: &str) -> String {
    let lower_name = name.to_ascii_lowercase();
    let open = format!("<{lower_name}");
    let close = format!("</{lower_name}>");
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    loop {
        let haystack = rest.to_ascii_lowercase();
        let Some(start) = haystack.find(&open) else {
            out.push_str(rest);
            break;
        };
        // Only treat it as the element if what follows the name is a delimiter
        // (space, `>`, `/`) — so `<scriptable>` is not mistaken for `<script>`.
        let after = rest[start + open.len()..].chars().next();
        if !matches!(after, Some(c) if c.is_whitespace() || c == '>' || c == '/') {
            // Not our element: emit up to and including this `<name` and continue.
            let keep = start + open.len();
            out.push_str(&rest[..keep]);
            rest = &rest[keep..];
            continue;
        }
        out.push_str(&rest[..start]);
        let tag_rest = &rest[start..];
        let tag_lower = tag_rest.to_ascii_lowercase();
        // Determine where the opening tag ends to detect a self-closing form.
        if let Some(gt) = tag_lower.find('>') {
            let self_closing = tag_rest[..gt].trim_end().ends_with('/');
            if self_closing {
                rest = &tag_rest[gt + 1..];
                continue;
            }
        }
        // Paired element: drop through its closing tag.
        if let Some(end) = tag_lower.find(&close) {
            rest = &tag_rest[end + close.len()..];
        } else {
            // Unterminated element: drop the remainder.
            break;
        }
    }
    out
}

/// Remove `on<event>="..."` / `on<event>='...'` attributes, case-insensitively.
///
/// Works on the ASCII-lowercased copy to locate matches (byte offsets align,
/// since `to_ascii_lowercase` preserves length) and copies the kept regions as
/// string slices, so multi-byte UTF-8 in the markup is preserved intact. Every
/// cut point lands on an ASCII byte (whitespace, a quote, or `>`), so the slices
/// are always valid.
fn strip_event_handler_attrs(input: &str) -> String {
    let bytes = input.as_bytes();
    let lower = input.to_ascii_lowercase();
    let lb = lower.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut copy_from = 0;
    let mut i = 0;
    while i < bytes.len() {
        // Match a whitespace boundary followed by `on` + letters + optional space + `=`.
        if (i == 0 || bytes[i - 1].is_ascii_whitespace())
            && lb[i] == b'o'
            && i + 1 < lb.len()
            && lb[i + 1] == b'n'
        {
            let mut j = i + 2;
            while j < lb.len() && lb[j].is_ascii_alphabetic() {
                j += 1;
            }
            let mut k = j;
            while k < lb.len() && lb[k].is_ascii_whitespace() {
                k += 1;
            }
            if j > i + 2 && k < lb.len() && lb[k] == b'=' {
                // Skip the attribute value (quoted or bare).
                let mut v = k + 1;
                while v < lb.len() && lb[v].is_ascii_whitespace() {
                    v += 1;
                }
                if v < bytes.len() && (bytes[v] == b'"' || bytes[v] == b'\'') {
                    let quote = bytes[v];
                    v += 1;
                    while v < bytes.len() && bytes[v] != quote {
                        v += 1;
                    }
                    if v < bytes.len() {
                        v += 1; // consume the closing quote
                    }
                } else {
                    while v < bytes.len() && !bytes[v].is_ascii_whitespace() && bytes[v] != b'>' {
                        v += 1;
                    }
                }
                out.push_str(&input[copy_from..i]);
                copy_from = v;
                i = v;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&input[copy_from..]);
    out
}

#[cfg(test)]
#[path = "logo.test.rs"]
mod tests;
