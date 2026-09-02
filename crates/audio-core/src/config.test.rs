use super::*;

#[test]
fn defaults_fill_a_minimal_config() {
    let json = r#"{ "max_duration_ms": 3000, "channels": "mono" }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.sample_rate, 44100);
    assert_eq!(cfg.channels, Channels::Mono);
    assert_eq!(cfg.max_duration_ms, 3000);
    assert_eq!(cfg.actions, std::path::PathBuf::from("actions.json"));
    assert_eq!(cfg.wav, std::path::PathBuf::from("clip.wav"));
    assert!(cfg.live.is_none());
}

#[test]
fn render_params_pass_duration_through_unclamped() {
    let json = r#"{ "max_duration_ms": 99999 }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.render_params().max_duration_ms, 99999);
}

#[test]
fn parses_full_config_with_live_and_pack() {
    let json = r#"{
        "sample_rate": 22050,
        "channels": "stereo",
        "max_duration_ms": 5000,
        "seed": 42,
        "actions": "a.json",
        "preview": "p.png",
        "wav": "c.wav",
        "mid": "c.mid",
        "sample_pack": "naval-weapons@1",
        "pack_dir": "/packs/naval",
        "live": { "endpoint": "host.docker.internal:7000", "token": "abc" }
    }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.sample_rate, 22050);
    assert_eq!(cfg.seed, 42);
    assert_eq!(cfg.sample_pack.as_deref(), Some("naval-weapons@1"));
    assert_eq!(cfg.channel_count(), 2);
    let live = cfg.live.unwrap();
    assert_eq!(live.token, "abc");
}

#[test]
fn select_pack_dir_picks_the_named_subdir() {
    let root = tempfile::tempdir().unwrap();
    // An image bakes each palette as a per-name subdir carrying `pack.toml`.
    let cinematic = root.path().join("cinematic");
    std::fs::create_dir_all(&cinematic).unwrap();
    std::fs::write(cinematic.join("pack.toml"), "name = \"cinematic\"\n").unwrap();

    // `name@version` selects the `<root>/<name>` subdir.
    assert_eq!(
        select_pack_dir(root.path().to_path_buf(), "cinematic@0.2.0"),
        Ok(cinematic.clone())
    );
    // A bare name (no `@version`) also selects it.
    assert_eq!(
        select_pack_dir(root.path().to_path_buf(), "cinematic"),
        Ok(cinematic)
    );
}

#[test]
fn select_pack_dir_rejects_a_named_pack_with_no_subdir_of_its_own() {
    let root = tempfile::tempdir().unwrap();
    // The root itself carries a manifest AND holds a per-name palette. Neither may
    // stand in for the pack that was asked for.
    std::fs::write(root.path().join("pack.toml"), "name = \"combat-core\"\n").unwrap();
    let gm = root.path().join("gm-lite");
    std::fs::create_dir_all(&gm).unwrap();
    std::fs::write(gm.join("pack.toml"), "name = \"gm-lite\"\n").unwrap();

    let err = select_pack_dir(root.path().to_path_buf(), "cinematic@0.2.0")
        .expect_err("rejects an absent palette rather than serving the root's");
    assert!(err.contains("cinematic"), "{err}");
    // The message names what the image does carry.
    assert!(err.contains("gm-lite"), "{err}");
}

#[test]
fn select_pack_dir_rejects_a_named_pack_when_the_root_holds_nothing() {
    let root = tempfile::tempdir().unwrap();
    let err =
        select_pack_dir(root.path().to_path_buf(), "gm-lite").expect_err("rejects an empty root");
    assert!(err.contains("gm-lite"), "{err}");
}

#[test]
fn pack_ref_splits_into_name_and_version() {
    assert_eq!(pack_name("combat-core@0.2.0"), "combat-core");
    assert_eq!(pack_version("combat-core@0.2.0"), Some("0.2.0"));
    assert_eq!(pack_name("combat-core"), "combat-core");
    assert_eq!(pack_version("combat-core"), None);
    // A trailing `@` pins no version.
    assert_eq!(pack_version("combat-core@"), None);
}

