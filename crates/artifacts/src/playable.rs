//! Serving a run's produced playable build and media to a reviewer, from the
//! run's stored tree.
//!
//! A finished run collects its implementation under `implementation/`, including
//! the static build output the validator produced (`dist`/`build`/`out`). A
//! *published* run deploys that build to its own Cloudflare Pages host, where it
//! lives at the host root and its absolute asset references (`/assets/…`) resolve
//! (the publisher's release). But a reviewer must be able to play an *unpublished*
//! run too — that is the entire point of reviewing before publishing — so the
//! artifact service serves the same build over HTTP from the run's stored tree,
//! discovering and serving it through the resolvers here.
//!
//! The same applies to a run's proof-of-implementation media — the screenshots and
//! clips the agent wrote as evidence (see [`serve_proof_file`]) — and to its
//! validation, showcase and asset-generation media: an unpublished run's sit in its
//! stored tree, so the service serves them from the resolvers here.
//!
//! Serving under a per-run sub-path (rather than a host root) is the one wrinkle.
//! A Vite build emitted with the default `base: "/"` references its assets
//! absolutely (`/assets/index-….js`), which would escape the per-run base and
//! 404. So when serving an HTML document this module relocates it under the
//! build's base: it injects a `<base href>` and de-absolutizes root-relative
//! `src`/`href` references so the injected base applies (a `<base href>` does not
//! affect already-absolute `/…` URLs). Non-HTML assets are served byte-for-byte,
//! streamed from the store. That rule is `test_cabinet_contracts::layout`'s
//! `serve_build_file`, because the backend serves a suite's reference builds under
//! a sub-path by the same rule; its pure pieces (`normalize_build_path`,
//! `content_type_for`, `rewrite_html_base` and `find_build_output_in`, from the
//! same module) are applied here to object keys, so every host serving a build
//! applies the same rewrite and the same traversal guard.
//!
//! Every resolver answers `Ok(None)` for something the tree does not hold (the
//! caller's `404`) and an error only for a store that failed.

use std::path::Path;

use test_cabinet_contracts::RunRecord;
use test_cabinet_contracts::layout::{
    content_type_for, find_build_output_in, normalize_build_path, rewrite_html_base,
};
use test_cabinet_contracts::test_case::{MATERIAL_JSON_DEST, UI_JSON_DEST};
use test_cabinet_suites::content_labels::{self, ContentLabels};

use crate::object::{ObjectBody, ObjectStream, body_from_bytes};
use crate::store::{MAX_WHOLE_READ_BYTES, RunTree, StoreError};

// The build-output names and the rules a proof is named and labelled by are
// run-tree layout every side agrees on (the validator, the code analyzer, the
// snapshot builder, the gallery, the backend's reference builds), so they live in
// `test_cabinet_contracts::layout` and are re-exported here beside the serving that
// uses them.
pub use test_cabinet_contracts::layout::{
    BUILD_OUTPUTS, proof_labelled_name, proof_published_extension, proof_served_extension,
};

/// A file of a run's tree resolved for serving: what to label the response with,
/// and the body to stream.
pub struct Served {
    /// The `Content-Type` to send.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`content_labels`]).
    pub content_encoding: Option<&'static str>,
    /// The body's length, when the store reported it.
    pub content_length: Option<u64>,
    /// The body, streamed from the store (or, for a relocated HTML document,
    /// the rewritten bytes).
    pub body: ObjectBody,
}

impl std::fmt::Debug for Served {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Served")
            .field("content_type", &self.content_type)
            .field("content_encoding", &self.content_encoding)
            .field("content_length", &self.content_length)
            .finish_non_exhaustive()
    }
}

impl Served {
    /// Serve `object` verbatim under `labels`.
    fn object(object: ObjectStream, labels: ContentLabels) -> Self {
        Self {
            content_type: labels.content_type,
            content_encoding: labels.content_encoding,
            content_length: Some(object.properties.content_length),
            body: object.body,
        }
    }
}

/// The build output of a run's tree: the first of [`BUILD_OUTPUTS`] present as a
/// directory beside its implementation, or `None` when the run produced no build.
pub async fn find_build_output(tree: &RunTree) -> Result<Option<&'static str>, StoreError> {
    let names = tree.subdirectories("implementation").await?;
    Ok(find_build_output_in(names.iter().map(String::as_str)))
}

