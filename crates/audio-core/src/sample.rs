//! The baked sample-library / instrument-bank loader.
//!
//! `sfx-sample`'s sample pack and `music`'s instrument bank are baked into their
//! run-container image at build time. What this repo commits is a small TOML pack
//! manifest (`containers/sample-packs/<pack>.toml`) listing, per sample, a stable
//! `name`, `tags`, `duration`, and `description`; the pack tooling (a separate
//! change) fetches, verifies, normalizes, and lays the audio down next to it in the
//! image. This loader reads that manifest and the normalized audio at run time.
//!
//! The pack tooling is not yet built, so this loader **degrades gracefully**: an
//! absent pack directory or manifest yields an empty library, `list`/`info` return
//! nothing, and a placed sample renders silence — so a case (and this crate's tests)
//! runs without a baked pack present.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// A single library sample's metadata — the fields the model browses with
/// `list-samples` / `sample-info`, reasoning over names rather than auditioning audio.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SampleEntry {
    /// The stable name a case and the model address the sample by.
    pub name: String,
    /// Classification tags (e.g. `explosion`, `metal`, `impact`).
    #[serde(default)]
    pub tags: Vec<String>,
    /// The sample's length in milliseconds.
    #[serde(default)]
    pub duration_ms: f64,
    /// A human description of the sound.
    #[serde(default)]
    pub description: String,
    /// The audio file, relative to the pack directory. Optional in the committed
    /// manifest (the tooling fills it in the baked image); defaults to `<name>.wav`.
    #[serde(default)]
    pub file: Option<String>,
}

/// The manifest shape read from `<pack>.toml` (only the fields the loader needs).
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Deserialize)]
struct PackManifest {
    #[serde(default)]
    sample_rate: Option<u32>,
    #[serde(default, alias = "samples", alias = "instrument", alias = "instruments")]
    sample: Vec<SampleEntry>,
}

/// A loaded sample library / instrument bank: the browsable metadata plus the pack
/// directory the audio is read from lazily.
#[derive(Debug, Clone, Default)]
pub struct SampleLibrary {
    entries: Vec<SampleEntry>,
    pack_dir: Option<PathBuf>,
    sample_rate: u32,
}

impl SampleLibrary {
    /// An empty library — the graceful-degrade default when no pack is baked.
    pub fn empty() -> SampleLibrary {
        SampleLibrary {
            entries: Vec::new(),
            pack_dir: None,
            sample_rate: 44100,
        }
    }

    /// Build a library directly from entries (used by tests and non-CLI callers). The
    /// audio for each entry is loaded from `pack_dir/<file>` on demand.
    pub fn from_entries(entries: Vec<SampleEntry>, pack_dir: Option<PathBuf>, sample_rate: u32) -> SampleLibrary {
        SampleLibrary {
            entries,
            pack_dir,
            sample_rate,
        }
    }

    /// The pack's normalized sample rate.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// The whole library, or those carrying `tag` when one is given.
    pub fn list(&self, tag: Option<&str>) -> Vec<&SampleEntry> {
        self.entries
            .iter()
            .filter(|e| tag.is_none_or(|t| e.tags.iter().any(|et| et == t)))
            .collect()
    }

    /// One sample's metadata by name.
    pub fn info(&self, name: &str) -> Option<&SampleEntry> {
        self.entries.iter().find(|e| e.name == name)
    }

    /// Load one sample's mono audio (averaging channels for a stereo source),
    /// resampling nothing — the caller resamples to the render rate. Returns `None`
    /// if the sample or its audio file is missing.
    pub fn samples(&self, name: &str) -> Option<Vec<f32>> {
        let entry = self.info(name)?;
        let dir = self.pack_dir.as_ref()?;
        let file = entry.file.clone().unwrap_or_else(|| format!("{name}.wav"));
        let path = dir.join(file);
        let bytes = std::fs::read(&path).ok()?;
        let decoded = crate::wav::decode_pcm16(&bytes).ok()?;
        // The returned mono is at the pack's own sample rate; the caller resamples to
        // the render rate (see `SamplePlacement::render`).
        Some(to_mono(&decoded.samples, decoded.channels))
    }
}

/// Average interleaved samples down to mono.
fn to_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
    let ch = channels.max(1) as usize;
    if ch == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Load a pack manifest and its audio directory. `pack_dir` is the baked pack
/// directory; `manifest` names the manifest file within it (defaults to the first
/// `*.toml`). Any I/O or parse error degrades to an empty library rather than
/// failing the render.
#[cfg(feature = "cli")]
pub fn load_pack(pack_dir: Option<&std::path::Path>) -> SampleLibrary {
    let Some(dir) = pack_dir else {
        return SampleLibrary::empty();
    };
    if !dir.is_dir() {
        return SampleLibrary::empty();
    }
    // Find a manifest: the first `*.toml` in the pack directory.
    let manifest_path = std::fs::read_dir(dir)
        .ok()
        .and_then(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .find(|p| p.extension().is_some_and(|x| x == "toml"))
        });
    let Some(manifest_path) = manifest_path else {
        return SampleLibrary::empty();
    };
    let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
        return SampleLibrary::empty();
    };
    match toml::from_str::<PackManifest>(&raw) {
        Ok(manifest) => SampleLibrary::from_entries(
            manifest.sample,
            Some(dir.to_path_buf()),
            manifest.sample_rate.unwrap_or(44100),
        ),
        Err(_) => SampleLibrary::empty(),
    }
}

#[cfg(test)]
#[path = "sample.test.rs"]
mod tests;
