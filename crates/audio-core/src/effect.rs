//! The processing effects: per-voice/bus filters and waveshaping, and the bus/master
//! reverb, delay, and compressor.
//!
//! Every effect is a pure function of its parameters and the mono buffer it runs over
//! (the mixer applies a stereo effect per channel), so an effect chain replayed from
//! the op log reproduces the same output. The filters recompute their coefficients
//! per sample to support a cutoff sweep; at a clip length of at most five seconds the
//! cost is irrelevant.

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use crate::format::RenderParams;

/// A filter's response shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
#[serde(rename_all = "lowercase")]
pub enum FilterType {
    /// Passes frequencies below the cutoff.
    Lowpass,
    /// Passes frequencies above the cutoff.
    Highpass,
    /// Passes a band around the cutoff.
    Bandpass,
}

/// A processing effect applied to a voice, a bus, or the master.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "effect", rename_all = "snake_case")]
pub enum Effect {
    /// A resonant `lowpass`/`highpass`/`bandpass` filter, with an optional cutoff
    /// sweep from `cutoff_hz` to `sweep_to_hz` over `over_ms`.
    Filter {
        /// The response shape.
        kind: FilterType,
        /// The initial cutoff frequency in Hz.
        cutoff_hz: f64,
        /// An optional cutoff to sweep toward.
        sweep_to_hz: Option<f64>,
        /// The sweep length in ms (used only when `sweep_to_hz` is set).
        over_ms: f64,
        /// Resonance (Q). Higher emphasizes the cutoff; ~0.707 is flat.
        resonance: f64,
    },
    /// Soft-clipping distortion (`tanh` waveshaping) for grit; `drive` is the pre-gain.
    Distortion {
        /// Pre-gain into the saturator (> 0).
        drive: f64,
    },
    /// Digital crush: quantize to `bits` and hold each sample at `rate_hz`.
    Bitcrush {
        /// Bit depth to quantize to (1..16).
        bits: u32,
        /// The reduced sample-and-hold rate in Hz.
        rate_hz: f64,
    },
    /// Ring modulation: multiply by a sine at `freq_hz` for inharmonic clangor.
    Ringmod {
        /// The modulator frequency in Hz.
        freq_hz: f64,
    },
    /// A Schroeder reverb. `size` (0..1) scales the tail length/feedback; `mix` is the
    /// wet/dry balance.
    Reverb {
        /// Room size / tail length in `[0, 1]`.
        size: f64,
        /// Wet/dry mix in `[0, 1]`.
        mix: f64,
    },
    /// A feedback delay. `time_ms` is the tap time, `feedback` the regeneration, `mix`
    /// the wet/dry balance.
    Delay {
        /// Delay time in ms.
        time_ms: f64,
        /// Feedback gain in `[0, 1)`.
        feedback: f64,
        /// Wet/dry mix in `[0, 1]`.
        mix: f64,
    },
    /// A peak compressor. Above `threshold_db` the signal is reduced by `ratio`.
    Compressor {
        /// The threshold in dB below 0.
        threshold_db: f64,
        /// The compression ratio (> 1).
        ratio: f64,
    },
}

impl Effect {
    /// Process `buf` in place at `params`' sample rate.
    pub fn process(&self, buf: &mut [f32], params: &RenderParams) {
        let sr = params.sample_rate as f64;
        match *self {
            Effect::Filter {
                kind,
                cutoff_hz,
                sweep_to_hz,
                over_ms,
                resonance,
            } => filter(buf, sr, kind, cutoff_hz, sweep_to_hz, over_ms, resonance),
            Effect::Distortion { drive } => distortion(buf, drive),
            Effect::Bitcrush { bits, rate_hz } => bitcrush(buf, sr, bits, rate_hz),
            Effect::Ringmod { freq_hz } => ringmod(buf, sr, freq_hz),
            Effect::Reverb { size, mix } => reverb(buf, sr, size, mix),
            Effect::Delay {
                time_ms,
                feedback,
                mix,
            } => delay(buf, sr, time_ms, feedback, mix),
            Effect::Compressor {
                threshold_db,
                ratio,
            } => compressor(buf, sr, threshold_db, ratio),
        }
    }
}

/// A state-variable (Chamberlin) filter with a per-sample cutoff sweep.
#[allow(clippy::too_many_arguments)]
fn filter(
    buf: &mut [f32],
    sr: f64,
    kind: FilterType,
    cutoff_hz: f64,
    sweep_to_hz: Option<f64>,
    over_ms: f64,
    resonance: f64,
) {
    let q = resonance.clamp(0.5, 20.0);
    let damp = (1.0 / q).clamp(0.0, 2.0);
    let sweep_samples = (over_ms / 1000.0 * sr).max(1.0);
    let (mut low, mut band) = (0.0f64, 0.0f64);
    for (i, s) in buf.iter_mut().enumerate() {
        let fc = match sweep_to_hz {
            Some(to) => {
                let frac = (i as f64 / sweep_samples).clamp(0.0, 1.0);
                cutoff_hz + (to - cutoff_hz) * frac
            }
            None => cutoff_hz,
        };
        let fc = fc.clamp(10.0, sr * 0.45);
        // f is bounded below 2 for stability given the cutoff clamp.
        let f = (2.0 * (PI * fc / sr).sin()).min(1.0);
        let input = *s as f64;
        low += f * band;
        let high = input - low - damp * band;
        band += f * high;
        let out = match kind {
            FilterType::Lowpass => low,
            FilterType::Highpass => high,
            FilterType::Bandpass => band,
        };
        *s = out as f32;
    }
}