/// Resolve one file of the run's build output `build` (from
/// [`find_build_output`]) for serving under `base_href`, the URL path the build is
/// mounted at with a trailing slash (`/runs/<id>/build/`).
///
/// `rel_path` is the request path within the build. Empty and `.` segments are
/// skipped and a `..` segment refused, so a request cannot leave the build. The
/// build root, and a path naming a directory, serve its `index.html`. An HTML
/// document is relocated under `base_href`; anything else streams verbatim.
/// `Ok(None)` when the path names no file of the build.
pub async fn serve_build_file(
    tree: &RunTree,
    build: &str,
    rel_path: &str,
    base_href: &str,
) -> Result<Option<Served>, StoreError> {
    let Some(rel) = normalize_build_path(rel_path) else {
        return Ok(None);
    };
    let root = format!("implementation/{build}");
    let candidates = if rel.is_empty() {
        vec!["index.html".to_string()]
    } else {
        vec![rel.clone(), format!("{rel}/index.html")]
    };
    for candidate in candidates {
        let Some(object) = tree.get(&format!("{root}/{candidate}")).await? else {
            continue;
        };
        let content_type = content_type_for(&candidate);
        if !content_type.starts_with("text/html") {
            return Ok(Some(Served::object(
                object,
                ContentLabels::plain(content_type),
            )));
        }
        let length = object.properties.content_length;
        if length > MAX_WHOLE_READ_BYTES {
            return Err(StoreError::TooLargeToRead(candidate));
        }
        let bytes = crate::object::collect_body(object.body)
            .await
            .map_err(StoreError::Body)?;
        let rewritten = rewrite_html_base(&bytes, base_href);
        return Ok(Some(Served {
            content_type,
            content_encoding: None,
            content_length: Some(rewritten.len() as u64),
            body: body_from_bytes(rewritten),
        }));
    }
    Ok(None)
}

/// The run's record, `None` when the tree holds none or it does not parse.
async fn run_record(tree: &RunTree) -> Result<Option<RunRecord>, StoreError> {
    Ok(tree
        .read("run-record.json")
        .await?
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()))
}

/// Read `implementation/<rel>` from the tree.
async fn implementation_file(
    tree: &RunTree,
    rel: &str,
) -> Result<Option<ObjectStream>, StoreError> {
    tree.get(&format!("implementation/{rel}")).await
}

/// Resolve one proof-of-implementation media file of a produced run, for serving
/// to a reviewer before the run is published.
///
/// `file` is the requested file name `<proof-id>.<ext>` — the proof id is matched
/// against the record's `validation.proofs` to find the proof's recorded `dest`, so
/// the agent's chosen location is honored and the extension is only cosmetic. The
/// media is then read from `implementation/<dest>` and labelled from the dest's
/// name (see [`proof_labelled_name`]). `Ok(None)` when the run record, the named
/// proof, or the media file is missing — the caller maps that to a 404.
pub async fn serve_proof_file(tree: &RunTree, file: &str) -> Result<Option<Served>, StoreError> {
    // The request names the file `<proof-id>.<ext>`; recover the proof id.
    let proof_id = file.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file);

    let Some(record) = run_record(tree).await? else {
        return Ok(None);
    };
    let Some(proof) = record.validation.proofs.iter().find(|p| p.id == proof_id) else {
        return Ok(None);
    };
    let Some(object) = implementation_file(tree, &proof.dest).await? else {
        return Ok(None);
    };
    let labels = proof_labels(proof_labelled_name(&proof.dest, file));
    Ok(Some(Served::object(object, labels)))
}

/// The host namespace directory produced trees carried before it was renamed to
/// `.vendor`. Runs collected under the old name are immutable history, so every
/// read-back path keeps resolving it.
pub(crate) const LEGACY_VENDOR_DIR: &str = ".tcab";

