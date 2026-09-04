use super::*;

use std::path::{Path, PathBuf};

use crate::staged::{CONTRACT_VERSION, PACKS_MANIFEST, StagedPack, StagedPacks, pack_dir};

/// A staged audio root, pointed at by `TCAB_AUDIO_DIR` for the duration of the test.
/// nextest runs each test in its own process, so the variable is test-local.
fn audio_root() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var(crate::staged::AUDIO_ROOT_ENV, root.path()) };
    root
}

/// One staged pack, in the shape staging writes: `packs/<name>@<version>/pack.toml`
/// declaring the pack's identity and one decodable `<entry>.wav` beside it.
fn write_pack(root: &Path, name: &str, version: &str, entries: &[&str]) -> PathBuf {
    let dir = root.join(pack_dir(name, version));
    std::fs::create_dir_all(&dir).unwrap();
    let mut manifest = format!("name = \"{name}\"\nversion = \"{version}\"\nsample_rate = 44100\n");
    for entry in entries {
        manifest.push_str(&format!("\n[[sample]]\nname = \"{entry}\"\n"));
        let wav = wav::encode_pcm16(&[0.1f32; 32], 44100, 1);
        std::fs::write(dir.join(format!("{entry}.wav")), wav).unwrap();
    }
    std::fs::write(dir.join("pack.toml"), manifest).unwrap();
    dir
}

