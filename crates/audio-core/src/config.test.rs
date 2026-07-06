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
fn render_params_clamp_duration_to_ceiling() {
    let json = r#"{ "max_duration_ms": 99999 }"#;
    let cfg: AudioConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.render_params().max_duration_ms, 5000);
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