/// Resolve one synthesized validation media file of a produced run, for serving to
/// a reviewer the same way [`serve_proof_file`] serves proof media.
///
/// `file` is the flat,
/// addressable media name a debug script's output is stored under —
/// `<item>__<output>.<ext>` for the model's build, `<item>__<output>.baseline.<ext>`
/// for the reference implementation (see `test_cabinet_contracts::layout::validation_media_name`).
/// The bytes live in the collected tree under `.vendor/validation/`, so this reads
/// straight from `implementation/.vendor/validation/<file>`. `Ok(None)` when the
/// file is missing or the name would escape the directory — the caller maps that to
/// a 404.
///
/// The same directory also holds a recording's **shared image store** —
/// `img.<id>.png` and `img.<id>.bin`, the deduplicated bitmaps and pixel buffers a
/// recording's entries name rather than carry (see
/// [`VALIDATION_IMAGE_PREFIX`](test_cabinet_contracts::layout::VALIDATION_IMAGE_PREFIX)). Those names are flat single segments like
/// every other one here, so they are served by this function and its route with no
/// change: that a store file resolves through exactly the lookup the recording it
/// belongs to resolved through is the whole reason the reference on an entry is a
/// file name and not a URL.
///
/// Trees collected before the host namespace was renamed carry the same media under
/// `.tcab/validation/`. Those runs are immutable and are still served, so a miss in
/// the current directory falls back to the legacy one rather than 404ing history.
pub async fn serve_validation_file(
    tree: &RunTree,
    file: &str,
) -> Result<Option<Served>, StoreError> {
    // The name is a single flat segment; reject any path separator or traversal so a
    // request can only ever name a file directly inside the validation media dir.
    if !is_flat_name(file) {
        return Ok(None);
    }
    for dir in [".vendor", LEGACY_VENDOR_DIR] {
        if let Some(object) = implementation_file(tree, &format!("{dir}/validation/{file}")).await?
        {
            return Ok(Some(Served::object(object, proof_labels(file))));
        }
    }
    Ok(None)
}

/// Whether `file` is one flat file name: non-empty, with no path separator and no
/// `..`.
pub(crate) fn is_flat_name(file: &str) -> bool {
    !(file.is_empty() || file.contains('/') || file.contains('\\') || file.contains(".."))
}

/// Resolve one of a run's [showcase](test_cabinet_contracts::RunShowcase) files, for
/// serving to a reviewer the same way [`serve_validation_file`] serves validation
/// media.
///
/// `file` is the plain
/// file name a showcase entry (or an image the description references) carries —
/// the showcase directory is a flat namespace by construction — so this reads
/// straight from `implementation/showcase/<file>`. `showcase.toml` is refused so
/// this route exposes exactly the namespace the backend store mirror holds (the
/// manifest is capture-side input, already folded into the record). `Ok(None)`
/// when the file is missing or the name would escape the directory — the caller
/// maps that to a 404.
///
/// A `.json.gz` replay is labelled as the JSON it is with the gzip declared as the
/// body's framing (exactly as validation replays are), so a browser inflates it
/// transparently before the player sees it.
pub async fn serve_showcase_file(tree: &RunTree, file: &str) -> Result<Option<Served>, StoreError> {
    // The name is a single flat segment; reject any path separator or traversal so a
    // request can only ever name a file directly inside the showcase dir.
    if !is_flat_name(file) || file == "showcase.toml" {
        return Ok(None);
    }
    Ok(implementation_file(tree, &format!("showcase/{file}"))
        .await?
        .map(|object| Served::object(object, showcase_labels(file))))
}

/// Resolve one asset-generation artifact of a produced run, for serving to a
/// reviewer the same way [`serve_proof_file`] serves proof media.
///
/// `file` is a
/// logical name with an extension whose kind selects which recorded path in the
/// run's `validation.asset` frame to read from `implementation/`:
///
/// - a single sprite uses `regenerated.png`, `preview.png`, or `actions.json`
///   (its one frame, index 0);
/// - a sprite sheet uses `regenerated-<index>.png`, `preview-<index>.png`, or
///   `actions-<index>.json` (one per declared frame);
/// - a static voxel model uses `preview.png`, `actions.json`, or `mesh.glb` (its one
///   part); an animated voxel model suffixes each with the part's `-<index>` in
///   declared order (`mesh-<index>.glb`, etc.). The `mesh` kind is the
///   `PartMesh`-shaped `.glb` the 3D client renders, emitted by every voxel-family
///   binary. Cheat detection is retired for voxel, so there is no regenerated PNG.
///
/// The flat `<kind>-<index>` spelling keeps each artifact a single path segment so
/// it routes through the one-segment `/asset/{file}` endpoints unchanged.
///
/// `Ok(None)` when the run record, its asset result, the named frame, the
/// artifact, or the file is missing — the caller maps that to a 404.
pub async fn serve_asset_file(tree: &RunTree, file: &str) -> Result<Option<Served>, StoreError> {
    let Some(record) = run_record(tree).await? else {
        return Ok(None);
    };
    let Some(rel) = asset_path(&record, file) else {
        return Ok(None);
    };
    Ok(implementation_file(tree, rel)
        .await?
        .map(|object| Served::object(object, asset_labels(file))))
}

