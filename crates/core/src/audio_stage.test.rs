//! Tests for staging a run's declared audio packs.
//!
//! Three properties carry the whole point of moving audio delivery out of the image
//! and into the run, and each is asserted here rather than argued: the staged tree
//! holds the declared packs' clips and no others, nothing it writes lands in the
//! model's workspace, and the tree it writes is the tree the in-container binaries
//! read. The last is a cross-crate contract test: it loads what core wrote back
//! through `StagedPacks::load` and `sample::load_pack`, which is the reader the
//! binaries themselves run, so the writer and the reader cannot drift apart silently.

use std::collections::BTreeMap;

use tempfile::TempDir;
use test_cabinet_audio_core::sample;
use test_cabinet_audio_core::staged::{PackKind, StagedPacks};

use super::*;

/// The workspace the seeded repository is copied into. No staged audio path may lie
/// inside it: everything under it is collected as the run's result, so a clip staged
/// there would ship as though the model had produced it.
const WORK_DIR: &str = "/work";

/// The fixture clips' sample rate, and the rate each fixture pack declares. `load_pack`
/// checks the two agree, so a staged tree only loads if staging carried the manifest
/// and the audio through together.
const RATE: u32 = 44_100;

/// The fixture clips' length in milliseconds. Every entry declares it, and `load_pack`
/// checks the declared length against what the audio decodes to.
const DURATION_MS: u32 = 100;

/// A fixture audio store: the tree `stage_audio` reads, laid out exactly as the
/// published store is (`objects.lock.json`, `clips/`, `packs/<name>@<version>/`).
struct Store {
    /// The store's root, deleted with the fixture.
    dir: TempDir,
    /// The lock records written so far, keyed by object key.
    lock: BTreeMap<String, serde_json::Value>,
}

impl Store {
    /// An empty store.
    fn new() -> Self {
        let dir = TempDir::new().expect("a temp store");
        std::fs::create_dir_all(dir.path().join("clips")).expect("the clip directory");
        Self {
            dir,
            lock: BTreeMap::new(),
        }
    }

    /// The store's root.
    fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Write one clip into the store and record it in the lock, returning the file name
    /// a pack manifest reaches it by.
    ///
    /// `id` and `profile` stand in for the sha256 of the source audio and the digest of
    /// the normalization profile it was rendered through, which is what names a
    /// published object.
    fn clip(&mut self, id: u8, profile: u8) -> String {
        let file = format!("{:064x}.{:016x}.wav", id, profile);
        let bytes = wav(id);
        std::fs::write(self.path().join("clips").join(&file), &bytes).expect("a clip");
        self.lock.insert(
            format!("normalized/{:064x}/{:016x}.wav", id, profile),
            serde_json::json!({
                "bucket": "test-cabinet-audio",
                "sha256": hex::encode(sha2::Sha256::digest(&bytes)),
                "bytes": bytes.len(),
            }),
        );
        file
    }

    /// Write one pack manifest naming `entries` (an entry name and the clip file it
    /// plays), reaching out of the pack directory into the shared clip directory
    /// exactly as a published pack does.
    fn pack(&self, name: &str, version: &str, kind: &str, entries: &[(&str, &str)]) {
        let dir = self.path().join("packs").join(format!("{name}@{version}"));
        std::fs::create_dir_all(&dir).expect("a pack directory");
        let mut manifest = format!(
            "name = \"{name}\"\nversion = \"{version}\"\nkind = \"{kind}\"\n\
             sample_rate = {RATE}\nchannels = 1\n"
        );
        for (entry, file) in entries {
            manifest.push_str(&format!(
                "\n[[sample]]\nname = \"{entry}\"\ntags = []\nduration_ms = {DURATION_MS}\n\
                 description = \"\"\nfile = \"../../clips/{file}\"\nroot_note = 60\n\
                 pitched = true\n"
            ));
        }
        std::fs::write(dir.join("pack.toml"), manifest).expect("a pack manifest");
    }

    /// Write the store's published-object lock, which staging checks every clip it
    /// carries against.
    fn seal(&self) {
        std::fs::write(
            self.path().join(OBJECTS_LOCK),
            serde_json::to_string_pretty(&self.lock).expect("the lock"),
        )
        .expect("the lock file");
    }
}

