//! Building an **asset-generation** case's reference implementation.
//!
//! An end-to-end or full-stack reference implementation is a static site: it is
//! built with the case's `[build]` commands and hosted on Cloudflare Pages, and
//! the finished artifact is what gets served. An asset-generation case has no
//! `[build]` table and produces no site — its output is a recorded action log per
//! frame, plus the image that log regenerates to.
//!
//! So an asset reference is authored as a **script**, not a project. The script
//! lives at `reference-impl/<variant>/draw.sh` inside the version folder and
//! contains nothing but calls to the case's own drawing binary — the same binary,
//! and the same one-operation-at-a-time discipline, a model is held to. Running it
//! reproduces both outputs exactly, which is why neither the images nor the logs
//! are committed: the script *is* the reference, and the bytes are derived.
//!
//! The workspace the script runs in is seeded through the **real** seeding path
//! ([`crate::seeding`]), so the canvas size, declared frames, and file layout come
//! from the manifest rather than being restated by each script. A script that
//! drifts from its case's `[canvas]` therefore fails against the seeded config
//! instead of silently producing an off-size reference.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::publish::CommandRunner;
use crate::test_case::{TestCaseVersion, Variant, frame_path};

/// The drawing script every asset-generation reference implementation ships,
/// relative to the variant's `reference-impl/<variant>/` directory.
///
/// A fixed name rather than a manifest key: an asset case declares no `[build]`
/// table to put one in, and one convention across every case keeps the eight
/// Lattice references (and any later kind) uniform.
pub const ASSET_REFERENCE_SCRIPT: &str = "draw.sh";

/// Environment variable overriding where the drawing binary is found. Set it to a
/// directory containing the binary named by the case's `[tool] binary`.
const BIN_DIR_ENV: &str = "TCAB_ASSET_BIN_DIR";

/// The object-store prefix an asset reference's frames are published under.
///
/// Sits beside the snapshot's `media/runs/…` rather than inside a per-snapshot
/// prefix, because a reference belongs to a case *version*, not to whichever
/// snapshot happened to be current when it was published — the objects must
/// survive the next refresh rewriting `snapshots/…`.
pub const REFERENCE_MEDIA_PREFIX: &str = "media/references";

/// The prefix holding one variant's published reference frames:
/// `media/references/<slug>/<version>/<variant>/`.
///
/// This is the single place the layout is defined. `tcab publish-reference` writes
/// keys under it and the backend lists the same prefix to learn which references
/// exist, so the writer and the reader cannot drift apart.
pub fn reference_prefix(slug: &str, version: &str, variant: &str) -> String {
    format!("{REFERENCE_MEDIA_PREFIX}/{slug}/{version}/{variant}")
}

/// The key of one published frame's rendered image.
pub fn reference_image_key(slug: &str, version: &str, variant: &str, index: u32) -> String {
    format!(
        "{}/frames/{index}.png",
        reference_prefix(slug, version, variant)
    )
}

/// The key of one published frame's recorded action log — kept beside the image so
/// a reviewer can read how the reference was drawn, not just what it looks like.
pub fn reference_actions_key(slug: &str, version: &str, variant: &str, index: u32) -> String {
    format!(
        "{}/frames/{index}.actions.json",
        reference_prefix(slug, version, variant)
    )
}

/// One published reference frame image, recovered from its object key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceMediaKey {
    /// The case slug the reference belongs to.
    pub slug: String,
    /// The case version.
    pub version: String,
    /// The variant slug.
    pub variant: String,
    /// The frame index.
    pub index: u32,
}

/// Recover the case/version/variant/frame a reference **image** key addresses, or
/// `None` when the key is not one (a log, or anything else under the prefix).
///
/// Images alone are parsed because they are what proves a frame was published: the
/// UI needs an image per frame, and a log without one would render nothing.
pub fn parse_reference_image_key(key: &str) -> Option<ReferenceMediaKey> {
    let rest = key
        .strip_prefix(REFERENCE_MEDIA_PREFIX)?
        .strip_prefix('/')?;
    let parts: Vec<&str> = rest.split('/').collect();
    // <slug>/<version>/<variant>/frames/<index>.png
    let [slug, version, variant, "frames", file] = parts.as_slice() else {
        return None;
    };
    let index: u32 = file.strip_suffix(".png")?.parse().ok()?;
    Some(ReferenceMediaKey {
        slug: (*slug).to_string(),
        version: (*version).to_string(),
        variant: (*variant).to_string(),
        index,
    })
}

