//! Serving a run's produced playable build and proof media to a reviewer.
//!
//! A finished run collects its implementation under `<run>/implementation/`,
//! including the static build output the validator produced (`dist`/`build`/`out`).
//! A *published* run deploys that build to its own Cloudflare Pages host, where it
//! lives at the host root and its absolute asset references (`/assets/…`) resolve
//! (see [`crate::publish`]). But a reviewer must be able to play an *unpublished*
//! run too — that is the entire point of reviewing before publishing — so a runner
//! serves the same on-disk build locally: the worker over HTTP, the desktop core
//! over a custom URI scheme. Both reach for the helpers here so the build is
//! discovered and served identically.
//!
//! The same dual-serving story applies to a run's proof-of-implementation media —
//! the screenshots and clips the agent wrote as evidence (see
//! [`serve_proof_file`]). A published run's proofs are uploaded to the backend, but
//! an unpublished run's sit in its collected tree, so the worker serves them over
//! HTTP and the desktop core over its proof URI scheme — again from one shared
//! resolver here.
//!
//! Serving under a per-run sub-path (rather than a host root) is the one wrinkle.
//! A Vite build emitted with the default `base: "/"` references its assets
//! absolutely (`/assets/index-….js`), which would escape the per-run base and
//! 404. So when serving an HTML document this module relocates it under the
//! build's base: it injects a `<base href>` and de-absolutizes root-relative
//! `src`/`href` references so the injected base applies (a `<base href>` does not
//! affect already-absolute `/…` URLs). Non-HTML assets are served byte-for-byte.

use std::path::{Path, PathBuf};

/// Candidate static build-output directory names a run's implementation may
/// produce, in priority order. The validator builds into whichever a project's
/// tooling is configured for; `dist` is Vite's default. Shared so the publish
/// path (which deploys the build) and the local-serving path agree on what a
/// build output is.
pub const BUILD_OUTPUTS: [&str; 3] = ["dist", "build", "out"];

/// Find a deployable static build output beside a run's implementation, if one
/// was produced. Returns the first of [`BUILD_OUTPUTS`] that exists as a
/// directory, or `None` when the run produced no static build.
pub fn find_build_output(impl_dir: &Path) -> Option<PathBuf> {
    BUILD_OUTPUTS
        .iter()
        .map(|name| impl_dir.join(name))
        .find(|candidate| candidate.is_dir())
}

/// A file resolved from a build, ready to write to an HTTP or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedBuildFile {
    /// The `Content-Type` to send, derived from the file extension.
    pub content_type: &'static str,
    /// The file body, with HTML relocated under the build base (see module docs).
    pub body: Vec<u8>,
}

/// Resolve and read one file from a run's build directory for serving under
/// `base_href` — the per-run URL path the build is mounted at (with a trailing
/// slash), e.g. `/runs/<id>/build/`.
///
/// `rel_path` is the request path *within* the build, without a leading slash; an
/// empty path or one naming a directory resolves to that directory's
/// `index.html`. HTML responses are relocated under `base_href`; every other
/// asset is returned verbatim. Returns `None` when the file does not exist or the
/// path escapes the build directory (a traversal attempt) — the caller maps that
/// to a 404.
pub fn serve_build_file(
    build_dir: &Path,
    rel_path: &str,
    base_href: &str,
) -> Option<ServedBuildFile> {
    let target = resolve_within(build_dir, rel_path)?;
    let bytes = std::fs::read(&target).ok()?;
    let content_type = content_type_for(&target);
    let body = if content_type.starts_with("text/html") {
        rewrite_html_base(&bytes, base_href)
    } else {
        bytes
    };
    Some(ServedBuildFile { content_type, body })
}

/// A proof-of-implementation media file resolved from a run, ready to write to an
/// HTTP or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedProofFile {
    /// The `Content-Type` to send, derived from the file extension.
    pub content_type: &'static str,
    /// The proof media bytes, served verbatim.
    pub body: Vec<u8>,
}

/// Resolve and read one proof-of-implementation media file from a produced run's
/// output directory, for serving to a reviewer before the run is published.
///
/// `run_dir` is the run's output directory (`<out>/<id>`), which holds its
/// `run-record.json` and its collected `implementation/` tree. `file` is the
/// requested file name `<proof-id>.<ext>` — the proof id is matched against the
/// record's `validation.proofs` to find the proof's recorded `dest`, so the
/// agent's chosen location is honored and the extension is only cosmetic. The
/// media is then read from `implementation/<dest>` and its content type derived
/// from `file`'s extension. Returns `None` when the run record, the named proof,
/// or the media file is missing or unreadable — the caller maps that to a 404.
pub fn serve_proof_file(run_dir: &Path, file: &str) -> Option<ServedProofFile> {
    // The request names the file `<proof-id>.<ext>`; recover the proof id.
    let proof_id = file.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file);

    let record_bytes = std::fs::read(run_dir.join("run-record.json")).ok()?;
    let record: crate::RunRecord = serde_json::from_slice(&record_bytes).ok()?;
    let proof = record.validation.proofs.iter().find(|p| p.id == proof_id)?;

    let body = std::fs::read(run_dir.join("implementation").join(&proof.dest)).ok()?;
    Some(ServedProofFile {
        content_type: proof_content_type(file),
        body,
    })
}

