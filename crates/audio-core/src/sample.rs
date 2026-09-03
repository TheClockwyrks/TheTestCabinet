//! The sample-library / instrument-bank loader.
//!
//! `sfx-sample`'s sample pack and `music`'s instrument bank are
//! [staged into their run container](crate::staged) as a directory holding a
//! `pack.toml` manifest plus the normalized audio the manifest's entries name. Each entry carries the stable
//! `name`, `tags`, `duration`, and `description` the model browses, and a `file`
//! path resolved relative to the pack directory, so several packs can share one
//! clip directory (`file = "../../clips/<clip-id>.<profile-id>.wav"`).
//!
//! Loading is strict. [`load_pack`] reports the exact failure and the path it
//! involves as a [`PackError`], and it verifies every declared entry's audio file
//! exists, decodes, and matches the sample rate and duration the manifest declares
//! for it, so a broken pack fails at load with a diagnosis rather than rendering
//! silence or the wrong length. The manifest's own `name` and `version` travel with
//! the loaded library, so a run can check the palette it got against the
//! `name@version` its config pins.

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
    /// The audio file, relative to the pack directory. A staged pack points this at
    /// the shared clip directory (`../../clips/<clip-id>.<profile-id>.wav`) so packs
    /// sharing a clip share its bytes; when the manifest omits it the loader reads
    /// `<name>.wav` from the pack directory itself.
    #[serde(default)]
    pub file: Option<String>,
    /// For an **instrument-bank** entry: the MIDI note the sample was recorded at, so
    /// the `music` sequencer can pitch-shift it across a track's notes (a note `key`
    /// plays the sample at `2^((key - root_note)/12)` speed). Defaults to 60 (C4),
    /// the bank's reference pitch. Irrelevant to `sfx-sample` entries and to
    /// unpitched instruments (see `pitched`).
    #[serde(default = "default_root_note")]
    pub root_note: u8,
    /// For an **instrument-bank** entry: whether the instrument is pitched (melodic —
    /// transposed per note relative to `root_note`) or unpitched (percussion — always
    /// played at its native pitch, ignoring the note). Defaults to `true`.
    #[serde(default = "default_pitched")]
    pub pitched: bool,
}

impl SampleEntry {
    /// The manifest-declared audio file, defaulting to `<name>.wav` when the entry
    /// omits one. Always resolved against the pack directory.
    pub fn file_name(&self) -> String {
        self.file
            .clone()
            .unwrap_or_else(|| format!("{}.wav", self.name))
    }
}

/// The default reference pitch for a melodic instrument sample: MIDI 60 (C4).
fn default_root_note() -> u8 {
    60
}

/// Instruments are pitched (melodic) unless a manifest marks them otherwise.
fn default_pitched() -> bool {
    true
}

/// The manifest shape read from `<pack>.toml` (only the fields the loader needs).
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Deserialize)]
struct PackManifest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    sample_rate: Option<u32>,
    #[serde(
        default,
        alias = "samples",
        alias = "entry",
        alias = "entries",
        alias = "instrument",
        alias = "instruments"
    )]
    sample: Vec<SampleEntry>,
}

/// Why a pack failed to load. Each variant names the path it involves so the message
/// points at the pack that has to be fixed.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq)]
pub enum PackError {
    /// The pack directory does not exist.
    MissingDir(PathBuf),
    /// The pack path exists but is not a directory.
    NotADirectory(PathBuf),
    /// The pack directory could not be listed.
    UnreadableDir(PathBuf, String),
    /// The pack directory holds no `*.toml` manifest.
    NoManifest(PathBuf),
    /// The manifest file could not be read.
    UnreadableManifest(PathBuf, String),
    /// The manifest is not a valid pack manifest.
    InvalidManifest(PathBuf, String),
    /// A declared entry's audio file is absent.
    MissingAudio {
        /// The entry's `name`.
        entry: String,
        /// The resolved path the entry's `file` pointed at.
        path: PathBuf,
    },
    /// A declared entry's audio file could not be read.
    UnreadableAudio {
        /// The entry's `name`.
        entry: String,
        /// The resolved path the entry's `file` pointed at.
        path: PathBuf,
        /// The underlying I/O error.
        error: String,
    },
    /// A declared entry's audio file is not a decodable PCM WAV.
    UndecodableAudio {
        /// The entry's `name`.
        entry: String,
        /// The resolved path the entry's `file` pointed at.
        path: PathBuf,
        /// The decoder's complaint.
        error: String,
    },
    /// A declared entry's audio decodes at a different rate than the manifest's
    /// `sample_rate`, which every consumer resamples from.
    SampleRateMismatch {
        /// The entry's `name`.
        entry: String,
        /// The resolved path the entry's `file` pointed at.
        path: PathBuf,
        /// The rate the manifest declares.
        declared: u32,
        /// The rate the audio actually carries.
        actual: u32,
    },
    /// A declared entry's audio is a different length than the entry's `duration_ms`,
    /// which is the length the model browses and plans against.
    DurationMismatch {
        /// The entry's `name`.
        entry: String,
        /// The resolved path the entry's `file` pointed at.
        path: PathBuf,
        /// The length in milliseconds the manifest declares.
        declared: f64,
        /// The length in milliseconds the audio actually runs for.
        actual: f64,
    },
}