/// A decodable PCM-16 WAV of [`DURATION_MS`] at [`RATE`], distinct per `seed` so two
/// fixture clips never hash alike.
fn wav(seed: u8) -> Vec<u8> {
    let frames = (RATE as usize * DURATION_MS as usize) / 1000;
    let samples: Vec<f32> = (0..frames)
        .map(|n| ((n as f32 + seed as f32) * 0.001).sin() * 0.5)
        .collect();
    test_cabinet_audio_core::wav::encode_pcm16(&samples, RATE, 1)
}

/// A store holding the three packs the tests select subsets of: one sample pack and
/// two instrument banks, with a clip the two banks share so deduplication is visible.
fn three_pack_store() -> Store {
    let mut store = Store::new();
    let impact = store.clip(1, 0xa);
    let debris = store.clip(2, 0xa);
    let piano = store.clip(3, 0xb);
    let strings = store.clip(4, 0xb);
    let choir = store.clip(5, 0xb);
    store.pack(
        "combat-core",
        "0.1.0",
        "sample-pack",
        &[("impact", &impact), ("debris", &debris)],
    );
    store.pack(
        "gm-lite",
        "0.1.0",
        "instrument-bank",
        &[("grand_piano", &piano), ("strings", &strings)],
    );
    store.pack(
        "cinematic",
        "0.1.0",
        "instrument-bank",
        &[("strings", &strings), ("choir_aah", &choir)],
    );
    store.seal();
    store
}

