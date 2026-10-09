//! Helpers over the shared showcase format that more than one component reads.
//!
//! A showcase — the run's, a case variant's, or a suite's — is a description, a
//! carousel, and the media files the two of them reference, in one directory with
//! no subdirectories. The format itself is modelled where each showcase is
//! declared (`ShowcaseManifest` in `test_cabinet_core` for the carousel, the
//! caps in [`layout`](crate::layout)); what lives here is the reading the
//! format implies but no model carries, because a description's references are in
//! its prose rather than in a key.

use percent_encoding::percent_decode_str;

/// The showcase file names a description references as inline Markdown images
/// (`![alt](file)`), deduplicated in reference order.
///
/// A description may embed an image by bare relative path without listing it in
/// the carousel, so such a name lives nowhere but the prose. Two components need
/// it: the public snapshot (`test_cabinet_core::run_record`) publishes a description-only
/// image so it is not permanently broken once the ephemeral store is wiped, and
/// the suite validator (`test_cabinet_core::test_suite::validate`) reports an authored
/// reference with no file behind it against the showcase that wrote it.
///
/// Only a name the store and serve routes would accept is returned: the same
/// relative-reference rule a Markdown renderer applies before it resolves an
/// image against the showcase (no scheme, not document-anchored), then the
/// flat-namespace rule of the showcase directory itself (no separators, no `..`,
/// not `showcase.toml`). A percent-escaped destination is decoded to the plain
/// file name the author wrote, exactly as the renderer decodes it before
/// resolving.
pub fn description_image_references(description: &str) -> Vec<String> {
    let mut files = Vec::new();
    // Inline-image syntax only (`![alt](dest)` / `![alt](<dest>)`, optionally
    // with a title after the destination) — the convention the specs instruct.
    let mut rest = description;
    while let Some(start) = rest.find("![") {
        rest = &rest[start + 2..];
        // The destination opens at the first `](` after the alt text.
        let Some(open) = rest.find("](") else { break };
        let after = &rest[open + 2..];
        let dest = if let Some(bracketed) = after.strip_prefix('<') {
            // An angle-bracketed destination runs to the closing `>` (the form
            // that permits spaces in the name).
            let Some(end) = bracketed.find('>') else {
                rest = after;
                continue;
            };
            &bracketed[..end]
        } else {
            // A plain destination ends at the first whitespace (a title may
            // follow) or the closing parenthesis.
            match after.find(|c: char| c.is_whitespace() || c == ')') {
                Some(end) => &after[..end],
                None => after,
            }
        };
        rest = after;
        // Only a relative reference resolves against the showcase — the same rule
        // the renderer applies (no scheme, not `/`-, `#`- or `?`-anchored).
        if dest.is_empty() || dest.starts_with(['/', '#', '?']) || has_url_scheme(dest) {
            continue;
        }
        // The parser hands the renderer a percent-encoded destination and the
        // resolver decodes it; decode here too so the extracted name is the plain
        // file name the store and the published key use.
        let file = match percent_decode_str(dest).decode_utf8() {
            Ok(decoded) => decoded.into_owned(),
            // Malformed escapes: take the reference as written.
            Err(_) => dest.to_string(),
        };
        // The flat-namespace rule every showcase route enforces.
        if file.contains(['/', '\\']) || file.contains("..") || file == "showcase.toml" {
            continue;
        }
        if !files.contains(&file) {
            files.push(file);
        }
    }
    files
}

/// Whether `url` opens with a URL scheme (`https:`, `data:`), which is what makes
/// a Markdown destination absolute rather than resolvable against the showcase.
fn has_url_scheme(url: &str) -> bool {
    let mut chars = url.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !c.is_ascii_alphanumeric() && !matches!(c, '+' | '.' | '-') {
            return false;
        }
    }
    false
}

#[cfg(test)]
#[path = "showcase.test.rs"]
mod tests;
