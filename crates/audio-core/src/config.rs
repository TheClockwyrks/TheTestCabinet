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
    /// The directory the baked sample/instrument audio and its manifest live in,
    /// overriding the image's baked location. Absent for a run that configures no
    /// pack and for one that resolves the pack directory from the image.
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

    /// The palette ref this run reads for `kind`: the config's own `sample_pack` /
    /// `instrument_bank`, or the image's default palette
    /// (`TCAB_SAMPLE_PACK` / `TCAB_INSTRUMENT_BANK`) when the config names none.
    ///
    /// Core seeds the ref into an asset-generation run's config. A full-stack run
    /// authors its own config and names no palette, so the image's default is what
    /// gives those runs the library the image bakes.
    pub fn pack_ref(&self, kind: PackKind) -> Option<String> {
        let configured = match kind {
            PackKind::SamplePack => &self.sample_pack,
            PackKind::InstrumentBank => &self.instrument_bank,
        };
        if let Some(name) = configured.as_ref().filter(|n| !n.is_empty()) {
            return Some(name.clone());
        }
        std::env::var(kind.default_env())
            .ok()
            .filter(|v| !v.is_empty())
    }

    /// The directory the baked audio for `kind` lives in, resolving the explicit
    /// [`Self::pack_dir`] first and otherwise selecting the palette
    /// [`Self::pack_ref`] names under the root the run-container image bakes in
    /// (`TCAB_SAMPLE_PACK_DIR` / `TCAB_INSTRUMENT_BANK_DIR`).
    ///
    /// An image bakes each palette as a per-name subdirectory of that root
    /// (`<root>/gm-lite/`, `<root>/cinematic/`, …), so the ref selects which one this
    /// run reads. Returns `Ok(None)` when the run resolves no palette at all, and an
    /// error when a ref names a palette the image does not bake.
    pub fn resolve_pack_dir(&self, kind: PackKind) -> Result<Option<PathBuf>, String> {
        if let Some(dir) = &self.pack_dir {
            return Ok(Some(dir.clone()));
        }
        let Some(name) = self.pack_ref(kind) else {
            return Ok(None);
        };
        let root = std::env::var_os(kind.dir_env())
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| {
                format!(
                    "no pack directory resolved: set `pack_dir` in the run config, or \
                     {} in the run container",
                    kind.dir_env()
                )
            })?;
        select_pack_dir(root, &name).map(Some)
    }
}

/// Which baked palette a tool reads: `sfx-sample` mixes over a sample pack and
/// `music` sequences over an instrument bank. One config shape serves both binaries,
/// so the binary states which of the two fields and which pair of environment
/// variables apply to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackKind {
    /// `sfx-sample`'s sample pack.
    SamplePack,
    /// `music`'s instrument bank.
    InstrumentBank,
}

impl PackKind {
    /// How this palette is named in a diagnostic.
    pub fn label(self) -> &'static str {
        match self {
            PackKind::SamplePack => "sample pack",
            PackKind::InstrumentBank => "instrument bank",
        }
    }

    /// The environment variable carrying the root the image's palettes are baked
    /// under, one per-name subdirectory each.
    pub fn dir_env(self) -> &'static str {
        match self {
            PackKind::SamplePack => "TCAB_SAMPLE_PACK_DIR",
            PackKind::InstrumentBank => "TCAB_INSTRUMENT_BANK_DIR",
        }
    }

    /// The environment variable naming the palette a run gets when its config names
    /// none.
    pub fn default_env(self) -> &'static str {
        match self {
            PackKind::SamplePack => "TCAB_SAMPLE_PACK",
            PackKind::InstrumentBank => "TCAB_INSTRUMENT_BANK",
        }
    }
}

/// Resolve the concrete pack directory within a baked palette `root`.
///
/// A run-container image bakes each palette as a per-name subdirectory
/// (`<root>/<name>/`), so a requested pack/bank `name` (`name@version`, so the part
/// before `@`) selects the subdirectory carrying the loader's `pack.toml`.
///
/// A name with no such subdirectory is an error naming the palettes the root does
/// carry: serving an unrelated palette in its place would render the run against the
/// wrong samples.
fn select_pack_dir(root: PathBuf, name: &str) -> Result<PathBuf, String> {
    let bank = pack_name(name);
    if bank.is_empty() {
        return Err(format!("`{name}` names no pack"));
    }
    let sub = root.join(bank);
    if sub.join("pack.toml").is_file() {
        return Ok(sub);
    }
    Err(format!(
        "no pack `{bank}` baked under {}{}",
        root.display(),
        available_palettes(&root)
    ))
}

/// The name half of a `name@version` palette ref (the whole ref when it pins no
/// version).
pub fn pack_name(reference: &str) -> &str {
    reference.split('@').next().unwrap_or(reference)
}

/// The version half of a `name@version` palette ref, absent when the ref pins none.
pub fn pack_version(reference: &str) -> Option<&str> {
    reference
        .split_once('@')
        .map(|(_, version)| version)
        .filter(|v| !v.is_empty())
}

/// A trailing " (available: a, b)" clause naming the palettes baked under `root`, so
/// a mis-named bank reports what the image actually carries. Empty when the root
/// lists nothing usable.
fn available_palettes(root: &Path) -> String {
    let Ok(read) = std::fs::read_dir(root) else {
        return String::new();
    };
    let mut names: Vec<String> = read
        .filter_map(|e| e.ok())
        .filter(|e| e.path().join("pack.toml").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    if names.is_empty() {
        return String::new();
    }
    names.sort();
    format!(" (available: {})", names.join(", "))
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