/// The `packs.json` staging writes beside the packs, naming the first pack of each
/// kind as that kind's default.
fn write_manifest(root: &Path, packs: &[(&str, &str, PackKind)]) {
    let mut defaults = std::collections::BTreeMap::new();
    let mut staged = Vec::new();
    for (name, version, kind) in packs {
        let pack = StagedPack {
            name: (*name).to_string(),
            version: (*version).to_string(),
            kind: *kind,
            dir: pack_dir(name, version),
        };
        defaults.entry(*kind).or_insert_with(|| pack.reference());
        staged.push(pack);
    }
    let manifest = StagedPacks {
        contract: CONTRACT_VERSION,
        defaults,
        packs: staged,
    };
    std::fs::write(
        root.join(PACKS_MANIFEST),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
}

fn config(json: &str) -> AudioConfig {
    serde_json::from_str(json).unwrap()
}

#[test]
fn a_run_staged_with_no_audio_and_wanting_none_loads_an_empty_library() {
    // The `sfx-synth` case: its case declares no packs, so nothing is staged.
    let _root = audio_root();
    let library =
        load_library(&config("{}"), PackKind::SamplePack).expect("no pack is not a failure");
    assert!(library.is_empty());
}

#[test]
fn a_named_pack_loads_its_library() {
    let root = audio_root();
    write_pack(root.path(), "combat-core", "0.1.0", &["cannon", "debris"]);
    write_manifest(
        root.path(),
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );

    let library = load_library(
        &config(r#"{ "sample_pack": "combat-core@0.1.0" }"#),
        PackKind::SamplePack,
    )
    .expect("loads");
    assert_eq!(library.list(None).len(), 2);
}

#[test]
fn a_pack_entry_reads_the_shared_clip_directory_beside_it() {
    // The staged tree shares one clip directory across packs, so an entry's `file`
    // resolves out of the pack directory exactly as it does in the store.
    let root = audio_root();
    let dir = root.path().join(pack_dir("combat-core", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::create_dir_all(root.path().join("clips")).unwrap();
    std::fs::write(
        root.path().join("clips/abc123.def456.wav"),
        wav::encode_pcm16(&[0.1f32; 32], 44100, 1),
    )
    .unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        "name = \"combat-core\"\nversion = \"0.1.0\"\nsample_rate = 44100\n\n\
         [[sample]]\nname = \"cannon\"\nfile = \"../../clips/abc123.def456.wav\"\n",
    )
    .unwrap();
    write_manifest(
        root.path(),
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );

    let library = load_library(&config("{}"), PackKind::SamplePack).expect("loads");
    assert_eq!(library.samples("cannon").map(|pcm| pcm.len()), Some(32));
}

#[test]
fn a_config_naming_no_pack_loads_the_staged_default() {
    // A full-stack run authors its own config and names no palette, so the first pack
    // of that kind its case declares is what it plays.
    let root = audio_root();
    write_pack(root.path(), "combat-core", "0.1.0", &["cannon"]);
    write_pack(root.path(), "gm-lite", "0.1.0", &["piano"]);
    write_manifest(
        root.path(),
        &[
            ("combat-core", "0.1.0", PackKind::SamplePack),
            ("gm-lite", "0.1.0", PackKind::InstrumentBank),
        ],
    );

    let library = load_library(&config("{}"), PackKind::SamplePack).expect("loads the default");
    assert_eq!(library.name(), Some("combat-core"));
    let bank = load_library(&config("{}"), PackKind::InstrumentBank).expect("loads the default");
    assert_eq!(bank.name(), Some("gm-lite"));
}

#[test]
fn a_full_stack_run_may_load_any_pack_its_case_declares() {
    let root = audio_root();
    write_pack(root.path(), "gm-lite", "0.1.0", &["piano"]);
    write_pack(root.path(), "synthwave", "0.1.0", &["pad"]);
    write_manifest(
        root.path(),
        &[
            ("gm-lite", "0.1.0", PackKind::InstrumentBank),
            ("synthwave", "0.1.0", PackKind::InstrumentBank),
        ],
    );

    let library = load_library(
        &config(r#"{ "instrument_bank": "synthwave@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect("a declared bank other than the default loads");
    assert_eq!(library.name(), Some("synthwave"));
}

#[test]
fn a_named_pack_in_a_run_staged_with_no_audio_is_an_error() {
    let _root = audio_root();
    let err = load_library(
        &config(r#"{ "sample_pack": "combat-core@0.1.0" }"#),
        PackKind::SamplePack,
    )
    .expect_err("a configured pack the run was never given is a failure");
    assert!(err.contains("combat-core@0.1.0"), "{err}");
    assert!(err.contains("no audio packs"), "{err}");
    assert!(err.contains("[audio] packs"), "{err}");
}

#[test]
fn a_named_bank_the_run_was_not_staged_with_is_an_error() {
    let root = audio_root();
    write_pack(root.path(), "gm-lite", "0.1.0", &["piano"]);
    write_manifest(
        root.path(),
        &[("gm-lite", "0.1.0", PackKind::InstrumentBank)],
    );

    let err = load_library(
        &config(r#"{ "instrument_bank": "cinematic@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("an undeclared bank is a failure, not a fallback to gm-lite");
    assert!(err.contains("cinematic"), "{err}");
    assert!(err.contains("gm-lite@0.1.0"), "{err}");
}

#[test]
fn a_pack_of_the_other_kind_cannot_be_loaded() {
    let root = audio_root();
    write_pack(root.path(), "combat-core", "0.1.0", &["cannon"]);
    write_manifest(
        root.path(),
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );

    let err = load_library(
        &config(r#"{ "instrument_bank": "combat-core@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("a sample pack cannot be sequenced as an instrument bank");
    assert!(err.contains("sample-pack"), "{err}");
}

#[test]
fn a_staged_pack_whose_directory_is_missing_is_an_error() {
    let root = audio_root();
    write_manifest(
        root.path(),
        &[("gm-lite", "0.1.0", PackKind::InstrumentBank)],
    );

    let err = load_library(
        &config(r#"{ "instrument_bank": "gm-lite@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("a missing pack directory is a failure");
    assert!(err.contains("gm-lite@0.1.0"), "{err}");
    assert!(err.contains("does not exist"), "{err}");
}

#[test]
fn a_pack_with_a_broken_manifest_is_an_error() {
    let root = audio_root();
    let dir = root.path().join(pack_dir("gm-lite", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("pack.toml"), "[[sample]\nname =").unwrap();
    write_manifest(
        root.path(),
        &[("gm-lite", "0.1.0", PackKind::InstrumentBank)],
    );

    let err = load_library(
        &config(r#"{ "instrument_bank": "gm-lite@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("an unparseable manifest is a failure");
    assert!(err.contains("invalid pack manifest"), "{err}");
}

#[test]
fn a_pack_declaring_no_samples_is_an_error() {
    let root = audio_root();
    write_pack(root.path(), "gm-lite", "0.1.0", &[]);
    write_manifest(
        root.path(),
        &[("gm-lite", "0.1.0", PackKind::InstrumentBank)],
    );

    let err = load_library(
        &config(r#"{ "instrument_bank": "gm-lite@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("an empty pack is a failure");
    assert!(err.contains("declares no samples"), "{err}");
}

#[test]
fn a_pack_missing_an_entry_s_audio_is_an_error() {
    let root = audio_root();
    let dir = root.path().join(pack_dir("gm-lite", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        "name = \"gm-lite\"\nversion = \"0.1.0\"\n\n[[sample]]\nname = \"trombone\"\n",
    )
    .unwrap();
    write_manifest(
        root.path(),
        &[("gm-lite", "0.1.0", PackKind::InstrumentBank)],
    );

    let err = load_library(
        &config(r#"{ "instrument_bank": "gm-lite@0.1.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("a declared entry with no audio is a failure");
    assert!(err.contains("trombone"), "{err}");
}

#[test]
fn a_pin_on_a_version_the_run_was_not_staged_with_is_an_error() {
    // The case pins 0.1.0; the run was staged with 0.2.0. Rendering against a palette
    // other than the one the case was written against is the failure this prevents.
    let root = audio_root();
    write_pack(root.path(), "combat-core", "0.2.0", &["cannon"]);
    write_manifest(
        root.path(),
        &[("combat-core", "0.2.0", PackKind::SamplePack)],
    );

    let err = load_library(
        &config(r#"{ "sample_pack": "combat-core@0.1.0" }"#),
        PackKind::SamplePack,
    )
    .expect_err("a stale pin is a failure, not a silent substitution");
    assert!(err.contains("0.1.0"), "{err}");
    assert!(err.contains("0.2.0"), "{err}");
}

#[test]
fn a_pack_whose_manifest_declares_another_name_is_an_error() {
    // The identity check runs on the loaded manifest, so a pack rewritten inside the
    // container fails at load rather than rendering another palette's samples.
    let root = audio_root();
    let dir = root.path().join(pack_dir("combat-core", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("cannon.wav"),
        wav::encode_pcm16(&[0.1f32; 32], 44100, 1),
    )
    .unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        "name = \"naval-weapons\"\nversion = \"0.1.0\"\n\n[[sample]]\nname = \"cannon\"\n",
    )
    .unwrap();
    write_manifest(
        root.path(),
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );

    let err = load_library(
        &config(r#"{ "sample_pack": "combat-core@0.1.0" }"#),
        PackKind::SamplePack,
    )
    .expect_err("a pack directory holding another palette is a failure");
    assert!(err.contains("naval-weapons"), "{err}");
    assert!(err.contains("combat-core"), "{err}");
}

#[test]
fn a_config_naming_no_pack_still_checks_the_staged_pack_s_identity() {
    // A full-stack run pins nothing of its own, so the staged pack's own ref is the
    // pin: a rewritten `pack.toml` fails at load rather than rendering the wrong sound.
    let root = audio_root();
    let dir = root.path().join(pack_dir("combat-core", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("cannon.wav"),
        wav::encode_pcm16(&[0.1f32; 32], 44100, 1),
    )
    .unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        "name = \"combat-core\"\nversion = \"9.9.9\"\n\n[[sample]]\nname = \"cannon\"\n",
    )
    .unwrap();
    write_manifest(
        root.path(),
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );

    let err = load_library(&config("{}"), PackKind::SamplePack)
        .expect_err("a staged pack that is not what packs.json says it is");
    assert!(err.contains("9.9.9"), "{err}");
    assert!(err.contains("0.1.0"), "{err}");
}

#[test]
fn a_pack_declaring_no_version_cannot_satisfy_a_pinned_ref() {
    let root = audio_root();
    let dir = root.path().join(pack_dir("combat-core", "0.1.0"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("cannon.wav"),
        wav::encode_pcm16(&[0.1f32; 32], 44100, 1),
    )
    .unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        "name = \"combat-core\"\nsample_rate = 44100\n\n[[sample]]\nname = \"cannon\"\n",
    )
    .unwrap();
    write_manifest(
        root.path(),
        &[("combat-core", "0.1.0", PackKind::SamplePack)],
    );

    let err = load_library(
        &config(r#"{ "sample_pack": "combat-core@0.1.0" }"#),
        PackKind::SamplePack,
    )
    .expect_err("an unversioned manifest cannot answer a pinned ref");
    assert!(err.contains("version"), "{err}");
}

#[test]
fn a_bare_name_ref_accepts_the_version_the_run_was_staged_with() {
    let root = audio_root();
    write_pack(root.path(), "combat-core", "0.7.3", &["cannon"]);
    write_manifest(
        root.path(),
        &[("combat-core", "0.7.3", PackKind::SamplePack)],
    );

    let library = load_library(
        &config(r#"{ "sample_pack": "combat-core" }"#),
        PackKind::SamplePack,
    )
    .expect("loads");
    assert_eq!(library.version(), Some("0.7.3"));
}
