//! Serving a run's produced playable build and proof media to a reviewer.
//!
//! A finished run collects its implementation under `<run>/implementation/`,
//! including the static build output the validator produced (`dist`/`build`/`out`).
//! A *published* run deploys that build to its own Cloudflare Pages host, where it
//! lives at the host root and its absolute asset references (`/assets/…`) resolve
//! (see [`crate::publish`]). But a reviewer must be able to play an *unpublished*
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

use crate::content_labels::{self, ContentLabels};
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
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`crate::content_labels`]).
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
    read_proof_file(run_dir, file).ok().flatten()
}

/// [`serve_proof_file`], telling a file the tree does not hold from a tree that
/// could not say.
///
/// `Ok(None)` only when the tree positively holds no such file: there is no tree,
/// the record that was read names no such proof, or nothing is at the place the
/// record gives. Every other failure is an error: a record that is missing from a
/// tree, unreadable or unparseable, and a file that is there and could not be
/// read. A caller that takes "the tree holds no such file" for a fact about the
/// run must use this function, because [`serve_proof_file`] answers `None` for
/// both.
pub fn read_proof_file(run_dir: &Path, file: &str) -> std::io::Result<Option<ServedProofFile>> {
    // The request names the file `<proof-id>.<ext>`; recover the proof id.
    let proof_id = file.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file);

    let Some(record) = read_tree_record(run_dir)? else {
        return Ok(None);
    };
    let Some(proof) = record.validation.proofs.iter().find(|p| p.id == proof_id) else {
        return Ok(None);
    };
    let implementation = run_dir.join("implementation");
    let Some(body) = read_tree_file(&implementation, &implementation.join(&proof.dest))? else {
        return Ok(None);
    };
    let labels = proof_labels(proof_labelled_name(&proof.dest, file));
    Ok(Some(ServedProofFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    }))
}

/// Whether a failed read says that nothing is at the path: no entry, or a path
/// that leads through something that is not a directory.
fn says_no_file(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

/// Read `path`, a file of a produced run's tree that must lie inside `base`.
///
/// `Ok(None)` when nothing is there, and when what is there resolves, links
/// followed, to a place outside `base`: a tree is unpacked with the links a model
/// wrote, and a link out of the tree names no file of the run. An error for
/// anything that is there and could not be read.
fn read_tree_file(base: &Path, path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let Some(resolved) = resolved_inside(base, path)? else {
        return Ok(None);
    };
    match std::fs::read(&resolved) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if says_no_file(&err) => Ok(None),
        Err(err) => Err(err),
    }
}

/// `path` with every link resolved, when it exists and lies inside `base`.
/// `Ok(None)` when either does not exist, and when `path` leads out of `base`.
fn resolved_inside(base: &Path, path: &Path) -> std::io::Result<Option<PathBuf>> {
    let resolve = |path: &Path| match std::fs::canonicalize(path) {
        Ok(resolved) => Ok(Some(resolved)),
        Err(err) if says_no_file(&err) => Ok(None),
        Err(err) => Err(err),
    };
    let (Some(base), Some(resolved)) = (resolve(base)?, resolve(path)?) else {
        return Ok(None);
    };
    Ok(resolved.starts_with(&base).then_some(resolved))
}

/// The bytes of a produced run's `run-record.json`.
///
/// `Ok(None)` when there is no tree at `run_dir` at all. A tree that is there
/// without its record is an error, as is a record that could not be read: neither
/// says anything about which files the run has.
fn read_tree_record_bytes(run_dir: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match std::fs::read(run_dir.join("run-record.json")) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if says_no_file(&err) => match std::fs::metadata(run_dir) {
            Ok(_) => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("the run tree at {} holds no run record", run_dir.display()),
            )),
            Err(err) if says_no_file(&err) => Ok(None),
            Err(err) => Err(err),
        },
        Err(err) => Err(err),
    }
}

/// A produced run's record, by the rule of [`read_tree_record_bytes`]. A record
/// this build cannot parse is an error.
fn read_tree_record(run_dir: &Path) -> std::io::Result<Option<crate::RunRecord>> {
    let Some(bytes) = read_tree_record_bytes(run_dir)? else {
        return Ok(None);
    };
    serde_json::from_slice(&bytes).map(Some).map_err(|err| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "the run record at {} does not parse: {err}",
                run_dir.display()
            ),
        )
    })
}

