//! The seeded run configuration the orchestrator writes next to a UI or material
//! workspace, and the `ui.json` / `material.json` output contracts core emits.
//!
//! These field shapes are the binary's side of the contract with `crates/core`.
//! Core defines its own parse-structs (as it does for the voxel tools); the names
//! here mirror the documented output contract
//! (`testing/asset-generation/{ui,material}-binaries.md`) and should be reconciled
//! against core's seeding once it lands (see the crate's returned contracts note).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::color::Background;
use crate::layer::Workspace;
use crate::nine_slice::NineSlice;
use crate::raster::WrapMode;

/// The live-preview endpoint, present only when a viewer is observing the run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveConfig {
    /// The `host:port` the binary connects to (reachable in-container as
    /// `host.docker.internal`).
    pub endpoint: String,
    /// The opaque per-run token echoed with each streamed frame.
    pub token: String,
}

/// One declared UI element (a document in the workspace).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ElementConfig {
    /// The element's unique name (addressed by `--element`).
    pub name: String,
    /// Element width in pixels.
    pub width: u32,
    /// Element height in pixels.
    pub height: u32,
    /// Fixed nine-slice insets, when the case declares them.
    #[serde(default)]
    pub nine_slice: Option<NineSlice>,
}

/// The config seeded next to a `ui` run (read by both `paint` and `ui`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintConfig {
    /// The kit's elements. Empty/absent → a single implicit `canvas` element of
    /// `width`×`height`.
    #[serde(default)]
    pub elements: Vec<ElementConfig>,
    /// The single-element (and default) width.
    #[serde(default = "default_size")]
    pub width: u32,
    /// The single-element (and default) height.
    #[serde(default = "default_size")]
    pub height: u32,
    /// Initial background of every element.
    #[serde(default = "default_background")]
    pub background: String,
    /// The shared interleaved operation-log path.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// The preview/emitted-PNG path template (`{element}` for a kit, or a literal
    /// file for a single element).
    #[serde(default = "default_ui_preview")]
    pub preview: String,
    /// The asset seed (recorded by `init`; per-op seeds derive from it).
    #[serde(default)]
    pub seed: u64,
    /// The live-preview endpoint, when observed.
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

/// The single implicit element name for a full-canvas UI case.
pub const SINGLE_ELEMENT: &str = "canvas";

impl PaintConfig {
    /// The elements this config declares (the single implicit `canvas` when none).
    pub fn element_list(&self) -> Vec<ElementConfig> {
        if self.elements.is_empty() {
            vec![ElementConfig {
                name: SINGLE_ELEMENT.to_string(),
                width: self.width,
                height: self.height,
                nine_slice: None,
            }]
        } else {
            self.elements.clone()
        }
    }

    /// Build the empty workspace this config describes (documents, no operations).
    pub fn workspace(&self) -> Result<Workspace, String> {
        let bg = Background::parse(&self.background).map_err(|e| e.to_string())?;
        let mut ws = Workspace::new(WrapMode::Clamp);
        for el in self.element_list() {
            ws.insert(&el.name, el.width, el.height, bg);
            if let Some(ns) = el.nine_slice
                && let Some(doc) = ws.documents.get_mut(&el.name)
            {
                doc.nine_slice = Some(ns);
            }
        }
        Ok(ws)
    }

    /// The preview/emitted PNG path for `element`.
    pub fn preview_for(&self, element: &str) -> PathBuf {
        PathBuf::from(preview_path(&self.preview, element))
    }
}

/// The config seeded next to a `material` run (read by both `texture` and `pbr`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialConfig {
    /// The square map resolution in pixels.
    pub size: u32,
    /// Whether authoring is seamless (brushes/gradients/filters wrap).
    #[serde(default = "default_true")]
    pub tile: bool,
    /// The emitted channels (`base-color` required; a subset of the rest).
    #[serde(default = "default_maps")]
    pub maps: Vec<String>,
    /// Preview clear color.
    #[serde(default = "default_background")]
    pub background: String,
    /// The shared interleaved operation-log path.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// The per-map preview PNG path template (`{map}`).
    #[serde(default = "default_material_preview")]
    pub preview: String,
    /// The asset seed.
    #[serde(default)]
    pub seed: u64,
    /// The live-preview endpoint, when observed.
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

/// The scratch channels always present in a material workspace on top of the
/// declared maps: a `height` authoring field and a `curvature` bake scratch.
pub const SCRATCH_MAPS: &[&str] = &["height", "curvature"];

impl MaterialConfig {
    /// Build the empty workspace: one document per declared map plus the scratch
    /// `height`/`curvature` fields, with toroidal addressing when tiling.
    pub fn workspace(&self) -> Result<Workspace, String> {
        let bg = Background::parse(&self.background).map_err(|e| e.to_string())?;
        let wrap = if self.tile {
            WrapMode::Wrap
        } else {
            WrapMode::Clamp
        };
        let mut ws = Workspace::new(wrap);
        ws.auto = Some((self.size, self.size, bg));
        for map in &self.maps {
            ws.insert(map, self.size, self.size, bg);
        }
        for scratch in SCRATCH_MAPS {
            if !self.maps.iter().any(|m| m == scratch) {
                ws.insert(*scratch, self.size, self.size, bg);
            }
        }
        Ok(ws)
    }

    /// The preview PNG path for `map`.
    pub fn preview_for(&self, map: &str) -> PathBuf {
        PathBuf::from(preview_path(&self.preview, map))
    }

    /// The sRGB/linear color space of a channel.
    pub fn color_space(map: &str) -> &'static str {
        match map {
            "base-color" | "emissive" => "srgb",
            _ => "linear",
        }
    }

    /// Whether a channel is emitted (scratch `height`/`curvature` are not).
    pub fn is_emitted(map: &str) -> bool {
        !SCRATCH_MAPS.contains(&map)
    }
}

/// Substitute the `{element}`/`{map}` token in a preview template.
pub fn preview_path(template: &str, target: &str) -> String {
    template
        .replace("{element}", target)
        .replace("{map}", target)
}

// ---- Output contracts ----------------------------------------------------------

/// One element's entry in `ui.json`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UiElementOut {
    /// The element name.
    pub name: String,
    /// Emitted width.
    pub width: u32,
    /// Emitted height.
    pub height: u32,
    /// The emitted PNG path.
    pub path: String,
    /// The nine-slice insets, when authored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nine_slice: Option<NineSlice>,
}

/// The `ui.json` a UI run emits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiJson {
    /// One entry per element.
    pub elements: Vec<UiElementOut>,
}

/// One channel's entry in `material.json`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MaterialMapOut {
    /// The channel name.
    pub name: String,
    /// The emitted PNG path.
    pub path: String,
    /// `srgb` or `linear`.
    pub color_space: &'static str,
}

/// The `material.json` a material run emits.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialJson {
    /// One entry per emitted channel.
    pub maps: Vec<MaterialMapOut>,
    /// Suggested world-space tile scale for triplanar application.
    pub tiling: f32,
    /// The maps' square resolution.
    pub size: u32,
}

fn default_size() -> u32 {
    512
}
fn default_background() -> String {
    "transparent".to_string()
}
fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}
fn default_ui_preview() -> String {
    "canvas.png".to_string()
}
fn default_material_preview() -> String {
    "maps/{map}.png".to_string()
}
fn default_true() -> bool {
    true
}
fn default_maps() -> Vec<String> {
    vec!["base-color".to_string()]
}
