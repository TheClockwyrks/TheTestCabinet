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
fn pack_ref_reads_the_config_alone() {
    // A palette is never inherited from the environment: a run reads the packs it was
    // staged with, and the config selects among those by ref.
    unsafe { std::env::set_var("TCAB_SAMPLE_PACK", "combat-core@0.2.0") };
    unsafe { std::env::set_var("TCAB_INSTRUMENT_BANK", "gm-lite@0.1.0") };
    let cfg: AudioConfig = serde_json::from_str(r#"{ "sample_pack": "naval@1.0.0" }"#).unwrap();
    assert_eq!(
        cfg.pack_ref(PackKind::SamplePack).as_deref(),
        Some("naval@1.0.0")
    );
    assert_eq!(cfg.pack_ref(PackKind::InstrumentBank), None);
}

#[test]
fn pack_ref_is_none_when_the_config_names_none() {
    // Every full-stack and game-jam run: the model writes its own config and names no
    // pack, which takes the staged default rather than an image's.
    let cfg: AudioConfig = serde_json::from_str("{}").unwrap();
    assert_eq!(cfg.pack_ref(PackKind::SamplePack), None);
    assert_eq!(cfg.pack_ref(PackKind::InstrumentBank), None);
}

#[test]
fn an_empty_ref_names_no_pack() {
    let cfg: AudioConfig = serde_json::from_str(r#"{ "sample_pack": "" }"#).unwrap();
    assert_eq!(cfg.pack_ref(PackKind::SamplePack), None);
}

#[test]
fn each_kind_reads_only_its_own_config_field() {
    let cfg: AudioConfig =
        serde_json::from_str(r#"{ "instrument_bank": "gm-lite@0.2.0" }"#).unwrap();
    assert_eq!(
        cfg.pack_ref(PackKind::InstrumentBank).as_deref(),
        Some("gm-lite@0.2.0")
    );
    assert_eq!(cfg.pack_ref(PackKind::SamplePack), None);
}