/// The path within `implementation/` the asset request `file` names in `record`,
/// `None` when the record names none.
pub(crate) fn asset_path<'r>(record: &'r RunRecord, file: &str) -> Option<&'r str> {
    let (kind, frame) = parse_asset_request(file)?;

    // The replay of an adversarial run is served as an ordinary run asset too: the
    // browser replay player fetches `replay.json` over the same `/asset/{file}`
    // path the asset-gen media use, so the asset-media plumbing stays
    // test-type-agnostic.
    let rel: &'r str = if let Some(asset) = record.validation.asset.as_ref() {
        // A frame index selects that frame for a sheet; its absence selects the
        // one frame of a single sprite.
        let frame_result = match frame {
            Some(index) => asset.frames.iter().find(|f| f.index == index)?,
            None => asset.frames.first()?,
        };
        match kind {
            "regenerated" => &frame_result.regenerated_image,
            "preview" => &frame_result.preview_image,
            "actions" => &frame_result.actions_log,
            _ => return None,
        }
    } else if let Some(voxel) = record.validation.voxel.as_ref() {
        // A voxel run addresses its parts the same flat way a sprite sheet
        // addresses its frames: a static model serves under bare names (its one
        // part), an animated model suffixes each part with its `-<index>` in
        // declared order. The `mesh` kind is the `.glb` the 3D client renders;
        // `preview` is the model's rendered isometric PNG.
        let part = match frame {
            Some(index) => voxel.parts.get(index as usize)?,
            None => voxel.parts.first()?,
        };
        match kind {
            "preview" => &part.preview_image,
            "actions" => &part.ops_log,
            // The `mesh` kind is the `PartMesh`-shaped `.glb` the 3D client renders.
            "mesh" => &part.mesh,
            _ => return None,
        }
    } else if let Some(ui) = record.validation.ui.as_ref() {
        // A UI run serves its flattened per-element PNG(s) — a single-image case
        // under the bare `element.png`, a kit suffixing each element with its
        // `-<index>` in declared order — plus the `ui.json` manifest. Matches the
        // snapshot and driver enumerators.
        match (kind, frame) {
            ("ui", None) => UI_JSON_DEST,
            ("element", Some(index)) => &ui.elements.get(index as usize)?.image,
            ("element", None) => &ui.elements.first()?.image,
            _ => return None,
        }
    } else if let Some(material) = record.validation.material.as_ref() {
        // A material run serves each map by its declared index (`map-<index>.png`,
        // always suffixed) and the `material.json` manifest.
        match (kind, frame) {
            ("material", None) => MATERIAL_JSON_DEST,
            ("map", Some(index)) => &material.maps.get(index as usize)?.image,
            _ => return None,
        }
    } else if let Some(particle) = record.validation.particle.as_ref() {
        // A particle run serves the authored `system.json` (the asset a game
        // simulates live) and, when rendered, the preview `effect.gif` under the
        // served name `preview.gif`.
        match (kind, frame) {
            ("system", None) => &particle.system,
            ("preview", None) => particle.preview.as_deref()?,
            _ => return None,
        }
    } else if let Some(audio) = record.validation.audio.as_ref() {
        // An audio run serves the rendered `clip.wav`, the portable `score.mid`
        // (music only), and the waveform/spectrogram preview PNG.
        match (kind, frame) {
            ("clip", None) => &audio.clip,
            ("score", None) => audio.midi.as_deref()?,
            ("preview", None) => audio.preview.as_deref()?,
            _ => return None,
        }
    } else if let Some(adversarial) = record.validation.adversarial.as_ref() {
        match kind {
            // Each opponent's replay is one entry in `replays`, addressed by its
            // index: `replay.json` (frame `None`) is the canonical opponent at
            // index 0, `replay-<i>.json` selects entry `i`.
            "replay" => {
                let index = frame.unwrap_or(0) as usize;
                match adversarial.replays.get(index) {
                    Some(entry) => &entry.replay_json,
                    // Fall back to the canonical path for index 0 even when the
                    // list is absent (a forfeit run records no replays).
                    None if index == 0 => &adversarial.replay_json,
                    None => return None,
                }
            }
            _ => return None,
        }
    } else {
        let performance = record.validation.performance.as_ref()?;
        match kind {
            // The run's own engine module (`engine.wasm`), served under its
            // run-level `module_wasm` name — parsed as kind `engine` (it carries no
            // `-<index>` suffix). Browser playback loads and steps this one wasm to
            // reconstruct the factory across every scenario; only a run whose build
            // emitted a module records one. Without this arm the console's module URL
            // 404s even though the bytes were uploaded, and playback cannot start.
            "engine" => performance.module_wasm.as_deref()?,
            // Each scored case's scenario is one entry in `cases`, addressed by its
            // index: `scenario.json` (frame `None`) is the first case,
            // `scenario-<i>.json` selects case `i`. Browser playback fetches this
            // and re-simulates it; only a case the engine got right records one.
            "scenario" => {
                let index = frame.unwrap_or(0) as usize;
                performance.cases.get(index)?.scenario_json.as_deref()?
            }
            _ => return None,
        }
    };

    Some(rel)
}

