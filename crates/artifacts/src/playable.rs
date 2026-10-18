//! Serving a run's produced playable build and proof media to a reviewer.
//!
//! A finished run collects its implementation under `<run>/implementation/`,
//! including the static build output the validator produced (`dist`/`build`/`out`).
//! A *published* run deploys that build to its own Cloudflare Pages host, where it
//! lives at the host root and its absolute asset references (`/assets/…`) resolve
//! (the publisher's release). But a reviewer must be able to play an *unpublished*
//! run too — that is the entire point of reviewing before publishing — so the
//! artifact service serves the same on-disk build over HTTP, discovering and
//! serving it through the helpers here.
//!
//! The same applies to a run's proof-of-implementation media — the screenshots and
//! clips the agent wrote as evidence (see [`serve_proof_file`]). A published run's
//! proofs are uploaded to the backend, but an unpublished run's sit in its collected
//! tree, so the artifact service serves them over HTTP from the resolver here.
//!
//! Serving under a per-run sub-path (rather than a host root) is the one wrinkle.
//! A Vite build emitted with the default `base: "/"` references its assets
//! absolutely (`/assets/index-….js`), which would escape the per-run base and
//! 404. So when serving an HTML document this module relocates it under the
//! build's base: it injects a `<base href>` and de-absolutizes root-relative
//! `src`/`href` references so the injected base applies (a `<base href>` does not
//! affect already-absolute `/…` URLs). Non-HTML assets are served byte-for-byte.
//! That rule is [`serve_build_file`], from `test_cabinet_contracts::layout`, because
//! the backend serves a suite's reference builds under a sub-path by the same rule.

use std::path::Path;

use test_cabinet_contracts::RunRecord;
use test_cabinet_contracts::test_case::{MATERIAL_JSON_DEST, UI_JSON_DEST};
use test_cabinet_suites::content_labels::{self, ContentLabels};

// The build-output names, the rule that finds a run's build among them, the rule a
// build file is served under a sub-path by, and the rules a proof is named and
// labelled by are run-tree layout every side agrees on (the validator, the code
// analyzer, the snapshot builder, the gallery, the backend's reference builds), so
// they live in `test_cabinet_contracts::layout` and are re-exported here beside the
// serving that uses them.
pub use test_cabinet_contracts::layout::{
    BUILD_OUTPUTS, ServedBuildFile, find_build_output, proof_labelled_name,
    proof_published_extension, proof_served_extension, serve_build_file,
};

/// A proof-of-implementation media file resolved from a run, ready to write to an
/// HTTP or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedProofFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`content_labels`]).
    pub content_encoding: Option<&'static str>,
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
    let record: RunRecord = serde_json::from_slice(&record_bytes).ok()?;
    let proof = record.validation.proofs.iter().find(|p| p.id == proof_id)?;

    let body = std::fs::read(run_dir.join("implementation").join(&proof.dest)).ok()?;
    let labels = proof_labels(proof_labelled_name(&proof.dest, file));
    Some(ServedProofFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    })
}

/// A synthesized validation media file resolved from a run, ready to write to an
/// HTTP or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedValidationFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`content_labels`]).
    pub content_encoding: Option<&'static str>,
    /// The media bytes, served verbatim.
    pub body: Vec<u8>,
}

/// The host namespace directory produced trees carried before it was renamed to
/// `.vendor`. Runs collected under the old name are immutable history, so every
/// read-back path keeps resolving it.
const LEGACY_VENDOR_DIR: &str = ".tcab";

/// Resolve and read one synthesized validation media file from a produced run's
/// output directory, for serving to a reviewer the same way [`serve_proof_file`]
/// serves proof media.
///
/// `run_dir` is the run's output directory (`<out>/<id>`), holding its
/// `run-record.json` and its collected `implementation/` tree. `file` is the flat,
/// addressable media name a debug script's output is stored under —
/// `<item>__<output>.<ext>` for the model's build, `<item>__<output>.baseline.<ext>`
/// for the reference implementation (see `test_cabinet_contracts::layout::validation_media_name`).
/// The bytes live in the collected tree under `.vendor/validation/`, so this reads
/// straight from `implementation/.vendor/validation/<file>`. Returns `None` when the
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
pub fn serve_validation_file(run_dir: &Path, file: &str) -> Option<ServedValidationFile> {
    // The name is a single flat segment; reject any path separator or traversal so a
    // request can only ever name a file directly inside the validation media dir.
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return None;
    }
    let implementation = run_dir.join("implementation");
    let body = [".vendor", LEGACY_VENDOR_DIR].into_iter().find_map(|dir| {
        std::fs::read(implementation.join(dir).join("validation").join(file)).ok()
    })?;
    let labels = proof_labels(file);
    Some(ServedValidationFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    })
}

/// A showcase file resolved from a run, ready to write to an HTTP or IPC
/// response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedShowcaseFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`content_labels`]).
    pub content_encoding: Option<&'static str>,
    /// The media bytes, served verbatim.
    pub body: Vec<u8>,
}

/// Resolve and read one of a run's [showcase](test_cabinet_contracts::RunShowcase) files from a
/// produced run's output directory, for serving to a reviewer the same way
/// [`serve_validation_file`] serves validation media.
///
/// `run_dir` is the run's output directory (`<out>/<id>`), holding its
/// `run-record.json` and its collected `implementation/` tree. `file` is the plain
/// file name a showcase entry (or an image the description references) carries —
/// the showcase directory is a flat namespace by construction — so this reads
/// straight from `implementation/showcase/<file>`. `showcase.toml` is refused so
/// this route exposes exactly the namespace the backend store mirror holds (the
/// manifest is capture-side input, already folded into the record). Returns `None`
/// when the file is missing or the name would escape the directory — the caller
/// maps that to a 404.
///
/// A `.json.gz` replay is labelled as the JSON it is with the gzip declared as the
/// body's framing (exactly as validation replays are), so a browser inflates it
/// transparently before the player sees it.
pub fn serve_showcase_file(run_dir: &Path, file: &str) -> Option<ServedShowcaseFile> {
    // The name is a single flat segment; reject any path separator or traversal so a
    // request can only ever name a file directly inside the showcase dir.
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return None;
    }
    if file == "showcase.toml" {
        return None;
    }
    let body = std::fs::read(run_dir.join("implementation").join("showcase").join(file)).ok()?;
    let labels = showcase_labels(file);
    Some(ServedShowcaseFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    })
}

/// An asset-generation media file resolved from a run, ready to write to an HTTP
/// or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedAssetFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`content_labels`]).
    pub content_encoding: Option<&'static str>,
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
/// Returns `None` when the run record, its asset result, the named frame, the
/// artifact, or the file is missing — the caller maps that to a 404.
pub fn serve_asset_file(run_dir: &Path, file: &str) -> Option<ServedAssetFile> {
    let (kind, frame) = parse_asset_request(file)?;

    let record_bytes = std::fs::read(run_dir.join("run-record.json")).ok()?;
    let record: RunRecord = serde_json::from_slice(&record_bytes).ok()?;

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

    let body = std::fs::read(run_dir.join("implementation").join(rel)).ok()?;
    let labels = asset_labels(file);
    Some(ServedAssetFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    })
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