/// An asset-generation media file resolved from a run, ready to write to an HTTP
/// or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedAssetFile {
    /// The `Content-Type` to send, derived from the file extension.
    pub content_type: &'static str,
    /// The media bytes, served verbatim.
    pub body: Vec<u8>,
}

/// Resolve and read one asset-generation artifact from a produced run's output
/// directory, for serving to a reviewer (or the gallery) the same way
/// [`serve_proof_file`] serves proof media.
///
/// `run_dir` is the run's output directory (`<out>/<id>`), holding its
/// `run-record.json` and its collected `implementation/` tree. `file` is a
/// logical name with an extension whose kind selects which recorded path in the
/// run's `validation.asset` frame to read from `implementation/`:
///
/// - a single sprite uses `regenerated.png`, `preview.png`, `target.png`, or
///   `actions.json` (its one frame, index 0);
/// - a sprite sheet uses `regenerated-<index>.png`, `preview-<index>.png`,
///   `target-<index>.png`, or `actions-<index>.json` (one per declared frame).
///
/// The flat `<kind>-<index>` spelling keeps each artifact a single path segment so
/// it routes through the one-segment `/asset/{file}` endpoints unchanged.
///
/// Returns `None` when the run record, its asset result, the named frame, the
/// artifact, or the file is missing — the caller maps that to a 404. The desktop
/// core serves the same artifacts over its `tcab-asset://` scheme from this
/// resolver.
pub fn serve_asset_file(run_dir: &Path, file: &str) -> Option<ServedAssetFile> {
    let (kind, frame) = parse_asset_request(file)?;

    let record_bytes = std::fs::read(run_dir.join("run-record.json")).ok()?;
    let record: crate::RunRecord = serde_json::from_slice(&record_bytes).ok()?;

    // The replay of an adversarial run is served as an ordinary run asset too: the
    // browser replay player fetches `replay.json` over the same `/asset/{file}`
    // path the asset-gen media use, so the asset-media plumbing stays
    // test-type-agnostic.
    let rel: &str = if let Some(asset) = record.validation.asset.as_ref() {
        // A frame index selects that frame for a sheet; its absence selects the
        // one frame of a single sprite.
        let frame_result = match frame {
            Some(index) => asset.frames.iter().find(|f| f.index == index)?,
            None => asset.frames.first()?,
        };
        match kind {
            "regenerated" => &frame_result.regenerated_image,
            "preview" => &frame_result.preview_image,
            "target" => &frame_result.target_image,
            "actions" => &frame_result.actions_log,
            _ => return None,
        }
    } else if let Some(adversarial) = record.validation.adversarial.as_ref() {
        match kind {
            "replay" => &adversarial.replay_json,
            _ => return None,
        }
    } else {
        return None;
    };

    let body = std::fs::read(run_dir.join("implementation").join(rel)).ok()?;
    Some(ServedAssetFile {
        content_type: asset_content_type(file),
        body,
    })
}

/// Parse an asset request into its kind and optional frame index: `regenerated.png`
/// → `("regenerated", None)`; `actions-3.json` → `("actions", Some(3))`. The kind
/// names (`regenerated`/`preview`/`target`/`actions`) carry no `-`, so a trailing
/// `-<digits>` is unambiguously a frame index.
fn parse_asset_request(file: &str) -> Option<(&str, Option<u32>)> {
    let stem = file.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file);
    if let Some((kind, index)) = stem.rsplit_once('-')
        && let Ok(index) = index.parse::<u32>()
    {
        return Some((kind, Some(index)));
    }
    Some((stem, None))
}

/// The `Content-Type` for an asset-generation artifact, by file extension: the
/// regenerated/preview/target images are PNG, the action log is JSON.
fn asset_content_type(file: &str) -> &'static str {
    let ext = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// The `Content-Type` for a proof media file, by file extension — the image and
/// video formats a proof's `dest` may name (see
/// [`MediaKind`](crate::test_case::MediaKind)). Anything unrecognized falls back
/// to a binary stream.
fn proof_content_type(file: &str) -> &'static str {
    let ext = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("mp4") => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// Resolve a request path to a real file inside `build_dir`, refusing anything
/// that would escape it. An empty path or a directory resolves to `index.html`.
fn resolve_within(build_dir: &Path, rel_path: &str) -> Option<PathBuf> {
    let mut path = build_dir.to_path_buf();
    for segment in rel_path.split('/') {
        // Skip empties (leading/trailing/`//`) and `.`; refuse `..` outright
        // rather than relying on canonicalization alone to catch traversal.
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return None;
        }
        path.push(segment);
    }
    // A directory request (including the build root) serves its index.html.
    if path.is_dir() {
        path.push("index.html");
    }
    // Defense in depth: the resolved real path must stay within the build dir, so
    // a symlink inside the build cannot point the response outside it.
    let base = build_dir.canonicalize().ok()?;
    let resolved = path.canonicalize().ok()?;
    resolved.starts_with(&base).then_some(resolved)
}

/// The `Content-Type` for a built asset, by file extension. Covers what a Vite
/// game build emits (the entry HTML and JS, plus any bundled CSS, wasm, images,
/// fonts and audio); anything unrecognized falls back to a binary stream.
fn content_type_for(path: &Path) -> &'static str {
    let ext = path
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
fn rewrite_html_base(bytes: &[u8], base_href: &str) -> Vec<u8> {
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
#[path = "playable.test.rs"]
mod tests;