/// Parse an asset request into its kind and optional frame index: `regenerated.png`
/// → `("regenerated", None)`; `actions-3.json` → `("actions", Some(3))`. The kind
/// names (`regenerated`/`preview`/`actions`) carry no `-`, so a trailing
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

/// The labels for an asset-generation artifact, by file name: the
/// regenerated/preview images are PNG, the action log is JSON.
fn asset_labels(file: &str) -> ContentLabels {
    let ext = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("png") => ContentLabels::plain("image/png"),
        Some("json") => ContentLabels::plain("application/json"),
        Some("glb") => ContentLabels::plain("model/gltf-binary"),
        Some("gif") => ContentLabels::plain("image/gif"),
        Some("wav") => ContentLabels::plain("audio/wav"),
        Some("mid" | "midi") => ContentLabels::plain("audio/midi"),
        Some("wasm") => ContentLabels::plain("application/wasm"),
        Some("gz") => content_labels::for_gz(file),
        _ => ContentLabels::plain("application/octet-stream"),
    }
}

/// The labels for a proof media file, by file name — the image, video, and
/// recording formats a proof's `dest` (or a validation output) may name (see
/// [`MediaKind`](test_cabinet_contracts::test_case::MediaKind)). Anything unrecognized falls back to
/// a binary stream.
fn proof_labels(file: &str) -> ContentLabels {
    let ext = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("png") => ContentLabels::plain("image/png"),
        Some("jpg" | "jpeg") => ContentLabels::plain("image/jpeg"),
        Some("webp") => ContentLabels::plain("image/webp"),
        Some("gif") => ContentLabels::plain("image/gif"),
        Some("webm") => ContentLabels::plain("video/webm"),
        Some("mp4") => ContentLabels::plain("video/mp4"),
        // The raw RGBA bytes of a `pixels` entry a recording keeps beside itself
        // (`img.<id>.bin` — see [`VALIDATION_IMAGE_PREFIX`](test_cabinet_contracts::layout::VALIDATION_IMAGE_PREFIX)): four bytes per
        // pixel in row order and no header of its own, because the entry that names
        // it carries the dimensions. The fallback arm below would already label it
        // this way; it is named explicitly so a reader of this match knows the store
        // is served from here and does not "tidy" the arm away.
        Some("bin") => ContentLabels::plain("application/octet-stream"),
        // A draw-command recording, stored gzipped (`<name>.json.gz`), is a JSON
        // document that travels compressed — so it is labelled as the JSON it is,
        // with the gzip declared as the body's framing.
        Some("gz") => content_labels::for_gz(file),
        // An uncompressed recording, and any other JSON media a proof names.
        Some("json") => ContentLabels::plain("application/json"),
        _ => ContentLabels::plain("application/octet-stream"),
    }
}

/// The labels for a showcase file, by file name: the proof formats (the showcase's
/// media kinds are inferred by the same extension rule) plus the markdown
/// description itself, which is also a plain file in the directory.
fn showcase_labels(file: &str) -> ContentLabels {
    let ext = Path::new(file)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("md") => ContentLabels::plain("text/markdown; charset=utf-8"),
        _ => proof_labels(file),
    }
}

#[cfg(test)]
#[path = "playable.test.rs"]
mod tests;
