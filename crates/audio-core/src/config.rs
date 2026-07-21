//! The seeded run-config the audio binaries read.
//!
//! The orchestrator seeds one of these next to a run (`sfx-synth.config.json`,
//! `sfx-sample.config.json`, or `music.config.json`) so an operation and `render` need
//! no format or path flags: the config fixes the clip's `sample_rate`, `channels`, and
//! `max_duration_ms`, the fixed synthesis `seed`, the op-log/preview/output paths, the
//! baked sample-pack or instrument-bank location, and an optional live-preview
//! endpoint. One shape serves all three binaries — the sample-pack/bank fields are
//! simply unset for the tools that do not use them.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::format::{Channels, RenderParams};

/// The fixed synthesis seed used when a config sets none, so a render is reproducible
/// out of the box.
pub const DEFAULT_SEED: u64 = 0x5EED_A0D1_0000_5EED;

/// The live-preview endpoint seeded next to a run a viewer is observing. Streaming is
/// best-effort: an operation never fails because the live view is unreachable, since
/// the recorded op log and the emitted `.wav` are the run's authoritative output.
#[derive(Debug, Clone, Deserialize)]
pub struct LiveConfig {
    /// The `host:port` the binary connects to (the run host, reachable from inside the
    /// run container as `host.docker.internal`).
    pub endpoint: String,
    /// An opaque per-run token echoed with each update.
    pub token: String,
}

/// The audio run-config.
#[derive(Debug, Clone, Deserialize)]
pub struct AudioConfig {
    /// Output sample rate in Hz.
    #[serde(default = "default_sample_rate")]
    pub sample_rate: u32,
    /// Output channel layout (`mono` or `stereo`).
    #[serde(default = "default_channels")]
    pub channels: Channels,
    /// Cap on the rendered clip's length in ms (defaults to
    /// `default_max_duration` when the config omits it).
    #[serde(default = "default_max_duration")]
    pub max_duration_ms: u32,
    /// The fixed synthesis seed (reproducible noise).
    #[serde(default = "default_seed")]
    pub seed: u64,
    /// Run-workspace-relative path of the recorded op log.
    #[serde(default = "default_actions")]
    pub actions: PathBuf,
    /// Run-workspace-relative path the preview PNG is written to.
    #[serde(default = "default_preview")]
    pub preview: PathBuf,
    /// Run-workspace-relative path the rendered clip `.wav` is written to.
    #[serde(default = "default_wav")]
    pub wav: PathBuf,
    /// Run-workspace-relative path the portable `.mid` is written to (`music` only).
    #[serde(default = "default_mid")]
    pub mid: PathBuf,
    /// The baked sample pack this run mixes over (`name@version`), for `sfx-sample`.
    #[serde(default)]
    pub sample_pack: Option<String>,
    /// The baked instrument bank this run plays (`name@version`), for `music`.
    #[serde(default)]
    pub instrument_bank: Option<String>,
    /// The directory the baked sample/instrument audio and its manifest live in. Absent
    /// when no pack is baked; the library then degrades to empty.
    #[serde(default)]
    pub pack_dir: Option<PathBuf>,
    /// The live-preview endpoint, when a viewer is observing this run.
    #[serde(default)]
    pub live: Option<LiveConfig>,
}

impl AudioConfig {
    /// The render parameters this config fixes.
    pub fn render_params(&self) -> RenderParams {
        RenderParams {
            sample_rate: self.sample_rate,
            channels: self.channels,
            max_duration_ms: self.max_duration_ms,
            seed: self.seed,
        }
    }

    /// The channel count (1 or 2), for the WAV encoder.
    pub fn channel_count(&self) -> u16 {
        self.channels.count() as u16
    }

    /// The directory the baked sample/instrument audio lives in, resolving the
    /// explicit [`Self::pack_dir`] first and otherwise falling back to the
    /// `TCAB_INSTRUMENT_BANK_DIR` / `TCAB_SAMPLE_PACK_DIR` environment variable the
    /// `music` / `sfx-sample` run-container images bake in.
    ///
    /// Core seeds only the pack/bank *name* (`sample_pack`/`instrument_bank`) into the
    /// config, not the on-disk directory, so without this fallback the baked pack would
    /// never load and the library would silently degrade to empty. A `music` run
    /// prefers the instrument-bank dir; an `sfx-sample` run the sample-pack dir.
    pub fn resolve_pack_dir(&self) -> Option<PathBuf> {
        if let Some(dir) = &self.pack_dir {
            return Some(dir.clone());
        }
        let env_key = if self.instrument_bank.is_some() {
            "TCAB_INSTRUMENT_BANK_DIR"
        } else if self.sample_pack.is_some() {
            "TCAB_SAMPLE_PACK_DIR"
        } else {
            return None;
        };
        std::env::var_os(env_key)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    }
}

fn default_sample_rate() -> u32 {
    44100
}
fn default_channels() -> Channels {
    Channels::Stereo
}
fn default_max_duration() -> u32 {
    5000
}
fn default_seed() -> u64 {
    DEFAULT_SEED
}
fn default_actions() -> PathBuf {
    PathBuf::from("actions.json")
}
fn default_preview() -> PathBuf {
    PathBuf::from("waveform.png")
}
fn default_wav() -> PathBuf {
    PathBuf::from("clip.wav")
}
fn default_mid() -> PathBuf {
    PathBuf::from("clip.mid")
}

/// Read a JSON config file into an [`AudioConfig`].
pub fn read_config(path: &Path) -> Result<AudioConfig, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("reading {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("invalid config {}: {err}", path.display()))
}

#[cfg(test)]
#[path = "config.test.rs"]
mod tests;
