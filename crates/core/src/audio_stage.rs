//! Staging a run's declared audio packs into its container.
//!
//! A test case names the audio packs its runs may reach in
//! [`[audio] packs`](crate::test_case::TestCaseVersion::audio_packs), and this module
//! turns that list into the tree the run container is given: the pack manifests those
//! refs resolve to, the clip files they name, and a `packs.json` recording what the
//! run was staged with. The container holds those packs and no others, so the palette
//! a run's audio binaries can reach is exactly what its case declares — not whatever
//! the image it happens to resolve was built with.
//!
//! # Where the bytes come from
//!
//! From the **host audio store**, located by [`audio_store_dir`](crate::seeding), a
//! tree of every published pack at every published version:
//!
//! ```text
//! <store>/objects.lock.json                 every published object, by digest and size
//! <store>/clips/<clip-id>.<profile-id>.wav  shared across packs, written once
//! <store>/packs/<name>@<version>/pack.toml  file = "../../clips/<clip-id>.<profile-id>.wav"
//! ```
//!
//! The driver image carries the store; a local checkout fetches it with
//! `scripts/fetch-audio-store.sh`. The staged tree uses the **same layout**, so each
//! manifest's relative `file` resolves identically in the store and in the container
//! and `load_pack` needs to know nothing about staging.
//!
//! # Every byte is checked against the lock before it is used
//!
//! `objects.lock.json` is the publisher's record of which objects exist and what they
//! hash to. Staging resolves each clip a declared pack names to its lock entry
//! (`normalized/<clip-id>/<profile-id>.wav`) and verifies the store's bytes against
//! the recorded sha256 and byte length before they are copied in. A clip the lock does
//! not record, or one whose bytes disagree with it, fails the run before the container
//! starts — a run is never rendered against audio nobody published.
//!
//! # Nothing lands in the model's workspace
//!
//! Every staged path is under [`AUDIO_ROOT`](test_cabinet_audio_core::staged::AUDIO_ROOT),
//! which is outside the seeded repository.
//! The raw clips are therefore absent from the model's working tree, its git history,
//! and the tree collected as the run's result, so the only audio a published run ships
//! is audio the model produced.
//!
//! See `apps/docs/src/content/docs/components/core/execution.md`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Deserialize;
use sha2::Digest;
use test_cabinet_audio_core::staged::{
    self, CLIPS_DIR, CONTRACT_VERSION, PACKS_MANIFEST, PackKind, StagedPack, StagedPacks,
};

use crate::error::{Error, Result};
use crate::execution::ContainerFile;
use crate::test_case::AssetKind;

/// The mode every staged file is given: readable by the run user, writable by nobody
/// else. The tree carries no secret — it is published audio — so it needs none of the
/// tightening a credential file does.
const STAGED_MODE: u32 = 0o644;

/// The store's copy of the published-object lock, naming every object that exists and
/// what it hashes to. Staged beside `clips/` and `packs/` so a store is verifiable
/// wherever it was fetched from.
pub const OBJECTS_LOCK: &str = "objects.lock.json";

/// The audio palette staged for one run: the tree to materialize in its container and
/// the manifest that tree's `packs.json` records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedAudio {
    /// What the run was staged with, as written to `<root>/packs.json`. Held so the
    /// caller can report the palette without re-reading it.
    pub manifest: StagedPacks,
    /// The files to materialize in the container, each at an absolute path under
    /// [`staged::AUDIO_ROOT`] and none of them under the run's workspace.
    pub files: Vec<ContainerFile>,
}

/// One pack's manifest as staging reads it: the identity to check against the ref that
/// asked for it, and the clip files to carry in with it. Every other key is the
/// loader's business and is copied through byte for byte.
#[derive(Debug, Deserialize)]
struct PackManifest {
    /// The pack's own name.
    name: Option<String>,
    /// The pack's own version.
    version: Option<String>,
    /// Which binary's palette this pack is.
    kind: Option<PackKind>,
    /// The pack's entries, under every alias the loader accepts, so staging reads the
    /// same entries `load_pack` will.
    #[serde(
        default,
        alias = "samples",
        alias = "entry",
        alias = "entries",
        alias = "instrument",
        alias = "instruments"
    )]
    sample: Vec<PackEntry>,
}