/// The name a proof's bytes are labelled from: its recorded `dest`, falling back to
/// the requested name when the dest carries no usable extension.
///
/// A proof is *addressed* as `<proof-id>.<ext>`, and that name keeps only the last
/// extension — `<proof-id>.gz` for a `dest` of `shots/rally.json.gz`, which cannot
/// say whether the gzip frames a document or is one. The dest carries the whole
/// compound suffix, so the labels come from it (see [`crate::content_labels`]).
pub fn proof_labelled_name<'a>(dest: &'a str, file: &'a str) -> &'a str {
    let base = dest.rsplit('/').next().unwrap_or(dest);
    match base.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < base.len() => base,
        _ => file,
    }
}

/// The file extension a proof is served under, derived from its `dest` path: the
/// lowercased extension of the dest's final path segment, defaulting to `png` when
/// there is none usable (a leading- or trailing-dot segment, or no dot at all).
///
/// A proof is addressed everywhere as `<proof-id>.<ext>` — this computes the `<ext>`
/// from the recorded `dest` so the served name lines up across the producers and
/// consumers of that name: the driver's backend-store mirror, the backend snapshot
/// builder, and the gallery's `extensionFor` (`packages/ui/.../proofMedia.ts`). The
/// extension is cosmetic (the file is resolved by its proof-id stem), but it must
/// agree on all sides or a snapshot key misses the URL the UI requests.
pub fn proof_served_extension(dest: &str) -> String {
    let base = dest.rsplit('/').next().unwrap_or(dest);
    match base.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < base.len() => base[dot + 1..].to_ascii_lowercase(),
        _ => "png".to_string(),
    }
}

/// The file extension a proof is served under **in the public snapshot** — as
/// opposed to [`proof_served_extension`], which is how it is served live from the
/// produced tree.
///
/// They differ for video only. A run captures its clip as the `.webm` Playwright
/// records natively (the single format a case's `dest` names), which the live
/// console serves verbatim; but the snapshot builder transcodes it to H.264
/// `.mp4` so the public gallery plays on every browser (webm/VP8 does not on
/// iOS/Safari). So a `Video` proof publishes as `mp4` regardless of its `dest`,
/// while an `Image` or `Replay` proof publishes under its recorded extension
/// unchanged — there is no second format either of those is converted into.
pub fn proof_published_extension(kind: crate::test_case::MediaKind, dest: &str) -> String {
    match kind {
        crate::test_case::MediaKind::Video => "mp4".to_string(),
        crate::test_case::MediaKind::Image | crate::test_case::MediaKind::Replay => {
            proof_served_extension(dest)
        }
    }
}

/// A synthesized validation media file resolved from a run, ready to write to an
/// HTTP or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedValidationFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`crate::content_labels`]).
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
/// for the reference implementation (see `crate::validator::validation_media_name`).
/// The bytes live in the collected tree under `.vendor/validation/`, so this reads
/// straight from `implementation/.vendor/validation/<file>`. Returns `None` when the
/// file is missing or the name would escape the directory — the caller maps that to
/// a 404.
///
/// The same directory also holds a recording's **shared image store** —
/// `img.<id>.png` and `img.<id>.bin`, the deduplicated bitmaps and pixel buffers a
/// recording's entries name rather than carry (see
/// [`crate::VALIDATION_IMAGE_PREFIX`]). Those names are flat single segments like
/// every other one here, so they are served by this function and its route with no
/// change: that a store file resolves through exactly the lookup the recording it
/// belongs to resolved through is the whole reason the reference on an entry is a
/// file name and not a URL.
///
/// Trees collected before the host namespace was renamed carry the same media under
/// `.tcab/validation/`. Those runs are immutable and are still served, so a miss in
/// the current directory falls back to the legacy one rather than 404ing history.
pub fn serve_validation_file(run_dir: &Path, file: &str) -> Option<ServedValidationFile> {
    read_validation_file(run_dir, file).ok().flatten()
}

/// [`serve_validation_file`], telling a file the tree does not hold (`Ok(None)`)
/// from one that is there and could not be read (an error). See
/// [`read_proof_file`].
pub fn read_validation_file(
    run_dir: &Path,
    file: &str,
) -> std::io::Result<Option<ServedValidationFile>> {
    // The name is a single flat segment; reject any path separator or traversal so a
    // request can only ever name a file directly inside the validation media dir.
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return Ok(None);
    }
    let implementation = run_dir.join("implementation");
    let mut body = None;
    for dir in [".vendor", LEGACY_VENDOR_DIR] {
        body = read_tree_file(
            &implementation,
            &implementation.join(dir).join("validation").join(file),
        )?;
        if body.is_some() {
            break;
        }
    }
    let Some(body) = body else {
        return Ok(None);
    };
    let labels = proof_labels(file);
    Ok(Some(ServedValidationFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    }))
}

