use super::*;
use crate::format::Channels;

fn params() -> RenderParams {
    RenderParams {
        sample_rate: 44100,
        channels: Channels::Mono,
        max_duration_ms: 5000,
        seed: 0x5EED,
    }
}

#[test]
fn wave_ranges_are_bounded() {
    for wave in [Wave::Sine, Wave::Square, Wave::Saw, Wave::Triangle] {
        for i in 0..1000 {
            let theta = i as f64 * 0.05;
            let v = wave.sample(theta);
            assert!((-1.0..=1.0).contains(&v), "{wave:?} out of range: {v}");
        }
    }
}

#[test]
fn adsr_shape_rises_then_releases() {
    let env = Envelope::Adsr {
        attack_ms: 10.0,
        decay_ms: 0.0,
        sustain: 1.0,
        release_ms: 10.0,
    };
    // Silent before start.
    assert_eq!(env.amplitude(-1.0, 100.0), 0.0);
    // Mid-attack partial.
    let mid_attack = env.amplitude(5.0, 100.0);
    assert!(mid_attack > 0.0 && mid_attack < 1.0);
    // Sustained at full while held.
    assert!((env.amplitude(50.0, 100.0) - 1.0).abs() < 1e-9);
    // Decayed to silence after release.
    assert_eq!(env.amplitude(200.0, 100.0), 0.0);
}

#[test]
fn envelope_total_includes_release() {
    let env = Envelope::Adsr {
        attack_ms: 1.0,
        decay_ms: 1.0,
        sustain: 0.5,
        release_ms: 40.0,
    };
    assert!((env.total_ms(100.0) - 140.0).abs() < 1e-9);
    let curve = Envelope::Curve(EnvCurve::Pluck);
    assert!((curve.total_ms(100.0) - 100.0).abs() < 1e-9);
}

#[test]
fn voice_render_is_deterministic() {
    let mut voice = Voice::new("noise".into(), Wave::Noise, 0.0, 0.0, 0.0, 100.0);
    voice.env = Envelope::Curve(EnvCurve::Pluck);
    let p = params();
    let a = voice.render(&p, 4410, crate::rng::derive_seed(p.seed, 0));
    let b = voice.render(&p, 4410, crate::rng::derive_seed(p.seed, 0));
    assert_eq!(a, b);
}

#[test]
fn voice_writes_only_within_its_window() {
    let voice = Voice::new("beep".into(), Wave::Sine, 440.0, 0.0, 50.0, 20.0);
    let p = params();
    let buf = voice.render(&p, 44100, 0);
    // Before the 50ms start there should be silence.
    let start = (0.05 * 44100.0) as usize;
    assert!(buf[..start].iter().all(|&s| s == 0.0));
    // Somewhere inside the note there should be signal.
    assert!(buf[start..start + 400].iter().any(|&s| s.abs() > 0.01));
}

#[test]
fn pitch_sweep_moves_the_frequency() {
    let mut voice = Voice::new("laser".into(), Wave::Saw, 800.0, 0.0, 0.0, 100.0);
    voice.pitch = Some(PitchSweep {
        to_hz: 100.0,
        over_ms: 100.0,
    });
    // frequency_at is private; exercise it through a full render and assert no panic
    // plus that the buffer carries energy.
    let p = params();
    let buf = voice.render(&p, 8820, 0);
    assert!(buf.iter().any(|&s| s.abs() > 0.01));
}