#[cfg(feature = "cli")]
impl std::fmt::Display for PackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackError::MissingDir(path) => {
                write!(f, "pack directory {} does not exist", path.display())
            }
            PackError::NotADirectory(path) => {
                write!(f, "pack path {} is not a directory", path.display())
            }
            PackError::UnreadableDir(path, error) => {
                write!(f, "reading pack directory {}: {error}", path.display())
            }
            PackError::NoManifest(path) => write!(
                f,
                "pack directory {} holds no `*.toml` manifest",
                path.display()
            ),
            PackError::UnreadableManifest(path, error) => {
                write!(f, "reading pack manifest {}: {error}", path.display())
            }
            PackError::InvalidManifest(path, error) => {
                write!(f, "invalid pack manifest {}: {error}", path.display())
            }
            PackError::MissingAudio { entry, path } => write!(
                f,
                "entry `{entry}` names audio {} which does not exist",
                path.display()
            ),
            PackError::UnreadableAudio { entry, path, error } => write!(
                f,
                "entry `{entry}`: reading audio {}: {error}",
                path.display()
            ),
            PackError::UndecodableAudio { entry, path, error } => write!(
                f,
                "entry `{entry}`: audio {} does not decode: {error}",
                path.display()
            ),
            PackError::SampleRateMismatch {
                entry,
                path,
                declared,
                actual,
            } => write!(
                f,
                "entry `{entry}`: audio {} is {actual} Hz, but the manifest declares {declared} Hz",
                path.display()
            ),
            PackError::DurationMismatch {
                entry,
                path,
                declared,
                actual,
            } => write!(
                f,
                "entry `{entry}`: audio {} runs {actual:.1}ms, but the manifest declares {declared:.1}ms",
                path.display()
            ),
        }
    }
}

#[cfg(feature = "cli")]
impl std::error::Error for PackError {}

/// A loaded sample library / instrument bank: the browsable metadata plus the pack
/// directory the audio is read from lazily.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SampleLibrary {
    entries: Vec<SampleEntry>,
    pack_dir: Option<PathBuf>,
    sample_rate: u32,
    name: Option<String>,
    version: Option<String>,
}

impl SampleLibrary {
    /// An empty library, for a run that configures no pack at all (`sfx-synth`).
    pub fn empty() -> SampleLibrary {
        SampleLibrary {
            entries: Vec::new(),
            pack_dir: None,
            sample_rate: 44100,
            name: None,
            version: None,
        }
    }

    /// Build a library directly from entries (used by tests and non-CLI callers). The
    /// audio for each entry is loaded from `pack_dir/<file>` on demand.
    pub fn from_entries(
        entries: Vec<SampleEntry>,
        pack_dir: Option<PathBuf>,
        sample_rate: u32,
    ) -> SampleLibrary {
        SampleLibrary {
            entries,
            pack_dir,
            sample_rate,
            name: None,
            version: None,
        }
    }

    /// Record the pack identity its manifest declares, which a run checks against the
    /// `name@version` its config pins.
    pub fn with_identity(mut self, name: Option<String>, version: Option<String>) -> SampleLibrary {
        self.name = name;
        self.version = version;
        self
    }

