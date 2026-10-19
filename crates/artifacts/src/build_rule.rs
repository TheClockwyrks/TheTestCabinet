//! The pure pieces of the build-serving rule, for serving a build held as
//! objects rather than files.
//!
//! `test_cabinet_contracts::layout` owns the rule a build is served by:
//! [`find_build_output`](test_cabinet_contracts::layout::find_build_output)
//! chooses the build output beside a run's implementation and
//! [`serve_build_file`](test_cabinet_contracts::layout::serve_build_file)
//! resolves one file of it under a per-run base path. Both read a file system.
//! Once a run's tree lives in an object store the same rule has to apply to
//! object keys, so this module holds its pure pieces: the traversal guard on a
//! request path, the content type by name, the HTML base relocation and the
//! choice of build output among the names present.
//!
//! These are mirrors. The contracts revision this workspace pins at
//! (`v0.1.0`) keeps them private; contracts `v0.2.1` makes them public under
//! the same names, and once the workspace pins it this module is replaced by
//! those. Until then the tests (`build_rule.test.rs`) hold each mirror to the
//! contracts rule byte for byte, driving `serve_build_file` and
//! `find_build_output` over a directory, so the two cannot drift apart
//! unnoticed.

use std::path::Path;

use test_cabinet_contracts::layout::BUILD_OUTPUTS;

/// Normalize a request path *within* a build into the relative path it names,
/// segments joined by `/`, or `None` when it would escape the build (a `..`
/// segment, refused outright rather than resolved).
///
/// Empty segments (a leading or trailing slash, a `//`) and `.` are skipped, so
/// `""`, `"/"` and `"./"` all normalize to `""`, the build root. Which file a
/// directory request serves (its `index.html`) is left to the caller, which
/// alone knows what exists.
pub fn normalize_build_path(rel_path: &str) -> Option<String> {
    let mut segments: Vec<&str> = Vec::new();
    for segment in rel_path.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return None;
        }
        segments.push(segment);
    }
    Some(segments.join("/"))
}

/// Choose the build output among the directory names present beside a run's
/// implementation: the first of [`BUILD_OUTPUTS`], in its priority order, that
/// `names` contains, or `None` when it contains none of them. `names` are bare
/// directory names, in any order; names that are not build outputs are ignored.
pub fn find_build_output_in<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<&'static str> {
    let present: Vec<&str> = names.into_iter().collect();
    BUILD_OUTPUTS
        .into_iter()
        .find(|candidate| present.contains(candidate))
}

/// The `Content-Type` for a built asset, by the extension of its name. Covers
/// what a Vite game build emits (the entry HTML and JS, plus any bundled CSS,
/// wasm, images, fonts and audio); anything unrecognized falls back to a binary
/// stream.
///
/// `name` is a file name or a `/`-separated relative path (an object key within
/// a build); only its last segment is read. The extension is what follows the
/// last `.` of that segment, as [`Path::extension`] reads it: a leading dot
/// alone (`.htaccess`) names no extension. Matching ignores case.
pub fn content_type_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Relocate an HTML document under `base_href`: inject a `<base href>` at the
/// start of `<head>` and de-absolutize root-relative `src`/`href` references so
/// the base applies to them. Non-UTF-8 input is returned unchanged.
///
/// `base_href` is the URL path the build is mounted at, with a trailing slash,
/// e.g. `/runs/<id>/build/`.
pub fn rewrite_html_base(bytes: &[u8], base_href: &str) -> Vec<u8> {
    let Ok(html) = std::str::from_utf8(bytes) else {
        return bytes.to_vec();
    };
    // De-absolutize the document's own references first, then inject the base —
    // injecting first would let de-absolutization strip the leading slash off the
    // base tag's own (intentionally absolute) `href`.
    let deabsolutized = deabsolutize(html);
    let base_tag = format!("<base href=\"{base_href}\">");
    match head_insert_index(&deabsolutized) {
        Some(idx) => {
            let mut out = String::with_capacity(deabsolutized.len() + base_tag.len());
            out.push_str(&deabsolutized[..idx]);
            out.push_str(&base_tag);
            out.push_str(&deabsolutized[idx..]);
            out.into_bytes()
        }
        // No <head> to anchor to: prepend the base so relative refs still resolve.
        None => format!("{base_tag}{deabsolutized}").into_bytes(),
    }
}

/// The byte offset just after the opening `<head …>` tag, or `None` when the
/// document has no head.
fn head_insert_index(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let head = lower.find("<head")?;
    let close = lower[head..].find('>')?;
    Some(head + close + 1)
}

/// Strip the leading slash from root-relative `src`/`href` attribute values so a
/// `<base href>` resolves them under the build path. Protocol-relative `//host`
/// references and absolute URLs with a scheme are left untouched.
fn deabsolutize(html: &str) -> String {
    const PREFIXES: [&str; 4] = ["src=\"/", "src='/", "href=\"/", "href='/"];
    let bytes = html.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    'scan: while i < bytes.len() {
        for prefix in PREFIXES {
            let pat = prefix.as_bytes();
            if bytes[i..].starts_with(pat) {
                // Leave protocol-relative `//` alone — only a single leading
                // slash is a root-relative path to de-absolutize.
                let after = i + pat.len();
                if bytes.get(after) != Some(&b'/') {
                    // Emit the attribute prefix without its trailing slash, then
                    // resume just past the slash we dropped.
                    out.push_str(&prefix[..prefix.len() - 1]);
                    i = after;
                    continue 'scan;
                }
            }
        }
        // Copy one whole UTF-8 character so multibyte content survives intact.
        let len = utf8_len(bytes[i]);
        out.push_str(&html[i..i + len]);
        i += len;
    }
    out
}

/// The byte length of a UTF-8 character from its leading byte.
fn utf8_len(lead: u8) -> usize {
    match lead {
        b if b < 0x80 => 1,
        b if b >> 5 == 0b110 => 2,
        b if b >> 4 == 0b1110 => 3,
        b if b >> 3 == 0b11110 => 4,
        // A stray continuation byte is copied alone rather than panicking; the
        // input came from `from_utf8` so this is unreachable in practice.
        _ => 1,
    }
}

#[cfg(test)]
#[path = "build_rule.test.rs"]
mod tests;
