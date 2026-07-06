use super::*;
use crate::format::Channels;

fn params(channels: Channels) -> RenderParams {
    RenderParams {
        sample_rate: 44100,
        channels,
        max_duration_ms: 5000,
        seed: 0x5EED,
    }
}

fn gunshot_ops() -> Vec<AudioOp> {
    vec![
        AudioOp::AddVoice {
            name: "boom".into(),
            wave: Wave::Sine,
            freq: 120.0,
            gain: -3.0,
            pan: 0.0,
            start_ms: 0.0,
            dur_ms: 220.0,
        },
        AudioOp::SetEnvelope {
            voice: "boom".into(),
            attack_ms: Some(1.0),
            decay_ms: Some(60.0),
            sustain: Some(0.2),
            release_ms: Some(140.0),
            env: None,
        },
        AudioOp::SetPitch {
            voice: "boom".into(),
            slide_to_hz: 40.0,
            over_ms: 180.0,
        },
        AudioOp::AddVoice {
            name: "crack".into(),
            wave: Wave::Noise,
            freq: 0.0,
            gain: -6.0,
            pan: 0.0,
            start_ms: 0.0,
            dur_ms: 40.0,
        },
        AudioOp::AddFilter {
            target: Target::Voice("crack".into()),
            kind: FilterType::Highpass,
            cutoff_hz: 2000.0,
            sweep_to_hz: None,
            over_ms: 0.0,
            resonance: 0.707,
        },
    ]
}

#[test]
fn json_round_trips() {
    let ops = gunshot_ops();
    let json = serde_json::to_string_pretty(&ops).unwrap();
    let back: Vec<AudioOp> = serde_json::from_str(&json).unwrap();
    assert_eq!(ops, back);
}

#[test]
fn render_is_byte_stable() {
    let ops = gunshot_ops();
    let project = SfxProject::from_ops(&ops);
    let p = params(Channels::Stereo);
    let a = render_sfx(&project, &p, None);
    let b = render_sfx(&project, &p, None);
    assert_eq!(a, b, "deterministic render must be byte-identical");
    // Encoded WAV is likewise stable.
    let wa = crate::wav::encode_pcm16(&a, p.sample_rate, 2);
    let wb = crate::wav::encode_pcm16(&b, p.sample_rate, 2);
    assert_eq!(wa, wb);
}

#[test]
fn stereo_has_two_interleaved_channels() {
    let project = SfxProject::from_ops(&gunshot_ops());
    let p = params(Channels::Stereo);
    let mix = render_sfx(&project, &p, None);
    assert_eq!(mix.len() % 2, 0);
    assert!(mix.iter().any(|&s| s.abs() > 0.001));
}

#[test]
fn mono_render_is_single_channel_length() {
    let project = SfxProject::from_ops(&gunshot_ops());
    let p = params(Channels::Mono);
    let mix = render_sfx(&project, &p, None);
    // ~360ms of audio at 44100 -> well under the 5s cap, and non-empty.
    assert!(mix.len() > 1000 && mix.len() < 44100 * 5);
}

#[test]
fn render_is_bounded_to_unity() {
    // Stack loud voices; the limiter must keep the mix within [-1, 1].
    let ops = vec![
        AudioOp::AddVoice {
            name: "a".into(),
            wave: Wave::Square,
            freq: 100.0,
            gain: 6.0,
            pan: 0.0,
            start_ms: 0.0,
            dur_ms: 200.0,
        },
        AudioOp::AddVoice {
            name: "b".into(),
            wave: Wave::Saw,
            freq: 150.0,
            gain: 6.0,
            pan: 0.0,
            start_ms: 0.0,
            dur_ms: 200.0,
        },
    ];
    let project = SfxProject::from_ops(&ops);
    let mix = render_sfx(&project, &params(Channels::Stereo), None);
    assert!(mix.iter().all(|&s| (-1.0001..=1.0001).contains(&s)));
}

#[test]
fn length_is_capped_at_max_duration() {
    let ops = vec![AudioOp::AddVoice {
        name: "long".into(),
        wave: Wave::Sine,
        freq: 200.0,
        gain: 0.0,
        pan: 0.0,
        start_ms: 0.0,
        dur_ms: 20000.0, // 20s, far over the cap
    }];
    let project = SfxProject::from_ops(&ops);
    let p = RenderParams {
        sample_rate: 44100,
        channels: Channels::Mono,
        max_duration_ms: 2000,
        seed: 1,
    };
    let mix = render_sfx(&project, &p, None);
    assert_eq!(mix.len(), 2 * 44100); // 2s mono
}

#[test]
fn placed_sample_without_library_is_silent_but_present() {
    let ops = vec![AudioOp::AddSample {
        name: "cannon".into(),
        t_ms: 0.0,
        gain: 0.0,
        pitch: 0.0,
        trim_in_ms: None,
        trim_out_ms: None,
        fade_in_ms: 0.0,
        fade_out_ms: 0.0,
        reverse: false,
    }];
    let project = SfxProject::from_ops(&ops);
    // No voices and no library: a minimal non-empty silent clip, no panic.
    let mix = render_sfx(&project, &params(Channels::Stereo), None);
    assert!(!mix.is_empty());
}