    /// The pack name the loaded manifest declares.
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    /// The pack version the loaded manifest declares.
    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }

    /// The `name@version` ref this library answers to. Absent when the loaded manifest
    /// declares no `name`.
    pub fn reference(&self) -> Option<String> {
        let name = self.name.as_deref()?;
        Some(match self.version.as_deref() {
            Some(version) => format!("{name}@{version}"),
            None => name.to_string(),
        })
    }

    /// How a diagnostic names the pack a model is browsing, as
    /// ``this run's sample pack `combat-core@0.1.0` ``. The ref is dropped when the
    /// loaded manifest declares no identity of its own.
    pub fn describe(&self, kind: crate::staged::PackKind) -> String {
        match self.reference() {
            Some(reference) => format!("this run's {} `{reference}`", kind.label()),
            None => format!("this run's {}", kind.label()),
        }
    }

    /// The pack's normalized sample rate.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Whether the library declares no samples at all.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
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

    /// The path an entry's audio is read from, or `None` when the library holds no
    /// such entry or has no pack directory.
    pub fn audio_path(&self, name: &str) -> Option<PathBuf> {
        let entry = self.info(name)?;
        Some(self.pack_dir.as_ref()?.join(entry.file_name()))
    }

    /// Load one sample's mono audio (averaging channels for a stereo source),
    /// resampling nothing — the caller resamples to the render rate. Returns `None`
    /// if the sample or its audio file is missing.
    pub fn samples(&self, name: &str) -> Option<Vec<f32>> {
        let path = self.audio_path(name)?;
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

/// The slack allowed between an entry's declared `duration_ms` and the length its
/// audio actually decodes to. The publisher writes the declared value from the same
/// encoded bytes, rounding to whole milliseconds, so anything beyond a couple of
/// milliseconds is a manifest that no longer describes its audio rather than rounding.
#[cfg(feature = "cli")]
const DURATION_TOLERANCE_MS: f64 = 2.0;

/// The length in milliseconds of decoded PCM audio.
#[cfg(feature = "cli")]
fn decoded_duration_ms(decoded: &crate::wav::DecodedWav) -> f64 {
    let channels = decoded.channels.max(1) as usize;
    let rate = decoded.sample_rate.max(1) as f64;
    (decoded.samples.len() / channels) as f64 / rate * 1000.0
}

/// Load the pack staged at `pack_dir`: its manifest (`pack.toml`, or the
/// lexicographically first `*.toml` when a pack names it otherwise) and the audio
/// every declared entry points at.
///
/// Each entry's `file` resolves against `pack_dir`, so a shared-clip layout
/// (`file = "../../clips/<clip-id>.<profile-id>.wav"`) reads from the clip directory
/// the packs sit beside. Every declared file must exist, decode, and agree with what
/// the manifest says about it: the decoded rate must equal the manifest's
/// `sample_rate`, which every consumer resamples from, and the decoded length must be
/// the entry's `duration_ms` to within two milliseconds, which is the length
/// the model browses and plans against. An entry declaring no `duration_ms`, and a
/// manifest declaring no `sample_rate`, state nothing to check. The first file that
/// fails is returned as a [`PackError`] naming the entry, the resolved path and both
/// values.
#[cfg(feature = "cli")]
pub fn load_pack(pack_dir: &std::path::Path) -> Result<SampleLibrary, PackError> {
    if !pack_dir.exists() {
        return Err(PackError::MissingDir(pack_dir.to_path_buf()));
    }
    if !pack_dir.is_dir() {
        return Err(PackError::NotADirectory(pack_dir.to_path_buf()));
    }
    let manifest_path = find_manifest(pack_dir)?;
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|err| PackError::UnreadableManifest(manifest_path.clone(), err.to_string()))?;
    let manifest: PackManifest = toml::from_str(&raw)
        .map_err(|err| PackError::InvalidManifest(manifest_path.clone(), err.to_string()))?;

    for entry in &manifest.sample {
        let path = pack_dir.join(entry.file_name());
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(PackError::MissingAudio {
                    entry: entry.name.clone(),
                    path,
                });
            }
            Err(err) => {
                return Err(PackError::UnreadableAudio {
                    entry: entry.name.clone(),
                    path,
                    error: err.to_string(),
                });
            }
        };
        let decoded =
            crate::wav::decode_pcm16(&bytes).map_err(|error| PackError::UndecodableAudio {
                entry: entry.name.clone(),
                path: path.clone(),
                error,
            })?;

        if let Some(declared) = manifest.sample_rate
            && decoded.sample_rate != declared
        {
            return Err(PackError::SampleRateMismatch {
                entry: entry.name.clone(),
                path,
                declared,
                actual: decoded.sample_rate,
            });
        }

        if entry.duration_ms > 0.0 {
            let actual = decoded_duration_ms(&decoded);
            if (actual - entry.duration_ms).abs() > DURATION_TOLERANCE_MS {
                return Err(PackError::DurationMismatch {
                    entry: entry.name.clone(),
                    path,
                    declared: entry.duration_ms,
                    actual,
                });
            }
        }
    }

    Ok(SampleLibrary::from_entries(
        manifest.sample,
        Some(pack_dir.to_path_buf()),
        manifest.sample_rate.unwrap_or(44100),
    )
    .with_identity(manifest.name, manifest.version))
}

/// The manifest within a pack directory: `pack.toml` when present, otherwise the
/// lexicographically first `*.toml` so the choice does not depend on directory order.
#[cfg(feature = "cli")]
fn find_manifest(pack_dir: &std::path::Path) -> Result<PathBuf, PackError> {
    let named = pack_dir.join("pack.toml");
    if named.is_file() {
        return Ok(named);
    }
    let read = std::fs::read_dir(pack_dir)
        .map_err(|err| PackError::UnreadableDir(pack_dir.to_path_buf(), err.to_string()))?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in read {
        let entry = entry
            .map_err(|err| PackError::UnreadableDir(pack_dir.to_path_buf(), err.to_string()))?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|x| x == "toml") {
            candidates.push(path);
        }
    }
    candidates.sort();
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| PackError::NoManifest(pack_dir.to_path_buf()))
}

#[cfg(test)]
#[path = "sample.test.rs"]
mod tests;