/// The refs a full-stack case declares, as owned strings.
fn refs(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// The absolute container paths the staged tree materializes to, sorted.
fn paths(staged: &StagedAudio) -> Vec<String> {
    staged.container_paths().expect("the staged tree reads")
}

// ── What is staged ──────────────────────────────────────────────────────────

#[test]
fn a_case_declaring_no_packs_stages_nothing() {
    // Every end-to-end, adversarial and performance run, and every `sfx-synth` one.
    // Nothing is read, so a machine with no audio store runs them exactly as before.
    let staged = stage_audio(Path::new("/nonexistent"), &[], AssetKind::Sprite)
        .expect("a case declaring no packs needs no store");
    assert!(staged.is_none());
}

#[test]
fn only_the_declared_packs_clips_are_staged() {
    // The requirement the whole delivery path exists for: a run container holds the
    // clips of the packs its case declares and no others. The store here carries three
    // packs; the case declares two, and the third's exclusive clip must be absent.
    let store = three_pack_store();
    let staged = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0", "gm-lite@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("staging the declared packs")
    .expect("a case declaring packs stages them");

    let paths = paths(&staged);
    let clips: Vec<&String> = paths
        .iter()
        .filter(|path| path.contains("/clips/"))
        .collect();
    assert_eq!(clips.len(), 4, "two packs of two entries each: {paths:?}");
    for id in [1, 2, 3, 4] {
        let file = format!("{:064x}.", id);
        assert!(
            clips.iter().any(|path| path.contains(&file)),
            "clip {id} is declared and must be staged: {clips:?}",
        );
    }
    // `cinematic`'s exclusive clip belongs to a pack this case did not declare.
    let undeclared = format!("{:064x}.", 5);
    assert!(
        !paths.iter().any(|path| path.contains(&undeclared)),
        "an undeclared pack's clip must not be staged: {paths:?}",
    );
    assert!(
        !paths.iter().any(|path| path.contains("cinematic")),
        "an undeclared pack's manifest must not be staged: {paths:?}",
    );
    assert_eq!(
        staged
            .manifest
            .packs
            .iter()
            .map(|pack| pack.reference())
            .collect::<Vec<_>>(),
        vec!["combat-core@0.1.0", "gm-lite@0.1.0"],
    );
}

#[test]
fn no_staged_path_lies_inside_the_run_workspace() {
    // Raw clips must never reach the model's workspace: everything under `/work` is
    // the model's own tree, is committed, and is collected as the run's result, so a
    // clip staged there would ship as though the model had produced it.
    let store = three_pack_store();
    let staged = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0", "gm-lite@0.1.0", "cinematic@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("staging every pack")
    .expect("a case declaring packs stages them");

    let staged_paths = paths(&staged);
    assert!(!staged_paths.is_empty());
    for path in staged_paths {
        assert!(
            path.starts_with(&format!("{}/", staged::AUDIO_ROOT)),
            "`{path}` is staged outside the audio root",
        );
        assert!(
            !path.starts_with(&format!("{WORK_DIR}/")) && path != WORK_DIR,
            "`{path}` is staged inside the run workspace",
        );
    }
}

#[test]
fn a_clip_two_packs_share_is_staged_once() {
    // The store holds a shared clip once and so does the container: the two banks name
    // the same strings clip, and staging carries one copy of it.
    let store = three_pack_store();
    let staged = stage_audio(
        store.path(),
        &refs(&["gm-lite@0.1.0", "cinematic@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("staging two banks")
    .expect("a case declaring packs stages them");

    let shared = format!("{:064x}.", 4);
    let copies = paths(&staged)
        .iter()
        .filter(|path| path.contains(&shared))
        .count();
    assert_eq!(copies, 1, "a shared clip is staged once");
    assert_eq!(
        paths(&staged)
            .iter()
            .filter(|path| path.contains("/clips/"))
            .count(),
        3,
        "two banks of two entries sharing one clip stage three clips",
    );
}

#[test]
fn declaration_order_decides_each_kinds_default() {
    // Order is meaningful, and it is resolved here rather than in the container: the
    // first pack of each kind is what a tool config naming none resolves to. Core
    // writes that decision into `packs.json` so the container reads a default instead
    // of recomputing a positional rule.
    let store = three_pack_store();
    let staged = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0", "gm-lite@0.1.0", "cinematic@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("staging every pack")
    .expect("a case declaring packs stages them");
    assert_eq!(
        staged.manifest.defaults.get(&PackKind::SamplePack),
        Some(&"combat-core@0.1.0".to_string()),
    );
    assert_eq!(
        staged.manifest.defaults.get(&PackKind::InstrumentBank),
        Some(&"gm-lite@0.1.0".to_string()),
        "the first bank declared is the bank default, not the last",
    );

    let reordered = stage_audio(
        store.path(),
        &refs(&["cinematic@0.1.0", "gm-lite@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("staging the banks the other way round")
    .expect("a case declaring packs stages them");
    assert_eq!(
        reordered.manifest.defaults.get(&PackKind::InstrumentBank),
        Some(&"cinematic@0.1.0".to_string()),
    );
    assert_eq!(reordered.manifest.defaults.get(&PackKind::SamplePack), None);
}

// ── What the binaries read ──────────────────────────────────────────────────

#[test]
fn the_audio_binaries_load_the_staged_tree() {
    // The cross-crate contract: what core writes is read back through the very
    // functions the in-container binaries call. If the layout, the manifest shape, or
    // the relative `file` a pack reaches its clips by ever drifted, this fails.
    let store = three_pack_store();
    let staged = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0", "gm-lite@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("staging the declared packs")
    .expect("a case declaring packs stages them");
    // The staged tree IS the tree the container is given: its contents are copied to
    // the audio root verbatim, so reading it here reads what the binaries read.
    let root = staged.path();

    let manifest = StagedPacks::load(root)
        .expect("the staged manifest reads")
        .expect("a staged run has a manifest");
    assert_eq!(manifest, staged.manifest);

    // A full-stack run writes its own tool config and names no pack, so it resolves
    // the staged default for each kind.
    let pack = manifest
        .select(PackKind::SamplePack, None)
        .expect("the default sample pack resolves")
        .expect("a sample pack is staged");
    assert_eq!(pack.reference(), "combat-core@0.1.0");

    let library = sample::load_pack(&root.join(&pack.dir)).expect("the pack loads");
    assert_eq!(library.reference().as_deref(), Some("combat-core@0.1.0"));
    assert_eq!(library.sample_rate(), RATE);
    let mut names: Vec<&str> = library.list(None).iter().map(|e| e.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, vec!["debris", "impact"]);
    assert!(
        library.samples("impact").is_some_and(|pcm| !pcm.is_empty()),
        "a staged entry's audio decodes through the relative `file` its manifest names",
    );

    // A config naming a bank resolves the staged bank, and it loads the same way.
    let bank = manifest
        .select(PackKind::InstrumentBank, Some("gm-lite@0.1.0"))
        .expect("the named bank resolves")
        .expect("a bank is staged");
    let bank = sample::load_pack(&root.join(&bank.dir)).expect("the bank loads");
    assert_eq!(bank.reference().as_deref(), Some("gm-lite@0.1.0"));

    // And a pack the case did not declare is not reachable, whatever the config says.
    let denied = manifest
        .select(PackKind::InstrumentBank, Some("cinematic@0.1.0"))
        .expect_err("an undeclared pack is not staged");
    assert!(
        denied.contains("this run was staged with"),
        "the diagnostic names the palette the run holds: {denied}",
    );
}

// ── What fails the run ──────────────────────────────────────────────────────

#[test]
fn a_ref_that_would_escape_the_staged_tree_fails_the_run() {
    // Staging reads refs out of a stored record rather than out of this build's
    // resolver, so it checks their shape again: each half becomes a directory of the
    // tree, and one carrying a separator or a dot segment would write a pack's
    // manifest outside the tree the container is given.
    let store = three_pack_store();
    for bad in ["../../work/x@1", "gm-lite@../0.1.0", "gm-lite", "gm-lite@"] {
        let err = stage_audio(store.path(), &refs(&[bad]), AssetKind::Sprite)
            .expect_err("a ref that is not `name@version` cannot be staged");
        let message = err.to_string();
        assert!(
            message.contains(&format!("audio pack ref `{bad}` is not `name@version`")),
            "{message}",
        );
    }
}

#[test]
fn a_pack_the_store_does_not_hold_fails_the_run() {
    let store = three_pack_store();
    let err = stage_audio(
        store.path(),
        &refs(&["folk-strings@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect_err("an unheld pack cannot be staged");
    let message = err.to_string();
    assert!(
        message.contains("`folk-strings@0.1.0` not found"),
        "{message}"
    );
    assert!(
        message.contains("scripts/fetch-audio-store.sh") && message.contains("TCAB_AUDIO_STORE"),
        "the message says how to get a store onto the machine: {message}",
    );
}

#[test]
fn a_version_the_store_does_not_hold_fails_the_run() {
    // A ref pins a version, and the store is keyed by `name@version`, so an unpublished
    // version is simply absent rather than quietly served by another version.
    let store = three_pack_store();
    let err = stage_audio(store.path(), &refs(&["gm-lite@0.2.0"]), AssetKind::Sprite)
        .expect_err("an unheld version cannot be staged");
    assert!(err.to_string().contains("`gm-lite@0.2.0` not found"));
}

#[test]
fn a_stored_pack_that_is_not_the_pinned_one_fails_the_run() {
    // The store answered the ref, but with a pack that calls itself something else.
    // Staging it would give the run a palette its case never declared.
    let mut store = Store::new();
    let clip = store.clip(1, 0xa);
    store.seal();
    store.pack("impostor", "0.1.0", "sample-pack", &[("impact", &clip)]);
    let dir = store.path().join("packs").join("impostor@0.1.0");
    std::fs::rename(&dir, store.path().join("packs").join("combat-core@0.1.0"))
        .expect("rename the pack directory");

    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect_err("a pack that is not the pinned one cannot be staged");
    let message = err.to_string();
    assert!(message.contains("is `impostor` 0.1.0"), "{message}");
    assert!(
        message.contains("not the pinned `combat-core@0.1.0`"),
        "{message}"
    );
}

#[test]
fn an_asset_generation_case_is_staged_only_its_binarys_kind_of_pack() {
    // `sfx-sample` mixes over a sample pack and `music` sequences over an instrument
    // bank. Either serving the other is a run that cannot render, and the manifest
    // lint already rejects it — this is the second check, on the bytes themselves.
    let store = three_pack_store();
    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::Music,
    )
    .expect_err("a music case is not staged a sample pack");
    assert_eq!(
        err.to_string(),
        "failed to seed run repository: audio pack `combat-core@0.1.0` is a sample-pack; \
         a `music` case declares an instrument-bank",
    );

    let err = stage_audio(
        store.path(),
        &refs(&["gm-lite@0.1.0"]),
        AssetKind::SfxSample,
    )
    .expect_err("an sfx-sample case is not staged an instrument bank");
    assert_eq!(
        err.to_string(),
        "failed to seed run repository: audio pack `gm-lite@0.1.0` is an instrument-bank; \
         a `sfx-sample` case declares a sample-pack",
    );

    // A full-stack case's game reaches for both, so it takes packs of either kind.
    stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0", "gm-lite@0.1.0"]),
        AssetKind::Sprite,
    )
    .expect("a full-stack case takes packs of either kind");
}

#[test]
fn a_clip_whose_bytes_disagree_with_the_lock_fails_the_run() {
    // The published-object lock is what says which bytes exist. A store whose clip no
    // longer hashes to its record is a store nobody published, and rendering against it
    // would score a run on audio that is not the pack's.
    let store = three_pack_store();
    let tampered = store
        .path()
        .join("clips")
        .join(format!("{:064x}.{:016x}.wav", 1, 0xa));
    let mut bytes = std::fs::read(&tampered).expect("the clip");
    let last = bytes.len() - 1;
    bytes[last] ^= 0xff;
    std::fs::write(&tampered, &bytes).expect("tamper with the clip");

    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::SfxSample,
    )
    .expect_err("a clip that disagrees with the lock cannot be staged");
    let message = err.to_string();
    assert!(message.contains("hashes to"), "{message}");
    assert!(message.contains(OBJECTS_LOCK), "{message}");
}

#[test]
fn a_clip_whose_length_disagrees_with_the_lock_fails_the_run() {
    let store = three_pack_store();
    let truncated = store
        .path()
        .join("clips")
        .join(format!("{:064x}.{:016x}.wav", 1, 0xa));
    let bytes = std::fs::read(&truncated).expect("the clip");
    std::fs::write(&truncated, &bytes[..bytes.len() - 2]).expect("truncate the clip");

    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::SfxSample,
    )
    .expect_err("a truncated clip cannot be staged");
    assert!(
        err.to_string().contains("bytes, so the audio store"),
        "{err}"
    );
}

#[test]
fn a_clip_the_lock_does_not_record_fails_the_run() {
    // A pack naming a clip nobody published is a pack that cannot be staged, wherever
    // the bytes on disk came from.
    let mut store = Store::new();
    let clip = store.clip(1, 0xa);
    store.seal();
    // A second clip written into the store but never published.
    let stray = format!("{:064x}.{:016x}.wav", 9, 0xa);
    std::fs::write(store.path().join("clips").join(&stray), wav(9)).expect("a stray clip");
    store.pack(
        "combat-core",
        "0.1.0",
        "sample-pack",
        &[("impact", &clip), ("stray", &stray)],
    );

    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::SfxSample,
    )
    .expect_err("an unpublished clip cannot be staged");
    let message = err.to_string();
    assert!(message.contains("is not published"), "{message}");
    assert!(
        message.contains(&format!("normalized/{:064x}/{:016x}.wav", 9, 0xa)),
        "the message names the object key that is missing: {message}",
    );
}

#[test]
fn a_store_with_no_lock_fails_the_run() {
    // Staging unverified bytes is exactly what the lock exists to prevent, so a store
    // that cannot be verified fails rather than skipping the check.
    let mut store = Store::new();
    let clip = store.clip(1, 0xa);
    store.pack("combat-core", "0.1.0", "sample-pack", &[("impact", &clip)]);

    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::SfxSample,
    )
    .expect_err("an unverifiable store cannot be staged from");
    assert!(
        err.to_string()
            .contains(&format!("holds no `{OBJECTS_LOCK}`")),
        "{err}"
    );
}

#[test]
fn an_entry_reaching_outside_the_clip_directory_fails_the_run() {
    // A manifest's `file` reaches out of the pack directory into the shared clip
    // directory and nowhere else. Anything else would carry a byte the pack does not
    // own into the container.
    let mut store = Store::new();
    store.clip(1, 0xa);
    store.seal();
    let dir = store.path().join("packs").join("combat-core@0.1.0");
    std::fs::create_dir_all(&dir).expect("a pack directory");
    std::fs::write(
        dir.join("pack.toml"),
        format!(
            "name = \"combat-core\"\nversion = \"0.1.0\"\nkind = \"sample-pack\"\n\
             sample_rate = {RATE}\nchannels = 1\n\n[[sample]]\nname = \"impact\"\n\
             duration_ms = {DURATION_MS}\nfile = \"../../../etc/passwd\"\n"
        ),
    )
    .expect("a pack manifest");

    let err = stage_audio(
        store.path(),
        &refs(&["combat-core@0.1.0"]),
        AssetKind::SfxSample,
    )
    .expect_err("an escaping entry cannot be staged");
    assert!(
        err.to_string()
            .contains("names a file outside its clip directory"),
        "{err}",
    );
}

#[test]
fn a_ref_that_is_not_name_at_version_fails_the_run() {
    // Manifest resolution already requires it, but staging reads a ref out of a stored
    // record rather than out of this build's resolver, so it checks for itself.
    let store = three_pack_store();
    let err = stage_audio(store.path(), &refs(&["combat-core"]), AssetKind::Sprite)
        .expect_err("an unpinned ref cannot be resolved in the store");
    assert!(err.to_string().contains("is not `name@version`"), "{err}");
}
