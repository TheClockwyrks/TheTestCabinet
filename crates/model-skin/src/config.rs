//! The seeded run-config shape the skinning binaries read.
//!
//! The orchestrator seeds a `<binary>.config.json` next to a run so the tool's
//! operations need no flags. Because a skinned character is **one field / one mesh**,
//! every path is a **single file** (not a `{part}` template) — the log, the preview,
//! the skinned `mesh.glb`, the `rig.json`, and the posed-render image — even though a
//! skinned kind is animated. This is the skinned exception to the animated-kind
//! `{part}` rule.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use test_cabinet_model_core::color::PreviewBackground;
use test_cabinet_model_core::config::LiveConfig;

/// The volume + path configuration the orchestrator seeds next to a skinned-model run.
#[derive(Debug, Deserialize)]
pub struct SkinConfig {
    /// Volume width in field units.
    pub width: u32,
    /// Volume height in field units (up).
    pub height: u32,
    /// Volume depth in field units.
    pub depth: u32,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// Run-workspace-relative path of the recorded field-operation log.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// Run-workspace-relative path the current rest preview is rendered to.
    #[serde(default = "default_preview")]
    pub preview: PathBuf,
    /// Run-workspace-relative path the skinned surface mesh (`mesh.glb`) is written to.
    #[serde(default = "default_mesh")]
    pub mesh: PathBuf,
    /// Run-workspace-relative path of the rig structure (`rig.json`).
    #[serde(default = "default_rig")]
    pub rig: PathBuf,
    /// Run-workspace-relative path a posed (`--time`) render is written to.
    #[serde(default = "default_pose")]
    pub pose: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. Absent for an
    /// unobserved run.
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl SkinConfig {
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

/// Read a skinned-model config file.
pub fn read_config(path: &Path) -> Result<SkinConfig, String> {
    test_cabinet_model_core::config::read_config(path)
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
    PathBuf::from("mesh.glb")
}

fn default_rig() -> PathBuf {
    PathBuf::from("rig.json")
}

fn default_pose() -> PathBuf {
    PathBuf::from("scene/pose.png")
}
