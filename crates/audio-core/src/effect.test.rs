use super::*;
use crate::format::Channels;

fn params() -> RenderParams {
    RenderParams {
        sample_rate: 44100,
        channels: Channels::Mono,
        max_duration_ms: 5000,
        seed: 1,
    }
}

fn tone(freq: f64, n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / 44100.0).sin() as f32)
        .collect()
}

fn rms(buf: &[f32]) -> f64 {
    let s: f64 = buf.iter().map(|&x| x as f64 * x as f64).sum();
    (s / buf.len() as f64).sqrt()
}

#[test]
fn lowpass_attenuates_high_tone_more_than_low() {
    let p = params();
    let mut low = tone(200.0, 8192);
    let mut high = tone(12000.0, 8192);
    let f = Effect::Filter {
        kind: FilterType::Lowpass,
        cutoff_hz: 800.0,
        sweep_to_hz: None,
        over_ms: 0.0,
        resonance: 0.707,
    };
    f.process(&mut low, &p);
    f.process(&mut high, &p);
    assert!(
        rms(&low) > rms(&high) * 2.0,
        "low={} high={}",
        rms(&low),
        rms(&high)
    );
}

#[test]
fn distortion_stays_bounded() {
    let p = params();
    let mut buf = tone(440.0, 4096);
    Effect::Distortion { drive: 10.0 }.process(&mut buf, &p);
    assert!(buf.iter().all(|&s| (-1.01..=1.01).contains(&s)));
}

#[test]
fn bitcrush_quantizes_to_few_levels() {
    let p = params();
    let mut buf = tone(440.0, 2048);
    Effect::Bitcrush {
        bits: 2,
        rate_hz: 44100.0,
    }
    .process(&mut buf, &p);
    let mut levels: Vec<i64> = buf.iter().map(|&s| (s * 1000.0).round() as i64).collect();
    levels.sort_unstable();
    levels.dedup();
    // 2 bits => at most 4 distinct levels.
    assert!(levels.len() <= 4, "got {} levels", levels.len());
}

#[test]
fn delay_produces_an_echo() {
    let p = params();
    let mut buf = vec![0.0f32; 44100];
    buf[0] = 1.0;
    Effect::Delay {
        time_ms: 100.0,
        feedback: 0.5,
        mix: 0.5,
    }
    .process(&mut buf, &p);
    let d = (0.1 * 44100.0) as usize;
    assert!(buf[d].abs() > 0.1, "expected echo at {d}");
}

#[test]
fn reverb_adds_a_tail() {
    let p = params();
    let mut buf = vec![0.0f32; 44100];
    for s in buf.iter_mut().take(100) {
        *s = 1.0;
    }
    Effect::Reverb {
        size: 0.8,
        mix: 0.5,
    }
    .process(&mut buf, &p);
    // Energy should persist well past the initial 100-sample burst.
    assert!(buf[20000..].iter().any(|&s| s.abs() > 1e-4));
}

#[test]
fn compressor_reduces_a_loud_signal() {
    let p = params();
    let mut buf: Vec<f32> = tone(440.0, 8192).iter().map(|&s| s * 0.9).collect();
    let before = rms(&buf);
    Effect::Compressor {
        threshold_db: -24.0,
        ratio: 8.0,
    }
    .process(&mut buf, &p);
    assert!(rms(&buf) < before);
}
