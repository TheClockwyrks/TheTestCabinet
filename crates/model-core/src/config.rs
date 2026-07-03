//! The seeded run-config shapes the voxel-family binaries read.
//!
//! The orchestrator seeds one of these next to a run so the tool's operations need
//! no volume flags: a [`Config`] for a single static model, an [`AnimConfig`] for a
//! rigged, animated model (one separate file set per part). These shapes are
//! generic across the whole voxel family — the fields describe the volume framing,
//! where the recorded log/preview/mesh live, and the optional live-preview endpoint
//! — so every tool (cube or meshing) reads the same config.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::color::PreviewBackground;

/// The live-preview endpoint seeded next to a run that a viewer is observing.
///
/// When present, the sculpting binary streams each re-rendered preview here so the
/// viewer can watch the model take shape between operations. It is absent for an
/// unobserved run, and streaming is always best-effort: an operation never fails
/// because the live view is slow or unreachable, since the recorded action log —
/// not these frames — is the run's authoritative output.
#[derive(Debug, Clone, Deserialize)]
pub struct LiveConfig {
    /// The `host:port` the binary connects to. This is the run host, reachable from
    /// inside the run container as `host.docker.internal`.
    pub endpoint: String,
    /// An opaque per-run token echoed with each update, so the listener accepts only
    /// the frames belonging to its own run.
    pub token: String,
}

/// The volume configuration the orchestrator seeds next to a single static-model
/// run so a static tool's operations and `init` need no volume flags.
#[derive(Debug, Deserialize)]
pub struct Config {
    /// Volume width in voxels.
    pub width: u32,
    /// Volume height in voxels.
    pub height: u32,
    /// Volume depth in voxels.
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// Run-workspace-relative path of the recorded action log.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// Run-workspace-relative path the current preview is re-rendered to.
    #[serde(default = "default_preview")]
    pub preview: PathBuf,
    /// Run-workspace-relative path the current surface mesh (`mesh.json`) is written
    /// to after every operation — the single source of geometry consumers read.
    #[serde(default = "default_mesh")]
    pub mesh: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. Absent for
    /// an unobserved run (a plain `tcab run` or `tcab validate`).
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl Config {
    /// The volume extents `(width, height, depth)`.
    pub fn extents(&self) -> (u32, u32, u32) {
        (self.width, self.height, self.depth)
    }

    /// The parsed preview background.
    pub fn background(&self) -> Result<PreviewBackground, String> {
        PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))
    }
}

/// The rig configuration the orchestrator seeds next to an animated-model run.
///
/// A rig's parts are **completely separate files**: each declared part has its own
/// action log, preview, and mesh, derived from the `{part}` templates below by
/// substituting the part name. The volume dimensions describe the shared coordinate
/// space all parts are sculpted in. The rig's structure (parts + joints) lives in
/// [`Self::rig`] (`rig.json`), pre-seeded from the manifest's required contract.
#[derive(Debug, Deserialize)]
pub struct AnimConfig {
    /// Volume width in voxels.
    pub width: u32,
    /// Volume height in voxels.
    pub height: u32,
    /// Volume depth in voxels.
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// Template for a part's action-log path, with `{part}` replaced by the part
    /// name (for example `parts/{part}.actions.json`).
    #[serde(default = "default_anim_actions")]
    pub actions: String,
    /// Template for a part's preview-image path, with `{part}` replaced by the part
    /// name (for example `parts/{part}.png`).
    #[serde(default = "default_anim_preview")]
    pub preview: String,
    /// Template for a part's mesh path, with `{part}` replaced by the part name (for
    /// example `parts/{part}.mesh.json`).
    #[serde(default = "default_anim_mesh")]
    pub mesh: String,
    /// Template for the **assembled-scene** preview path, with `{view}` replaced by
    /// the view name (`iso`, `front`, `side`, `top`). The whole rig composed at rest
    /// and re-rendered after every operation, so the model can check how its
    /// separately sculpted parts fit together on the finished model. Not a scored
    /// artifact (the per-part previews are); defaults to `scene/{view}.png`.
    #[serde(default = "default_anim_scene")]
    pub scene: String,
    /// Run-workspace-relative path of the rig structure (`rig.json`).
    #[serde(default = "default_rig")]
    pub rig: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. See
    /// [`Config::live`].
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl AnimConfig {
    /// The volume extents `(width, height, depth)` (the shared space all parts
    /// sculpt in).
    pub fn extents(&self) -> (u32, u32, u32) {
        (self.width, self.height, self.depth)
    }

    /// The parsed preview background.
    pub fn background(&self) -> Result<PreviewBackground, String> {
        PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))
    }

    /// The action-log path for `part`.
    pub fn actions_for(&self, part: &str) -> PathBuf {
        PathBuf::from(self.actions.replace("{part}", part))
    }

    /// The preview-image path for `part`.
    pub fn preview_for(&self, part: &str) -> PathBuf {
        PathBuf::from(self.preview.replace("{part}", part))
    }

    /// The mesh path for `part`.
    pub fn mesh_for(&self, part: &str) -> PathBuf {
        PathBuf::from(self.mesh.replace("{part}", part))
    }

    /// The assembled-scene preview path for `view` (`iso`, `front`, `side`, `top`).
    pub fn scene_for(&self, view: &str) -> PathBuf {
        PathBuf::from(self.scene.replace("{view}", view))
    }

    /// The parts currently defined in the rig (`rig.json`). Parts are **model-
    /// invented**: an animated case fixes no parts, so the model creates them at run
    /// time with `define-part` and `rig.json` is the authoritative, growing registry.
    /// Returns an empty list before any part is defined (or if the rig file is absent
    /// or unreadable) — the model has simply not defined a part yet.
    pub fn declared_parts(&self) -> Vec<String> {
        crate::rig::Rig::load(&self.rig)
            .map(|rig| rig.parts.into_iter().map(|p| p.name).collect())
            .unwrap_or_default()
    }

    /// Whether `part` has been defined in the rig (`define-part`), so a field
    /// operation may target it.
    pub fn has_part(&self, part: &str) -> bool {
        self.declared_parts().iter().any(|p| p == part)
    }
}

fn default_background() -> String {
    "transparent".to_string()
}

fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}

fn default_preview() -> PathBuf {
    PathBuf::from("model.png")
}

fn default_mesh() -> PathBuf {
    PathBuf::from("mesh.json")
}

fn default_anim_actions() -> String {
    "parts/{part}.actions.json".to_string()
}

fn default_anim_preview() -> String {
    "parts/{part}.png".to_string()
}

fn default_anim_mesh() -> String {
    "parts/{part}.mesh.json".to_string()
}

fn default_anim_scene() -> String {
    "scene/{view}.png".to_string()
}

fn default_rig() -> PathBuf {
    PathBuf::from("rig.json")
}

/// Read a JSON config file into `T`.
pub fn read_config<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let raw =
        fs::read_to_string(path).map_err(|err| format!("reading {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("invalid config {}: {err}", path.display()))
}
