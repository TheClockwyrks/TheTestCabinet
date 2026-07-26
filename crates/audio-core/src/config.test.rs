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
fn select_pack_dir_picks_the_named_subdir_when_present() {
    let root = tempfile::tempdir().unwrap();
    // A multi-bank image bakes each bank as a per-name subdir carrying `pack.toml`.
    let cinematic = root.path().join("cinematic");
    std::fs::create_dir_all(&cinematic).unwrap();
    std::fs::write(cinematic.join("pack.toml"), "name = \"cinematic\"\n").unwrap();

    // `name@version` selects the `<root>/<name>` subdir.
    assert_eq!(
        select_pack_dir(root.path().to_path_buf(), Some("cinematic@0.1.0")),
        cinematic
    );
    // A bare name (no `@version`) also selects it.
    assert_eq!(
        select_pack_dir(root.path().to_path_buf(), Some("cinematic")),
        cinematic
    );
}

#[test]
fn select_pack_dir_falls_back_to_root_for_a_single_palette_image() {
    let root = tempfile::tempdir().unwrap();
    // Original single-bank layout: the pack.toml sits directly at the root, no subdir.
    std::fs::write(root.path().join("pack.toml"), "name = \"gm-lite\"\n").unwrap();

    // A requested bank with no matching subdir resolves to the root itself.
    assert_eq!(
        select_pack_dir(root.path().to_path_buf(), Some("gm-lite@0.1.0")),
        root.path()
    );
    // No name at all -> the root.
    assert_eq!(
        select_pack_dir(root.path().to_path_buf(), None),
        root.path()
    );
}