/// One entry of a pack manifest: the name a diagnostic points at and the clip file it
/// plays.
#[derive(Debug, Deserialize)]
struct PackEntry {
    /// The entry's name, as the model browses it.
    #[serde(default)]
    name: String,
    /// The clip this entry plays, relative to the pack's own directory.
    file: String,
}

/// One published object as `objects.lock.json` records it. Only the two fields that
/// make a byte check possible are read; the bucket the publisher wrote it to is not
/// staging's business.
#[derive(Debug, Deserialize)]
struct LockEntry {
    /// The object's sha256, lowercase hex.
    sha256: String,
    /// The object's length in bytes.
    bytes: u64,
}

/// Stage the packs `refs` names out of the audio store at `store`.
///
/// `Ok(None)` when the case declares no packs: nothing is staged, and an `sfx-synth`,
/// end-to-end, adversarial, or performance run is untouched. `asset_kind` is what the
/// staged packs must satisfy — `sfx-sample` plays a sample pack and `music` an
/// instrument bank, while a full-stack case or jam takes packs of any kind.
///
/// Every failure here is a run that must not start: a ref the store cannot answer, a
/// stored pack that is not the pinned one, a clip the lock does not record, or bytes
/// that disagree with it would each leave the run rendering against audio other than
/// what its case declares.
pub fn stage_audio(
    store: &Path,
    refs: &[String],
    asset_kind: AssetKind,
) -> Result<Option<StagedAudio>> {
    if refs.is_empty() {
        return Ok(None);
    }
    let lock = read_lock(store)?;

    let mut packs: Vec<StagedPack> = Vec::with_capacity(refs.len());
    let mut defaults: BTreeMap<PackKind, String> = BTreeMap::new();
    let mut files: Vec<ContainerFile> = Vec::new();
    // Clip file names, deduplicated: two packs naming one clip stage it once, exactly
    // as the store holds it once.
    let mut clips: BTreeSet<String> = BTreeSet::new();

    for reference in refs {
        let (name, version) = split_ref(reference)?;
        let dir = staged::pack_dir(name, version);
        let manifest_path = store.join(&dir).join("pack.toml");
        let raw = std::fs::read_to_string(&manifest_path).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                missing_pack(reference, store)
            } else {
                Error::Seeding(format!(
                    "reading the audio pack manifest `{}`: {err}",
                    manifest_path.display()
                ))
            }
        })?;
        let manifest: PackManifest = toml::from_str(&raw).map_err(|err| {
            Error::Seeding(format!(
                "the audio pack manifest `{}` could not be read: {err}",
                manifest_path.display()
            ))
        })?;

        let kind = check_identity(&manifest, reference, name, version, &manifest_path)?;
        check_kind(reference, kind, asset_kind)?;

        for entry in &manifest.sample {
            let clip = clip_file(reference, entry)?;
            if clips.insert(clip.clone()) {
                files.push(stage_clip(store, &lock, reference, &clip)?);
            }
        }

        packs.push(StagedPack {
            name: name.to_string(),
            version: version.to_string(),
            kind,
            dir: dir.clone(),
        });
        // Declaration order decides each kind's default, so the first pack of a kind
        // wins and later ones never displace it. Resolving it here — once, on the
        // host — is what lets the container's resolver read a default rather than
        // recompute a positional rule.
        defaults
            .entry(kind)
            .or_insert_with(|| format!("{name}@{version}"));

        // The manifest is carried through byte for byte: the loader reads keys staging
        // has no business knowing about, and `check_identity` in the container holds
        // the loaded pack against the same bytes the store published.
        files.push(ContainerFile {
            container_path: container_path(&format!("{dir}/pack.toml")),
            contents: raw.into_bytes(),
            mode: STAGED_MODE,
        });
    }

    let manifest = StagedPacks {
        contract: CONTRACT_VERSION,
        defaults,
        packs,
    };
    let recorded = serde_json::to_vec_pretty(&manifest)
        .map_err(|err| Error::Seeding(format!("recording the run's audio palette: {err}")))?;
    files.push(ContainerFile {
        container_path: container_path(PACKS_MANIFEST),
        contents: recorded,
        mode: STAGED_MODE,
    });

    Ok(Some(StagedAudio { manifest, files }))
}