/// One frame produced by a reference script: the regenerated image and the action
/// log it was regenerated from, both absolute paths inside the build workspace.
#[derive(Debug, Clone)]
pub struct AssetReferenceFrame {
    /// The declared frame index this pair belongs to. Always `0` for a single
    /// sprite, which has exactly one frame and no `[sheet]`.
    pub index: u32,
    /// The rendered preview the drawing binary wrote for this frame.
    pub image: PathBuf,
    /// The recorded action log for this frame — the authoritative output, kept
    /// alongside the image so a reviewer can read how the reference was drawn.
    pub actions: PathBuf,
}

/// Everything a reference script produced, ready to publish.
#[derive(Debug)]
pub struct AssetReferenceBuild {
    /// The workspace the script ran in. Held so the caller can read the frames
    /// before it is dropped; deleting it invalidates every path below.
    pub workspace: PathBuf,
    /// The produced frames, in declared order.
    pub frames: Vec<AssetReferenceFrame>,
}

/// Build one variant's asset-generation reference implementation.
///
/// Seeds `workspace` exactly as a run's repository would be seeded, runs the
/// variant's `draw.sh` in it with the case's drawing binary on `PATH`, and
/// collects the frames it produced. The workspace is the caller's to clean up.
///
/// Errors when the case is not asset-generation, the variant declares no
/// reference implementation, the script is missing or fails, or the script left a
/// declared frame without an image or an action log.
pub async fn build_asset_reference<R: CommandRunner>(
    runner: &R,
    test_case: &TestCaseVersion,
    variant: &Variant,
    workspace: &Path,
) -> Result<AssetReferenceBuild> {
    let tool = test_case.tool.as_ref().ok_or_else(|| {
        Error::Publish(format!(
            "case `{}` declares no [tool], so it has no drawing binary to build a \
             reference with (only asset-generation cases have script references)",
            test_case.slug
        ))
    })?;
    let reference_dir = variant.reference_impl.as_ref().ok_or_else(|| {
        Error::Publish(format!(
            "variant `{}` declares no reference implementation",
            variant.slug
        ))
    })?;

    let script = reference_dir.join(ASSET_REFERENCE_SCRIPT);
    if !script.is_file() {
        return Err(Error::Publish(format!(
            "variant `{}` reference implementation has no `{ASSET_REFERENCE_SCRIPT}` at {}",
            variant.slug,
            script.display()
        )));
    }
    // The catalog root may be relative (it defaults to `test-cases`), and the
    // script runs with the *workspace* as its working directory — so both the
    // script and its directory have to be absolute before they are handed to `sh`.
    let script = script
        .canonicalize()
        .map_err(|err| Error::Publish(format!("resolving {}: {err}", script.display())))?;
    let reference_dir = reference_dir
        .canonicalize()
        .map_err(|err| Error::Publish(format!("resolving {}: {err}", reference_dir.display())))?;

    std::fs::create_dir_all(workspace).map_err(|err| {
        Error::Publish(format!(
            "creating the reference workspace {}: {err}",
            workspace.display()
        ))
    })?;

    // Seed through the real seeding path so the canvas, the declared frames, and
    // the blank starting state all come from the manifest — a script never
    // restates them, so it cannot drift from the case it belongs to.
    crate::seeding::seed_asset_workspace(test_case, workspace)?;

    let bin_dir = resolve_binary_dir(&tool.binary)?;

    // Run the script with the drawing binary on `PATH`, from the seeded workspace,
    // so its calls look exactly like the ones a model issues in a run container.
    // `TCAB_REFERENCE_DIR` lets a script reach its own directory for any helper it
    // ships alongside `draw.sh`.
    let command = format!(
        "PATH={bin}:$PATH TCAB_REFERENCE_DIR={dir} sh {script}",
        bin = shell_quote(&bin_dir.to_string_lossy()),
        dir = shell_quote(&reference_dir.to_string_lossy()),
        script = shell_quote(&script.to_string_lossy()),
    );
    let output = runner
        .run("sh", &["-c", &command], Some(workspace))
        .await
        .map_err(|err| {
            Error::Publish(format!(
                "running the reference script for variant `{}`: {err}",
                variant.slug
            ))
        })?;
    if !output.success {
        let stderr = output.stderr.trim();
        let stdout = output.stdout.trim();
        let detail = match (stderr.is_empty(), stdout.is_empty()) {
            (true, true) => "(no output captured)".to_string(),
            (false, true) => stderr.to_string(),
            (true, false) => stdout.to_string(),
            (false, false) => format!("{stderr}\n{stdout}"),
        };
        return Err(Error::Publish(format!(
            "the reference script for variant `{}` failed: {detail}",
            variant.slug
        )));
    }

    let frames = collect_frames(test_case, workspace)?;
    Ok(AssetReferenceBuild {
        workspace: workspace.to_path_buf(),
        frames,
    })
}

