use super::*;

use std::path::Path;

/// A pack directory in the shape the image stager writes: a `pack.toml` declaring the
/// pack's identity and one decodable `<name>.wav` per entry.
fn write_pack(dir: &Path, name: &str, version: &str, entries: &[&str]) {
    std::fs::create_dir_all(dir).unwrap();
    let mut manifest = format!("name = \"{name}\"\nversion = \"{version}\"\nsample_rate = 44100\n");
    for entry in entries {
        manifest.push_str(&format!("\n[[sample]]\nname = \"{entry}\"\n"));
        let wav = wav::encode_pcm16(&[0.1f32; 32], 44100, 1);
        std::fs::write(dir.join(format!("{entry}.wav")), wav).unwrap();
    }
    std::fs::write(dir.join("pack.toml"), manifest).unwrap();
}

fn config(json: &str) -> AudioConfig {
    serde_json::from_str(json).unwrap()
}

/// Clear every baked-image variable, so a test states the whole environment it means.
fn clear_env() {
    for key in [
        "TCAB_SAMPLE_PACK",
        "TCAB_SAMPLE_PACK_DIR",
        "TCAB_INSTRUMENT_BANK",
        "TCAB_INSTRUMENT_BANK_DIR",
    ] {
        unsafe { std::env::remove_var(key) };
    }
}

#[test]
fn a_run_resolving_no_palette_loads_an_empty_library() {
    // The `sfx-synth` case: no pack is baked and none is wanted.
    clear_env();
    let library =
        load_library(&config("{}"), PackKind::SamplePack).expect("no pack is not a failure");
    assert!(library.is_empty());
}

#[test]
fn a_named_pack_loads_its_library() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("combat-core");
    write_pack(&dir, "combat-core", "0.2.0", &["cannon", "debris"]);

    let json = format!(
        r#"{{ "sample_pack": "combat-core@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let library = load_library(&config(&json), PackKind::SamplePack).expect("loads");
    assert_eq!(library.list(None).len(), 2);
}

#[test]
fn a_full_stack_config_naming_no_palette_loads_the_image_default() {
    clear_env();
    // A full-stack run authors its own config, so the image's default palette is what
    // gives it a library at all.
    let root = tempfile::tempdir().unwrap();
    write_pack(
        &root.path().join("combat-core"),
        "combat-core",
        "0.2.0",
        &["cannon"],
    );
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK_DIR", root.path()) };
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK", "combat-core") };

    let library = load_library(&config("{}"), PackKind::SamplePack).expect("loads the default");
    assert_eq!(library.list(None).len(), 1);
    assert_eq!(library.name(), Some("combat-core"));
}

#[test]
fn a_named_pack_with_no_resolvable_directory_is_an_error() {
    // No `pack_dir` and no baked env var: the run asked for a pack that is not there.
    clear_env();
    let err = load_library(
        &config(r#"{ "sample_pack": "combat-core@0.2.0" }"#),
        PackKind::SamplePack,
    )
    .expect_err("a configured pack that resolves nowhere is a failure");
    assert!(err.contains("combat-core@0.2.0"), "{err}");
    assert!(err.contains("TCAB_SAMPLE_PACK_DIR"), "{err}");
}

#[test]
fn a_named_bank_the_image_does_not_bake_is_an_error() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    write_pack(&root.path().join("gm-lite"), "gm-lite", "0.2.0", &["piano"]);
    unsafe { std::env::set_var("TCAB_INSTRUMENT_BANK_DIR", root.path()) };

    let err = load_library(
        &config(r#"{ "instrument_bank": "cinematic@0.2.0" }"#),
        PackKind::InstrumentBank,
    )
    .expect_err("an unbaked bank is a failure, not a fallback to gm-lite");
    assert!(err.contains("cinematic"), "{err}");
    assert!(err.contains("gm-lite"), "{err}");
}

#[test]
fn a_named_bank_whose_directory_is_missing_is_an_error() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("absent");
    let json = format!(
        r#"{{ "instrument_bank": "gm-lite@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::InstrumentBank)
        .expect_err("a missing bank directory is a failure");
    assert!(err.contains("gm-lite@0.2.0"), "{err}");
    assert!(err.contains("does not exist"), "{err}");
}

#[test]
fn a_named_bank_with_a_broken_manifest_is_an_error() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("gm-lite");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("pack.toml"), "[[sample]\nname =").unwrap();

    let json = format!(
        r#"{{ "instrument_bank": "gm-lite@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::InstrumentBank)
        .expect_err("an unparseable manifest is a failure");
    assert!(err.contains("invalid pack manifest"), "{err}");
}

#[test]
fn a_named_bank_declaring_no_samples_is_an_error() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("gm-lite");
    write_pack(&dir, "gm-lite", "0.2.0", &[]);

    let json = format!(
        r#"{{ "instrument_bank": "gm-lite@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::InstrumentBank)
        .expect_err("an empty configured bank is a failure");
    assert!(err.contains("declares no samples"), "{err}");
}

#[test]
fn a_named_bank_missing_an_entry_s_audio_is_an_error() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("gm-lite");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("pack.toml"),
        "name = \"gm-lite\"\nversion = \"0.2.0\"\n\n[[sample]]\nname = \"trombone\"\n",
    )
    .unwrap();

    let json = format!(
        r#"{{ "instrument_bank": "gm-lite@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::InstrumentBank)
        .expect_err("a declared entry with no audio is a failure");
    assert!(err.contains("trombone"), "{err}");
}

#[test]
fn a_pin_on_a_version_the_image_does_not_carry_is_an_error() {
    clear_env();
    // The case pins 0.1.0; the image bakes 0.2.0. Rendering against a different
    // palette than the case was written against is the failure this prevents.
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("combat-core");
    write_pack(&dir, "combat-core", "0.2.0", &["cannon"]);

    let json = format!(
        r#"{{ "sample_pack": "combat-core@0.1.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::SamplePack)
        .expect_err("a stale pin is a failure, not a silent substitution");
    assert!(err.contains("0.1.0"), "{err}");
    assert!(err.contains("0.2.0"), "{err}");
}

#[test]
fn a_pack_whose_name_differs_from_the_pin_is_an_error() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("packs");
    write_pack(&dir, "combat-core", "0.2.0", &["cannon"]);

    let json = format!(
        r#"{{ "sample_pack": "naval-weapons@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::SamplePack)
        .expect_err("a pack directory holding another palette is a failure");
    assert!(err.contains("naval-weapons"), "{err}");
    assert!(err.contains("combat-core"), "{err}");
}

#[test]
fn a_pack_declaring_no_version_cannot_satisfy_a_pinned_ref() {
    clear_env();
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("combat-core");
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

    let json = format!(
        r#"{{ "sample_pack": "combat-core@0.2.0", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let err = load_library(&config(&json), PackKind::SamplePack)
        .expect_err("an unversioned manifest cannot answer a pinned ref");
    assert!(err.contains("version"), "{err}");
}

#[test]
fn a_bare_name_ref_accepts_whatever_version_is_baked() {
    clear_env();
    // The image's own default palette names no version, so the baked pack's version
    // is whatever the image was built with.
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("combat-core");
    write_pack(&dir, "combat-core", "0.7.3", &["cannon"]);

    let json = format!(
        r#"{{ "sample_pack": "combat-core", "pack_dir": {:?} }}"#,
        dir.display().to_string()
    );
    let library = load_library(&config(&json), PackKind::SamplePack).expect("loads");
    assert_eq!(library.version(), Some("0.7.3"));
}