/// The absolute in-container path a root-relative staged path lands at.
fn container_path(relative: &str) -> String {
    format!("{}/{relative}", staged::AUDIO_ROOT)
}

/// Split a `name@version` ref, which manifest resolution has already shaped. Checked
/// again here because staging reads a ref that reached it through a stored record
/// rather than through this build's resolver.
fn split_ref(reference: &str) -> Result<(&str, &str)> {
    match reference.split_once('@') {
        Some((name, version)) if !name.is_empty() && !version.is_empty() => Ok((name, version)),
        _ => Err(Error::Seeding(format!(
            "audio pack ref `{reference}` is not `name@version`, so the pack it asks \
             for cannot be resolved in the audio store"
        ))),
    }
}

/// The store holds no such pack. Worded like the package store's vendoring failure:
/// name the ref, the store, and the two ways a store gets onto the machine.
fn missing_pack(reference: &str, store: &Path) -> Error {
    Error::Seeding(format!(
        "audio pack `{reference}` not found in the audio store at `{}` — the driver \
         image carries the store; for a local checkout, fetch it \
         (`scripts/fetch-audio-store.sh`) or point `TCAB_AUDIO_STORE` at a fetched copy",
        store.display()
    ))
}

/// Check that the pack the store answered with is the pack the ref pinned, and report
/// its kind. A store that answers a ref with some other pack would stage a palette the
/// case never declared, which is the whole failure this delivery path exists to
/// prevent.
fn check_identity(
    manifest: &PackManifest,
    reference: &str,
    name: &str,
    version: &str,
    path: &Path,
) -> Result<PackKind> {
    let (Some(found), Some(found_version), Some(kind)) = (
        manifest.name.as_deref(),
        manifest.version.as_deref(),
        manifest.kind,
    ) else {
        return Err(Error::Seeding(format!(
            "the audio pack manifest `{}` declares no `name`, `version`, or `kind`, \
             so the pack it holds cannot be checked against the pinned `{reference}`",
            path.display()
        )));
    };
    if found != name || found_version != version {
        return Err(Error::Seeding(format!(
            "the pack stored at `{}` is `{found}` {found_version}, not the pinned \
             `{reference}`",
            path.display()
        )));
    }
    Ok(kind)
}

/// Check a staged pack against what the run's binary plays: `sfx-sample` mixes over a
/// sample pack and `music` sequences over an instrument bank, so either serving the
/// other kind is a run that cannot render. Every other kind of case takes packs of any
/// kind — a full-stack game reaches for both.
fn check_kind(reference: &str, kind: PackKind, asset_kind: AssetKind) -> Result<()> {
    // There are two kinds, so a pack that is not the required one is the other one and
    // the whole clause is fixed by the asset kind alone.
    let (required, mismatch) = match asset_kind {
        AssetKind::SfxSample => (
            PackKind::SamplePack,
            "is an instrument-bank; a `sfx-sample` case declares a sample-pack",
        ),
        AssetKind::Music => (
            PackKind::InstrumentBank,
            "is a sample-pack; a `music` case declares an instrument-bank",
        ),
        _ => return Ok(()),
    };
    if kind == required {
        return Ok(());
    }
    Err(Error::Seeding(format!(
        "audio pack `{reference}` {mismatch}"
    )))
}

/// The store-relative clip file one entry names.
///
/// A manifest reaches its clip out of its own directory into the shared clip directory
/// (`../../clips/<clip-id>.<profile-id>.wav`), and that is the only shape staging
/// accepts: a `file` that resolves anywhere else would carry a byte the pack does not
/// own into the container.
fn clip_file(reference: &str, entry: &PackEntry) -> Result<String> {
    let escape = || {
        Error::Seeding(format!(
            "audio pack `{reference}` entry `{}` names a file outside its clip \
             directory: `{}`",
            entry.name, entry.file
        ))
    };
    let (parent, file) = entry.file.rsplit_once('/').ok_or_else(escape)?;
    if !parent
        .split('/')
        .next_back()
        .is_some_and(|dir| dir == CLIPS_DIR)
        || file.is_empty()
        || file.contains('\\')
        || file == "."
        || file == ".."
    {
        return Err(escape());
    }
    Ok(file.to_string())
}