/// Gather the image/log pair for every frame the case declares, erroring on the
/// first one the script left incomplete.
///
/// Declared frames drive this rather than whatever the script happened to write,
/// so a reference that silently skips a frame fails here instead of publishing a
/// sheet with a hole in it.
fn collect_frames(
    test_case: &TestCaseVersion,
    workspace: &Path,
) -> Result<Vec<AssetReferenceFrame>> {
    let tool = test_case
        .tool
        .as_ref()
        .ok_or_else(|| Error::Publish("case declares no [tool]".to_string()))?;
    let output = test_case
        .output
        .as_ref()
        .ok_or_else(|| Error::Publish("case declares no [output]".to_string()))?;

    // A sprite sheet has one image/log pair per declared frame, addressed through
    // the `{frame}` templates; a single sprite has exactly one pair at the plain
    // paths, which we treat as frame 0 so both kinds publish identically.
    let indices: Vec<u32> = match &test_case.sheet {
        Some(sheet) => sheet.frames.clone(),
        None => vec![0],
    };

    let mut frames = Vec::with_capacity(indices.len());
    for index in indices {
        let (image_rel, actions_rel) = match &test_case.sheet {
            Some(_) => (
                frame_path(&tool.preview, index),
                frame_path(&output.actions, index),
            ),
            None => (tool.preview.clone(), output.actions.clone()),
        };
        let image = workspace.join(&image_rel);
        let actions = workspace.join(&actions_rel);
        for (path, what) in [(&image, "image"), (&actions, "action log")] {
            if !path.is_file() {
                return Err(Error::Publish(format!(
                    "the reference script produced no {what} for frame {index} (expected {})",
                    path.display()
                )));
            }
        }
        frames.push(AssetReferenceFrame {
            index,
            image,
            actions,
        });
    }
    Ok(frames)
}

/// Locate the directory holding the case's drawing binary.
///
/// Prefers an explicit `TCAB_ASSET_BIN_DIR`, then the cargo target directory's
/// `release/` (where `cargo build --release` puts it, and where the asset tools
/// are normally driven from), then whatever is already on `PATH`. Errors naming
/// every location tried, since a missing binary is the likeliest first failure
/// when authoring a reference on a fresh checkout.
fn resolve_binary_dir(binary: &str) -> Result<PathBuf> {
    let mut tried: Vec<String> = Vec::new();

    if let Some(dir) = std::env::var_os(BIN_DIR_ENV) {
        let dir = PathBuf::from(dir);
        if dir.join(binary).is_file() {
            return Ok(dir);
        }
        tried.push(format!("{} (from {BIN_DIR_ENV})", dir.display()));
    }

    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("target"));
    let release = target.join("release");
    if release.join(binary).is_file() {
        return Ok(release);
    }
    tried.push(release.display().to_string());

    if let Ok(path) = which::which(binary)
        && let Some(dir) = path.parent()
    {
        return Ok(dir.to_path_buf());
    }
    tried.push("$PATH".to_string());

    Err(Error::Publish(format!(
        "could not find the `{binary}` binary (looked in: {}). Build it with \
         `cargo build --release -p test-cabinet-draw`, or point {BIN_DIR_ENV} at its directory.",
        tried.join(", ")
    )))
}

/// Single-quote a string for `sh`, so a path containing spaces or shell
/// metacharacters survives being interpolated into the command line.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
#[path = "asset_reference.test.rs"]
mod tests;
