//! The staged audio palette a run container is given, and the rule that selects one
//! pack out of it.
//!
//! A test case declares the packs its runs may reach, and core stages those packs into
//! the run container when the container starts, recording what it wrote in a
//! `packs.json` beside them. This module is the single definition of that tree: its
//! root, its file names, its contract version, the manifest's shape, and the selection
//! rule the audio binaries resolve a pack through. The writer (`crates/core`) and the
//! reader (`sfx-sample` and `music`) share it, so the two cannot disagree about what a
//! run was given.
//!
//! See `apps/docs/src/content/docs/components/core/execution.md`.

use std::collections::BTreeMap;
#[cfg(feature = "cli")]
use std::path::Path;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// The staged-audio root inside a run container.
pub const AUDIO_ROOT: &str = "/opt/audio";

/// The environment variable pointing the audio binaries at an audio root elsewhere,
/// for a host-side tool run over a fetched audio store. A run container leaves it
/// unset and reads [`AUDIO_ROOT`].
pub const AUDIO_ROOT_ENV: &str = "TCAB_AUDIO_DIR";

/// The run's palette manifest, at `<root>/packs.json`.
pub const PACKS_MANIFEST: &str = "packs.json";

/// The marker a run image bakes to state which staging contract it accepts, at
/// `<root>/.tcab-audio-contract`. Its content is the [`CONTRACT_VERSION`] it accepts.
pub const CONTRACT_MARKER: &str = ".tcab-audio-contract";

/// The staged-audio contract this build reads and writes.
pub const CONTRACT_VERSION: u32 = 1;

/// The root-relative directory the staged pack manifests sit under, one
/// `<name>@<version>/pack.toml` each.
pub const PACKS_DIR: &str = "packs";

/// The root-relative directory the staged clip files sit in, shared by every staged
/// pack so a clip two packs name is staged once.
pub const CLIPS_DIR: &str = "clips";

/// Which palette a tool reads: `sfx-sample` mixes over a sample pack and `music`
/// sequences over an instrument bank. One config shape and one staged tree serve both
/// binaries, so the binary states which of the two applies to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
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

    /// The identifier a pack manifest and `packs.json` name this kind by.
    pub fn id(self) -> &'static str {
        match self {
            PackKind::SamplePack => "sample-pack",
            PackKind::InstrumentBank => "instrument-bank",
        }
    }

    /// What a tool reports when the run holds no palette of this kind. A run carries
    /// the packs its test case declares, so an absent palette is a case that declares
    /// none rather than a lookup that failed.
    pub fn none_staged(self) -> String {
        format!(
            "this run was staged with no {}: its test case declares none in \
             `[audio] packs`",
            self.label()
        )
    }
}

/// One pack a run was staged with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedPack {
    /// The pack's name, as its own manifest declares it.
    pub name: String,
    /// The pack's version, as its own manifest declares it.
    pub version: String,
    /// Which binary's palette this pack is.
    pub kind: PackKind,
    /// Root-relative directory holding this pack's `pack.toml`.
    pub dir: String,
}

impl StagedPack {
    /// The `name@version` ref this pack answers to.
    pub fn reference(&self) -> String {
        format!("{}@{}", self.name, self.version)
    }
}

/// The palette a run was staged with, written to `<root>/packs.json` at container
/// start.
///
/// `packs` is in the declaring case's order, and `defaults` names the pack each kind
/// resolves to for a tool config that names none. Core resolves that default on the
/// host and records it here, so the rule lives in one place and a run's palette is
/// readable as data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedPacks {
    /// The staging contract this manifest was written against.
    pub contract: u32,
    /// The pack each kind resolves to when a tool config names none, keyed by kind and
    /// holding a `name@version` ref one of `packs` answers to. A kind no staged pack
    /// covers is absent.
    #[serde(default)]
    pub defaults: BTreeMap<PackKind, String>,
    /// Every pack this run was staged with, in the order its case declares them.
    pub packs: Vec<StagedPack>,
}

impl StagedPacks {
    /// The audio root the binaries read: [`AUDIO_ROOT_ENV`] when it is set and
    /// non-empty, otherwise [`AUDIO_ROOT`].
    pub fn root() -> PathBuf {
        std::env::var_os(AUDIO_ROOT_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(AUDIO_ROOT))
    }

    /// The pack of `kind` this run reads for `requested`, the ref the tool config
    /// names, or the kind's staged default when the config names none.
    ///
    /// `Ok(None)` means the run asked for nothing and was staged with no pack of that
    /// kind, which is an empty library rather than a failure. Every other outcome is
    /// checked: a ref naming a pack the run was not staged with, one naming a pack of
    /// the other kind, and one pinning a version other than the staged pack's are all
    /// errors naming the palette the run does hold, because serving a different pack
    /// would render the run against samples its case was never reviewed against.
    pub fn select(
        &self,
        kind: PackKind,
        requested: Option<&str>,
    ) -> Result<Option<&StagedPack>, String> {
        let Some(reference) = requested else {
            let Some(default) = self.defaults.get(&kind) else {
                return Ok(None);
            };
            return self
                .find(kind, pack_name(default))
                .ok_or_else(|| {
                    format!(
                        "{}: this run's default is `{default}`, but {}",
                        kind.label(),
                        self.staged_with()
                    )
                })
                .map(Some);
        };

        let name = pack_name(reference);
        if name.is_empty() {
            return Err(format!("`{reference}` names no pack"));
        }
        let Some(pack) = self.packs.iter().find(|pack| pack.name == name) else {
            return Err(format!(
                "{} `{reference}`: {}",
                kind.label(),
                self.staged_with()
            ));
        };
        if pack.kind != kind {
            return Err(format!(
                "{} `{reference}`: that pack is a {}",
                kind.label(),
                pack.kind.id()
            ));
        }
        if let Some(version) = pack_version(reference)
            && version != pack.version
        {
            return Err(format!(
                "{} `{reference}`: this run was staged with {}",
                kind.label(),
                pack.reference()
            ));
        }
        Ok(Some(pack))
    }

