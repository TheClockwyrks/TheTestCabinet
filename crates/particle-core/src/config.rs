//! The seeded run-config the particle binaries read.
//!
//! The orchestrator seeds a `particle-2d.config.json` / `particle-3d.config.json` next
//! to a run so the tool's operations and `render` need no field/duration flags: it
//! carries the `[particle]` field dimensions, the duration and playback fps, the loop
//! default, and the log / preview / `system.json` paths, plus an optional `live` block
//! present only when a viewer is watching. Reuses `model-core`'s [`LiveConfig`] and
//! [`read_config`] so the live-stream and config-read plumbing is shared across the
//! asset-generation families.

use std::path::PathBuf;

use serde::Deserialize;

use test_cabinet_model_core::color::PreviewBackground;
pub use test_cabinet_model_core::config::{LiveConfig, read_config};

use crate::system::{Dimensionality, Field};

/// The run configuration seeded next to a particle run.
#[derive(Debug, Clone, Deserialize)]
pub struct ParticleConfig {
    /// Field extent along `x`.
    pub width: u32,
    /// Field extent along `y` (up).
    pub height: u32,
    /// Field extent along `z`; absent (or ignored) for a 2D effect.
    #[serde(default)]
    pub depth: Option<u32>,
    /// The effect's length in milliseconds.
    pub duration_ms: u32,
    /// The preview/playback frame rate.
    pub fps: u32,
    /// The case's default loop flag (a `set-timeline` op overrides it).
    #[serde(default, rename = "loop")]
    pub looping: bool,
    /// Preview clear color: `transparent` or a hex color.
    #[serde(default = "default_background")]
    pub background: String,
    /// Run-workspace-relative path of the recorded action log.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// Run-workspace-relative path the preview GIF is written to.
    #[serde(default = "default_preview")]
    pub preview: PathBuf,
    /// Run-workspace-relative path the emitted `system.json` is written to.
    #[serde(default = "default_system")]
    pub system: PathBuf,
    /// The live-preview endpoint, when a viewer is observing this run. Absent for an
    /// unobserved run.
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl ParticleConfig {
    /// The field this effect plays in, framed to `dims` (a 2D effect drops `depth`).
    pub fn field(&self, dims: Dimensionality) -> Field {
        Field {
            width: self.width.max(1),
            height: self.height.max(1),
            depth: match dims {
                Dimensionality::D2 => None,
                Dimensionality::D3 => Some(self.depth.unwrap_or(self.width).max(1)),
            },
        }
    }

    /// The parsed preview background.
    pub fn background(&self) -> Result<PreviewBackground, String> {
        PreviewBackground::parse(&self.background)
            .map_err(|err| format!("invalid background: {err}"))
    }

    /// The playback frame rate, floored at 1.
    pub fn fps(&self) -> u32 {
        self.fps.max(1)
    }
}

fn default_background() -> String {
    "transparent".to_string()
}

fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}

fn default_preview() -> PathBuf {
    PathBuf::from("effect.gif")
}

fn default_system() -> PathBuf {
    PathBuf::from("system.json")
}