/// The names of the files directly inside `dir`, sorted. A directory that does
/// not exist holds none; any other failure to read it is the caller's to report.
fn flat_file_names(dir: &Path) -> std::io::Result<Vec<String>> {
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut names = Vec::new();
    for entry in read {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && let Some(name) = entry.file_name().to_str()
        {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

/// The names of the validation media files a produced run's tree holds: every
/// name [`serve_validation_file`] would resolve, from the current directory and
/// the legacy one alike, each once and sorted.
///
/// A run's declared outputs are named by its record, but the image store its
/// recordings share is named by nothing but this directory, so a reader that has
/// to account for all of a run's media asks for the listing.
pub fn list_validation_files(run_dir: &Path) -> std::io::Result<Vec<String>> {
    let implementation = run_dir.join("implementation");
    let mut names = Vec::new();
    for dir in [".vendor", LEGACY_VENDOR_DIR] {
        names.extend(flat_file_names(
            &implementation.join(dir).join("validation"),
        )?);
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// The names of the showcase files a produced run's tree holds: every name
/// [`serve_showcase_file`] would resolve, sorted. `showcase.toml` is left out, as
/// that function refuses it.
pub fn list_showcase_files(run_dir: &Path) -> std::io::Result<Vec<String>> {
    let mut names = flat_file_names(&run_dir.join("implementation").join("showcase"))?;
    names.retain(|name| name != "showcase.toml");
    Ok(names)
}

/// The name a run's controller module is served under by [`tree_root_file`], and
/// the name the backend stores it as.
pub const TREE_ROOT_CONTROLLER: &str = "controller.wasm";

/// The name a run's code-analysis document is served under by
/// [`tree_root_file`], and the name the backend stores it as.
pub const TREE_ROOT_CODE_ANALYSIS: &str = "code-analysis.json";

/// Every name [`tree_root_file`] resolves.
///
/// A gg run's session record sits at a tree's root too and is deliberately not
/// one of them: it carries the complete model conversation of its run and is
/// never published, so nothing has to read it from here.
pub const TREE_ROOT_FILES: [&str; 2] = [TREE_ROOT_CONTROLLER, TREE_ROOT_CODE_ANALYSIS];

/// Where a produced run's tree holds the file a backend stores as `name`, or
/// `None` for a name that is not one of [`TREE_ROOT_FILES`] and for a controller
/// the run's record does not name.
///
/// These are the files of a run that sit outside its media directories. The
/// document is at the tree's root under its gzipped name. The controller is
/// wherever the record's `controllerModule` says, inside `implementation/`, and a
/// path that would leave that directory names nothing.
fn tree_root_file_path(run_dir: &Path, name: &str) -> std::io::Result<Option<TreeRootPath>> {
    match name {
        TREE_ROOT_CODE_ANALYSIS => Ok(Some(TreeRootPath {
            base: run_dir.to_path_buf(),
            path: run_dir.join(crate::CODE_ANALYSIS_TREE_ARTIFACT),
        })),
        TREE_ROOT_CONTROLLER => {
            let Some(record_bytes) = read_tree_record_bytes(run_dir)? else {
                return Ok(None);
            };
            // Read by path and not as a whole record, so a record this build can no
            // longer parse in full still names its controller.
            let record: serde_json::Value =
                serde_json::from_slice(&record_bytes).map_err(|err| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("the run record at {} is not JSON: {err}", run_dir.display()),
                    )
                })?;
            let Some(module) = record
                .pointer("/validation/adversarial/controllerModule")
                .and_then(serde_json::Value::as_str)
            else {
                return Ok(None);
            };
            let relative = Path::new(module);
            let inside = !module.is_empty()
                && relative
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)));
            let base = run_dir.join("implementation");
            Ok(inside.then(|| TreeRootPath {
                path: base.join(relative),
                base,
            }))
        }
        _ => Ok(None),
    }
}

/// Where a tree holds one of [`TREE_ROOT_FILES`].
struct TreeRootPath {
    /// The directory the file must lie inside once every link is resolved.
    base: PathBuf,
    /// The file's place.
    path: PathBuf,
}

/// Read the file a backend stores as `name` from a produced run's tree, verbatim.
///
/// `Ok(None)` when the tree holds no such file, which includes a name that is not
/// one of [`TREE_ROOT_FILES`], a tree that is not there, and a path that resolves
/// through a link to a place outside the tree. An error for a file that is there
/// and could not be read, and for a controller whose run record is missing from
/// its tree, unreadable or not JSON: none of those says the tree lacks the file,
/// and a caller must not take them for a missing one.
pub fn tree_root_file(run_dir: &Path, name: &str) -> std::io::Result<Option<Vec<u8>>> {
    let Some(place) = tree_root_file_path(run_dir, name)? else {
        return Ok(None);
    };
    read_tree_file(&place.base, &place.path)
}