    /// The staged pack of `kind` named `name`.
    fn find(&self, kind: PackKind, name: &str) -> Option<&StagedPack> {
        self.packs
            .iter()
            .find(|pack| pack.kind == kind && pack.name == name)
    }

    /// The "this run was staged with …" clause every selection failure ends in, so a
    /// diagnostic names the palette the run actually holds.
    fn staged_with(&self) -> String {
        if self.packs.is_empty() {
            return "this run was staged with no audio packs".to_string();
        }
        let refs: Vec<String> = self.packs.iter().map(StagedPack::reference).collect();
        format!("this run was staged with {}", refs.join(", "))
    }

    /// Read the palette staged at `root`.
    ///
    /// `Ok(None)` means the root holds no manifest, which for a run container means
    /// the run was staged with no audio at all. A host-side tool run pointed at a
    /// fetched audio store with [`AUDIO_ROOT_ENV`] gets a manifest synthesized from
    /// the packs that store carries, with the first pack of each kind that kind's
    /// default.
    #[cfg(feature = "cli")]
    pub fn load(root: &Path) -> Result<Option<Self>, String> {
        let path = root.join(PACKS_MANIFEST);
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Self::enumerate(root);
            }
            Err(err) => return Err(format!("reading {}: {err}", path.display())),
        };
        let manifest: StagedPacks = serde_json::from_str(&raw)
            .map_err(|err| format!("invalid staged audio manifest {}: {err}", path.display()))?;
        if manifest.contract != CONTRACT_VERSION {
            return Err(format!(
                "{} states staging contract {}, and this build reads contract \
                 {CONTRACT_VERSION}",
                path.display(),
                manifest.contract
            ));
        }
        Ok(Some(manifest))
    }

    /// Synthesize a manifest from the packs an audio store carries, for a host-side
    /// tool run pointed at one with [`AUDIO_ROOT_ENV`]. A run container leaves that
    /// variable unset, so a run's palette is always the staged manifest alone.
    #[cfg(feature = "cli")]
    fn enumerate(root: &Path) -> Result<Option<Self>, String> {
        if std::env::var_os(AUDIO_ROOT_ENV)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            return Ok(None);
        }
        let dir = root.join(PACKS_DIR);
        let Ok(read) = std::fs::read_dir(&dir) else {
            return Ok(None);
        };
        let mut names: Vec<String> = read
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().join("pack.toml").is_file())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();

        let mut packs = Vec::new();
        let mut defaults = BTreeMap::new();
        for name in names {
            let pack = read_identity(&dir.join(&name), format!("{PACKS_DIR}/{name}"))?;
            defaults
                .entry(pack.kind)
                .or_insert_with(|| pack.reference());
            packs.push(pack);
        }
        Ok(Some(StagedPacks {
            contract: CONTRACT_VERSION,
            defaults,
            packs,
        }))
    }
}

/// The identity a store's `pack.toml` declares, for the synthesized manifest.
#[cfg(feature = "cli")]
#[derive(Deserialize)]
struct PackIdentity {
    name: Option<String>,
    version: Option<String>,
    kind: Option<PackKind>,
}

/// Read one store pack's `name`, `version`, and `kind` out of its manifest.
#[cfg(feature = "cli")]
fn read_identity(dir: &Path, relative: String) -> Result<StagedPack, String> {
    let path = dir.join("pack.toml");
    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("reading {}: {err}", path.display()))?;
    let identity: PackIdentity = toml::from_str(&raw)
        .map_err(|err| format!("invalid pack manifest {}: {err}", path.display()))?;
    let (Some(name), Some(version), Some(kind)) = (identity.name, identity.version, identity.kind)
    else {
        return Err(format!(
            "the pack manifest {} declares no `name`, `version`, or `kind`, so the \
             pack it holds cannot be addressed by ref",
            path.display()
        ));
    };
    Ok(StagedPack {
        name,
        version,
        kind,
        dir: relative,
    })
}

/// The root-relative directory a pack's manifest is staged at, which is what a
/// [`StagedPack::dir`] holds.
pub fn pack_dir(name: &str, version: &str) -> String {
    format!("{PACKS_DIR}/{name}@{version}")
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
        .filter(|version| !version.is_empty())
}

#[cfg(test)]
#[path = "staged.test.rs"]
mod tests;