/// Read one clip out of the store and verify it against the published-object lock
/// before it is staged.
fn stage_clip(
    store: &Path,
    lock: &BTreeMap<String, LockEntry>,
    reference: &str,
    clip: &str,
) -> Result<ContainerFile> {
    let key = object_key(reference, clip)?;
    let Some(record) = lock.get(&key) else {
        return Err(Error::Seeding(format!(
            "audio pack `{reference}` names the clip `{clip}`, which is not published: \
             the audio store's `{OBJECTS_LOCK}` has no record of `{key}`"
        )));
    };
    let path = store.join(CLIPS_DIR).join(clip);
    let contents = std::fs::read(&path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            Error::Seeding(format!(
                "audio pack `{reference}` names the clip `{clip}`, which the audio \
                 store at `{}` does not hold",
                store.display()
            ))
        } else {
            Error::Seeding(format!("reading the clip `{}`: {err}", path.display()))
        }
    })?;
    if contents.len() as u64 != record.bytes {
        return Err(Error::Seeding(format!(
            "the clip `{}` is {} bytes, and `{OBJECTS_LOCK}` records `{key}` as {} \
             bytes, so the audio store does not hold the published clip",
            path.display(),
            contents.len(),
            record.bytes
        )));
    }
    let digest = hex::encode(sha2::Sha256::digest(&contents));
    if digest != record.sha256 {
        return Err(Error::Seeding(format!(
            "the clip `{}` hashes to {digest}, and `{OBJECTS_LOCK}` records `{key}` as \
             {}, so the audio store does not hold the published clip",
            path.display(),
            record.sha256
        )));
    }
    Ok(ContainerFile {
        container_path: container_path(&format!("{CLIPS_DIR}/{clip}")),
        contents,
        mode: STAGED_MODE,
    })
}

/// The lock key one clip file answers to.
///
/// A clip file is named `<clip-id>.<profile-id>.wav` — the sha256 of the source audio
/// and the digest of the normalization profile it was rendered through — and the
/// publisher keys the object it uploaded by the same two parts.
fn object_key(reference: &str, clip: &str) -> Result<String> {
    let stem = clip.strip_suffix(".wav").unwrap_or(clip);
    match stem.split_once('.') {
        Some((clip_id, profile_id)) if !clip_id.is_empty() && !profile_id.is_empty() => {
            Ok(format!("normalized/{clip_id}/{profile_id}.wav"))
        }
        _ => Err(Error::Seeding(format!(
            "audio pack `{reference}` names the clip `{clip}`, which is not a published \
             object's `<clip-id>.<profile-id>.wav` name, so it cannot be checked against \
             `{OBJECTS_LOCK}`"
        ))),
    }
}

/// Read the store's published-object lock.
///
/// A store with no lock cannot be verified, and staging unverified bytes is exactly
/// what the lock exists to prevent, so an absent lock fails the run rather than
/// silently skipping the check.
fn read_lock(store: &Path) -> Result<BTreeMap<String, LockEntry>> {
    let path = store.join(OBJECTS_LOCK);
    let raw = std::fs::read_to_string(&path).map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            Error::Seeding(format!(
                "the audio store at `{}` holds no `{OBJECTS_LOCK}`, so the clips it \
                 carries cannot be checked against what was published — fetch a \
                 complete store (`scripts/fetch-audio-store.sh`) or point \
                 `TCAB_AUDIO_STORE` at one",
                store.display()
            ))
        } else {
            Error::Seeding(format!("reading `{}`: {err}", path.display()))
        }
    })?;
    serde_json::from_str(&raw)
        .map_err(|err| Error::Seeding(format!("reading `{}`: {err}", path.display())))
}

#[cfg(test)]
#[path = "audio_stage.test.rs"]
mod tests;