/// The names of [`TREE_ROOT_FILES`] a produced run's tree holds: every name
/// [`tree_root_file`] would resolve to a file. An error when the tree cannot say
/// whether it holds one, by the rule of [`tree_root_file`].
pub fn list_tree_root_files(run_dir: &Path) -> std::io::Result<Vec<String>> {
    let mut names = Vec::new();
    for name in TREE_ROOT_FILES {
        let Some(place) = tree_root_file_path(run_dir, name)? else {
            continue;
        };
        let Some(resolved) = resolved_inside(&place.base, &place.path)? else {
            continue;
        };
        match std::fs::metadata(&resolved) {
            Ok(found) if found.is_file() => names.push(name.to_string()),
            Ok(_) => {}
            Err(err) if says_no_file(&err) => {}
            Err(err) => return Err(err),
        }
    }
    Ok(names)
}

/// A showcase file resolved from a run, ready to write to an HTTP or IPC
/// response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedShowcaseFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`crate::content_labels`]).
    pub content_encoding: Option<&'static str>,
    /// The media bytes, served verbatim.
    pub body: Vec<u8>,
}

/// Resolve and read one of a run's [showcase](crate::RunShowcase) files from a
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
    read_showcase_file(run_dir, file).ok().flatten()
}

/// [`serve_showcase_file`], telling a file the tree does not hold (`Ok(None)`)
/// from one that is there and could not be read (an error). See
/// [`read_proof_file`].
pub fn read_showcase_file(
    run_dir: &Path,
    file: &str,
) -> std::io::Result<Option<ServedShowcaseFile>> {
    // The name is a single flat segment; reject any path separator or traversal so a
    // request can only ever name a file directly inside the showcase dir.
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return Ok(None);
    }
    if file == "showcase.toml" {
        return Ok(None);
    }
    let implementation = run_dir.join("implementation");
    let Some(body) = read_tree_file(&implementation, &implementation.join("showcase").join(file))?
    else {
        return Ok(None);
    };
    let labels = showcase_labels(file);
    Ok(Some(ServedShowcaseFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    }))
}

/// An asset-generation media file resolved from a run, ready to write to an HTTP
/// or IPC response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServedAssetFile {
    /// The `Content-Type` to send, derived from the file name.
    pub content_type: &'static str,
    /// The `Content-Encoding` to send, `None` unless the bytes are a framed
    /// document (see [`crate::content_labels`]).
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
    read_asset_file(run_dir, file).ok().flatten()
}

/// [`serve_asset_file`], telling a file the tree does not hold (`Ok(None)`) from
/// a tree that could not say (an error). See [`read_proof_file`].
pub fn read_asset_file(run_dir: &Path, file: &str) -> std::io::Result<Option<ServedAssetFile>> {
    let Some((kind, frame)) = parse_asset_request(file) else {
        return Ok(None);
    };
    let Some(record) = read_tree_record(run_dir)? else {
        return Ok(None);
    };
    let Some(rel) = asset_tree_path(&record, kind, frame) else {
        return Ok(None);
    };
    let implementation = run_dir.join("implementation");
    let Some(body) = read_tree_file(&implementation, &implementation.join(rel))? else {
        return Ok(None);
    };
    let labels = asset_labels(file);
    Ok(Some(ServedAssetFile {
        content_type: labels.content_type,
        content_encoding: labels.content_encoding,
        body,
    }))
}

/// Where `record`'s tree holds the asset a request for `kind` and `frame` names,
/// relative to `implementation/`, or `None` when the record names no such asset.
fn asset_tree_path<'a>(
    record: &'a crate::RunRecord,
    kind: &str,
    frame: Option<u32>,
) -> Option<&'a str> {
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
            ("ui", None) => crate::test_case::UI_JSON_DEST,
            ("element", Some(index)) => &ui.elements.get(index as usize)?.image,
            ("element", None) => &ui.elements.first()?.image,
            _ => return None,
        }
    } else if let Some(material) = record.validation.material.as_ref() {
        // A material run serves each map by its declared index (`map-<index>.png`,
        // always suffixed) and the `material.json` manifest.
        match (kind, frame) {
            ("material", None) => crate::test_case::MATERIAL_JSON_DEST,
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
/// [`MediaKind`](crate::test_case::MediaKind)). Anything unrecognized falls back to
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
        // (`img.<id>.bin` — see [`crate::VALIDATION_IMAGE_PREFIX`]): four bytes per
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
