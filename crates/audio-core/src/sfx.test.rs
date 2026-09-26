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
    let a = render_sfx(&project, &p, None).expect("renders");
    let b = render_sfx(&project, &p, None).expect("renders");
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
    let mix = render_sfx(&project, &p, None).expect("renders");
    assert_eq!(mix.len() % 2, 0);
    assert!(mix.iter().any(|&s| s.abs() > 0.001));
}

#[test]
fn mono_render_is_single_channel_length() {
    let project = SfxProject::from_ops(&gunshot_ops());
    let p = params(Channels::Mono);
    let mix = render_sfx(&project, &p, None).expect("renders");
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
    let mix = render_sfx(&project, &params(Channels::Stereo), None).expect("renders");
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
    let mix = render_sfx(&project, &p, None).expect("renders");
    assert_eq!(mix.len(), 2 * 44100); // 2s mono
}

// --- Placed library samples -------------------------------------------------------

use crate::sample::{SampleEntry, SampleLibrary};

/// A one-sample library on disk holding a 200 ms tone named `cannon`.
fn library(tag: &str) -> SampleLibrary {
    let dir = std::env::temp_dir().join(format!("tcab_sfx_{}_{}", std::process::id(), tag));
    std::fs::create_dir_all(&dir).unwrap();
    let rate = 44100.0;
    let n = (0.2 * rate) as usize;
    let samples: Vec<f32> = (0..n)
        .map(|i| (std::f64::consts::TAU * 120.0 * i as f64 / rate).sin() as f32 * 0.8)
        .collect();
    std::fs::write(
        dir.join("cannon.wav"),
        crate::wav::encode_pcm16(&samples, 44100, 1),
    )
    .unwrap();
    let entries = vec![SampleEntry {
        name: "cannon".into(),
        tags: vec!["explosion".into()],
        duration_ms: 200.0,
        description: "a cannon body".into(),
        file: Some("cannon.wav".into()),
        root_note: 60,
        pitched: true,
    }];
    SampleLibrary::from_entries(entries, Some(dir), 44100)
}

fn placed(name: &str) -> SfxProject {
    SfxProject::from_ops(&[AudioOp::AddSample {
        name: name.into(),
        t_ms: 0.0,
        gain: 0.0,
        pitch: 0.0,
        trim_in_ms: None,
        trim_out_ms: None,
        fade_in_ms: 0.0,
        fade_out_ms: 0.0,
        reverse: false,
    }])
}

#[test]
fn placed_sample_renders_from_the_library() {
    let lib = library("place");
    let mix =
        render_sfx(&placed("cannon"), &params(Channels::Stereo), Some(&lib)).expect("renders");
    assert!(
        mix.iter().any(|&s| s.abs() > 1e-3),
        "placed layer was silent"
    );
}

#[test]
fn placed_sample_missing_from_the_library_is_an_error() {
    let lib = library("missing");
    let err = render_sfx(&placed("howitzer"), &params(Channels::Stereo), Some(&lib))
        .expect_err("a sample the library does not carry is a failure");
    assert!(err.contains("howitzer"), "{err}");
}

#[test]
fn placed_sample_without_a_library_is_an_error() {
    let err = render_sfx(&placed("cannon"), &params(Channels::Stereo), None)
        .expect_err("placing a sample with no library is a failure");
    assert!(err.contains("cannon"), "{err}");
}