#[test]
fn pack_ref_prefers_the_config_over_the_image_default() {
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK", "combat-core@0.2.0") };
    let cfg: AudioConfig = serde_json::from_str(r#"{ "sample_pack": "naval@1.0.0" }"#).unwrap();
    assert_eq!(
        cfg.pack_ref(PackKind::SamplePack).as_deref(),
        Some("naval@1.0.0")
    );
}

#[test]
fn pack_ref_falls_back_to_the_image_default_palette() {
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK", "combat-core") };
    unsafe { std::env::set_var("TCAB_INSTRUMENT_BANK", "gm-lite") };
    // A full-stack run authors its own config and names no palette.
    let cfg: AudioConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(
        cfg.pack_ref(PackKind::SamplePack).as_deref(),
        Some("combat-core")
    );
    assert_eq!(
        cfg.pack_ref(PackKind::InstrumentBank).as_deref(),
        Some("gm-lite")
    );
}

#[test]
fn pack_ref_is_none_without_a_config_field_or_an_image_default() {
    unsafe { std::env::remove_var("TCAB_SAMPLE_PACK") };
    unsafe { std::env::remove_var("TCAB_INSTRUMENT_BANK") };
    let cfg: AudioConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(cfg.pack_ref(PackKind::SamplePack), None);
    assert_eq!(cfg.pack_ref(PackKind::InstrumentBank), None);
}

#[test]
fn each_kind_reads_only_its_own_config_field() {
    unsafe { std::env::remove_var("TCAB_SAMPLE_PACK") };
    unsafe { std::env::remove_var("TCAB_INSTRUMENT_BANK") };
    let cfg: AudioConfig =
        serde_json::from_str(r#"{ "instrument_bank": "gm-lite@0.2.0" }"#).unwrap();
    assert_eq!(
        cfg.pack_ref(PackKind::InstrumentBank).as_deref(),
        Some("gm-lite@0.2.0")
    );
    assert_eq!(cfg.pack_ref(PackKind::SamplePack), None);
}

#[test]
fn resolve_pack_dir_is_none_when_no_palette_is_configured() {
    unsafe { std::env::remove_var("TCAB_SAMPLE_PACK") };
    let cfg: AudioConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(cfg.resolve_pack_dir(PackKind::SamplePack), Ok(None));
}

#[test]
fn resolve_pack_dir_prefers_the_explicit_directory() {
    let json = r#"{ "sample_pack": "combat-core@0.2.0", "pack_dir": "/packs/combat" }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    assert_eq!(
        cfg.resolve_pack_dir(PackKind::SamplePack),
        Ok(Some(std::path::PathBuf::from("/packs/combat")))
    );
}

#[test]
fn resolve_pack_dir_selects_the_named_bank_under_the_baked_root() {
    let root = tempfile::tempdir().unwrap();
    let cinematic = root.path().join("cinematic");
    std::fs::create_dir_all(&cinematic).unwrap();
    std::fs::write(cinematic.join("pack.toml"), "name = \"cinematic\"\n").unwrap();
    // nextest runs each test in its own process, so the env var is test-local.
    unsafe { std::env::set_var("TCAB_INSTRUMENT_BANK_DIR", root.path()) };

    let json = r#"{ "instrument_bank": "cinematic@0.2.0" }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    assert_eq!(
        cfg.resolve_pack_dir(PackKind::InstrumentBank),
        Ok(Some(cinematic))
    );
}

#[test]
fn resolve_pack_dir_selects_the_image_default_when_the_config_names_none() {
    let root = tempfile::tempdir().unwrap();
    let combat = root.path().join("combat-core");
    std::fs::create_dir_all(&combat).unwrap();
    std::fs::write(combat.join("pack.toml"), "name = \"combat-core\"\n").unwrap();
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK_DIR", root.path()) };
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK", "combat-core") };

    let cfg: AudioConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(cfg.resolve_pack_dir(PackKind::SamplePack), Ok(Some(combat)));
}

#[test]
fn resolve_pack_dir_reports_a_named_bank_the_image_does_not_bake() {
    let root = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var("TCAB_INSTRUMENT_BANK_DIR", root.path()) };

    let json = r#"{ "instrument_bank": "cinematic@0.2.0" }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    let err = cfg
        .resolve_pack_dir(PackKind::InstrumentBank)
        .expect_err("rejects an absent bank");
    assert!(err.contains("cinematic"), "{err}");
}

#[test]
fn resolve_pack_dir_reports_a_named_pack_with_no_baked_root() {
    unsafe { std::env::remove_var("TCAB_SAMPLE_PACK_DIR") };
    let json = r#"{ "sample_pack": "combat-core@0.2.0" }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    let err = cfg
        .resolve_pack_dir(PackKind::SamplePack)
        .expect_err("a named pack with nowhere to look is a failure");
    assert!(err.contains("TCAB_SAMPLE_PACK_DIR"), "{err}");
}

#[test]
fn select_pack_dir_rejects_a_ref_that_names_no_pack() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("pack.toml"), "name = \"combat-core\"\n").unwrap();

    let err = select_pack_dir(root.path().to_path_buf(), "@0.1.0")
        .expect_err("a version with no name selects nothing");
    assert!(err.contains("names no pack"), "{err}");
}