/// Soft-clip saturation.
fn distortion(buf: &mut [f32], drive: f64) {
    let drive = drive.max(1e-3);
    let norm = drive.tanh();
    for s in buf.iter_mut() {
        let x = *s as f64;
        *s = ((x * drive).tanh() / norm) as f32;
    }
}

/// Bit-depth reduction plus sample-and-hold rate reduction.
fn bitcrush(buf: &mut [f32], sr: f64, bits: u32, rate_hz: f64) {
    let bits = bits.clamp(1, 16);
    // `2^bits` distinct quantization levels, i.e. `2^bits - 1` steps.
    let steps = ((1u32 << bits) - 1).max(1) as f64;
    let hold = ((sr / rate_hz.max(1.0)).round() as usize).max(1);
    let mut held = 0.0f32;
    for (i, s) in buf.iter_mut().enumerate() {
        if i % hold == 0 {
            let x = (*s as f64).clamp(-1.0, 1.0);
            let q = ((x * 0.5 + 0.5) * steps).round() / steps;
            held = (q * 2.0 - 1.0) as f32;
        }
        *s = held;
    }
}

/// Ring modulation by a sine.
fn ringmod(buf: &mut [f32], sr: f64, freq_hz: f64) {
    for (i, s) in buf.iter_mut().enumerate() {
        let m = (2.0 * PI * freq_hz * i as f64 / sr).sin();
        *s = (*s as f64 * m) as f32;
    }
}

/// A comb filter (used by the reverb).
fn comb(buf: &[f32], delay: usize, feedback: f64) -> Vec<f32> {
    let delay = delay.max(1);
    let mut out = vec![0.0f32; buf.len()];
    for i in 0..buf.len() {
        let fb = if i >= delay {
            out[i - delay] as f64 * feedback
        } else {
            0.0
        };
        out[i] = (buf[i] as f64 + fb) as f32;
    }
    out
}

/// An allpass filter (used by the reverb).
fn allpass(buf: &[f32], delay: usize, gain: f64) -> Vec<f32> {
    let delay = delay.max(1);
    let mut out = vec![0.0f32; buf.len()];
    for i in 0..buf.len() {
        let delayed_in = if i >= delay { buf[i - delay] as f64 } else { 0.0 };
        let delayed_out = if i >= delay { out[i - delay] as f64 } else { 0.0 };
        out[i] = (-gain * buf[i] as f64 + delayed_in + gain * delayed_out) as f32;
    }
    out
}

/// A Schroeder reverb: parallel combs into serial allpasses, mixed with the dry.
fn reverb(buf: &mut [f32], sr: f64, size: f64, mix: f64) {
    let size = size.clamp(0.0, 1.0);
    let mix = mix.clamp(0.0, 1.0);
    let fb = 0.7 + 0.28 * size;
    // Comb delays (ms), spread to avoid a metallic resonance.
    let comb_ms = [29.7, 37.1, 41.1, 43.7];
    let ap_ms = [5.0, 1.7];
    let mut wet = vec![0.0f32; buf.len()];
    for &ms in &comb_ms {
        let d = (ms / 1000.0 * sr * (0.5 + size)) as usize;
        let c = comb(buf, d, fb);
        for (w, cv) in wet.iter_mut().zip(c.iter()) {
            *w += cv * 0.25;
        }
    }
    for &ms in &ap_ms {
        let d = (ms / 1000.0 * sr) as usize;
        wet = allpass(&wet, d, 0.5);
    }
    for (s, w) in buf.iter_mut().zip(wet.iter()) {
        *s = (*s as f64 * (1.0 - mix) + *w as f64 * mix) as f32;
    }
}

/// A feedback delay line.
fn delay(buf: &mut [f32], sr: f64, time_ms: f64, feedback: f64, mix: f64) {
    let d = ((time_ms / 1000.0 * sr).round() as usize).max(1);
    let fb = feedback.clamp(0.0, 0.95);
    let mix = mix.clamp(0.0, 1.0);
    let mut wet = vec![0.0f32; buf.len()];
    for i in 0..buf.len() {
        let echo = if i >= d { wet[i - d] as f64 * fb } else { 0.0 };
        wet[i] = (buf[i] as f64 + echo) as f32;
    }
    for (s, w) in buf.iter_mut().zip(wet.iter()) {
        *s = (*s as f64 * (1.0 - mix) + *w as f64 * mix) as f32;
    }
}

/// A simple peak compressor with fixed attack/release smoothing.
fn compressor(buf: &mut [f32], sr: f64, threshold_db: f64, ratio: f64) {
    let ratio = ratio.max(1.0);
    let threshold = 10.0f64.powf(threshold_db / 20.0);
    // Envelope follower time constants.
    let atk = (-1.0 / (0.005 * sr)).exp();
    let rel = (-1.0 / (0.100 * sr)).exp();
    let mut env = 0.0f64;
    for s in buf.iter_mut() {
        let x = (*s as f64).abs();
        let coeff = if x > env { atk } else { rel };
        env = coeff * env + (1.0 - coeff) * x;
        let gain = if env > threshold && env > 0.0 {
            let over_db = 20.0 * (env / threshold).log10();
            let reduced_db = over_db * (1.0 / ratio - 1.0);
            10.0f64.powf(reduced_db / 20.0)
        } else {
            1.0
        };
        *s = (*s as f64 * gain) as f32;
    }
}

#[cfg(test)]
#[path = "effect.test.rs"]
mod tests;
