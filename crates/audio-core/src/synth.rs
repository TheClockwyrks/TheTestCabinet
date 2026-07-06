//! The synthesis primitives: oscillators, seeded noise, amplitude envelopes, and the
//! per-voice modulation (pitch sweep, vibrato, arpeggio, FM) that turns a [`Voice`]
//! into a mono buffer.
//!
//! A voice is the audio analogue of a composited primitive: an oscillator or noise
//! source on the timeline, shaped by an envelope and modulation. Layering several
//! voices in time is how a complex sound (a gunshot's boom + crack + snap + tail) is
//! built. This module renders **one** voice; [`crate::sfx`] layers, effects, and mixes
//! them down.

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use crate::format::RenderParams;
use crate::rng::Prng;

/// An oscillator waveform (or noise).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
#[serde(rename_all = "lowercase")]
pub enum Wave {
    /// A pure sine — the smoothest tone, a sub-bass or a whistle.
    Sine,
    /// A square — hollow and buzzy, rich in odd harmonics.
    Square,
    /// A sawtooth — bright and full, rich in all harmonics.
    Saw,
    /// A triangle — soft and flute-like, gentle odd harmonics.
    Triangle,
    /// White noise — the seeded stochastic source (transients, wind, hiss).
    Noise,
}

impl Wave {
    /// Whether this waveform draws from the noise source (and so needs a PRNG).
    pub fn is_noise(self) -> bool {
        matches!(self, Wave::Noise)
    }

    /// The waveform's value at phase `theta` radians (unused for noise). The phase is
    /// normalized to one cycle, so a caller may accumulate an unbounded phase.
    pub fn sample(self, theta: f64) -> f64 {
        // Normalized phase in [0, 1).
        let p = (theta / (2.0 * PI)).rem_euclid(1.0);
        match self {
            Wave::Sine => (2.0 * PI * p).sin(),
            Wave::Square => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            Wave::Saw => 2.0 * p - 1.0,
            Wave::Triangle => 4.0 * (p - 0.5).abs() - 1.0,
            // Noise is handled by the renderer (it needs the PRNG), never here.
            Wave::Noise => 0.0,
        }
    }
}

/// A named amplitude-envelope preset — the alternative to an explicit ADSR, a single
/// gesture over the voice's whole duration (`set-envelope --env <curve>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
#[serde(rename_all = "kebab-case")]
pub enum EnvCurve {
    /// Full at the start, linear fall to silence — a simple decay.
    Linear,
    /// Instant attack, fast exponential decay — a pluck or an impact transient.
    Pluck,
    /// Slow rise and fall — a swell or a pad.
    Swell,
    /// Instant attack, a hard knee to a held body, then a tail — a punchy hit.
    Punch,
    /// A short rise, a flat held body, then a short fall — a gated blip.
    Gate,
}

impl EnvCurve {
    /// The envelope value at normalized progress `p` in `[0, 1]` across the voice.
    fn amplitude(self, p: f64) -> f64 {
        let p = p.clamp(0.0, 1.0);
        match self {
            EnvCurve::Linear => 1.0 - p,
            EnvCurve::Pluck => (-5.0 * p).exp(),
            EnvCurve::Swell => (PI * p).sin(),
            EnvCurve::Punch => {
                if p < 0.05 {
                    p / 0.05
                } else {
                    (-3.0 * (p - 0.05)).exp()
                }
            }
            EnvCurve::Gate => {
                if p < 0.1 {
                    p / 0.1
                } else if p < 0.85 {
                    1.0
                } else {
                    (1.0 - p) / 0.15
                }
            }
        }
    }
}

/// A voice's amplitude envelope: an explicit ADSR, or a named [`EnvCurve`] preset.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Envelope {
    /// The classic four-stage attack/decay/sustain/release envelope. `attack_ms`,
    /// `decay_ms`, `release_ms` are stage lengths; `sustain` is the held level in
    /// `[0, 1]`. The note is "held" for the voice's `dur`; `release` runs after it.
    Adsr {
        /// Attack length in ms (silence → full).
        attack_ms: f64,
        /// Decay length in ms (full → sustain).
        decay_ms: f64,
        /// The held level in `[0, 1]`.
        sustain: f64,
        /// Release length in ms (held level → silence), after note-off.
        release_ms: f64,
    },
    /// A named preset spanning the voice's whole duration.
    Curve(EnvCurve),
}

impl Default for Envelope {
    fn default() -> Envelope {
        // A gentle default: a short attack and release so a raw voice never clicks.
        Envelope::Adsr {
            attack_ms: 2.0,
            decay_ms: 0.0,
            sustain: 1.0,
            release_ms: 8.0,
        }
    }
}

impl Envelope {
    /// The total sounding length in ms for a note held `dur_ms` (ADSR adds its
    /// release tail; a curve spans exactly `dur_ms`).
    pub fn total_ms(&self, dur_ms: f64) -> f64 {
        match self {
            Envelope::Adsr { release_ms, .. } => dur_ms + release_ms.max(0.0),
            Envelope::Curve(_) => dur_ms,
        }
    }

    /// The envelope gain at `t_ms` after the voice's start, given the note is held
    /// for `dur_ms`. Zero before 0 and after the total length.
    pub fn amplitude(&self, t_ms: f64, dur_ms: f64) -> f64 {
        if t_ms < 0.0 {
            return 0.0;
        }
        match self {
            Envelope::Curve(curve) => {
                if dur_ms <= 0.0 || t_ms > dur_ms {
                    0.0
                } else {
                    curve.amplitude(t_ms / dur_ms)
                }
            }
            Envelope::Adsr {
                attack_ms,
                decay_ms,
                sustain,
                release_ms,
            } => {
                let a = attack_ms.max(0.0);
                let d = decay_ms.max(0.0);
                let s = sustain.clamp(0.0, 1.0);
                let r = release_ms.max(0.0);
                let held = |x: f64| -> f64 {
                    if x < a {
                        if a <= f64::EPSILON { 1.0 } else { x / a }
                    } else if x < a + d {
                        if d <= f64::EPSILON {
                            s
                        } else {
                            1.0 + (s - 1.0) * ((x - a) / d)
                        }
                    } else {
                        s
                    }
                };
                if t_ms <= dur_ms {
                    held(t_ms)
                } else {
                    let rt = t_ms - dur_ms;
                    if r <= f64::EPSILON || rt >= r {
                        0.0
                    } else {
                        held(dur_ms) * (1.0 - rt / r)
                    }
                }
            }
        }
    }
}

/// A linear pitch sweep: glide from the voice's base frequency to `to_hz` over
/// `over_ms`, then hold — a laser's fall or a boom's drop.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PitchSweep {
    /// The frequency in Hz the sweep ends at.
    pub to_hz: f64,
    /// The sweep length in ms.
    pub over_ms: f64,
}

/// Periodic pitch modulation: a vibrato (`rate_hz` cycles/sec, `depth_semitones`
/// peak deviation).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vibrato {
    /// Modulation rate in Hz.
    pub rate_hz: f64,
    /// Peak deviation in semitones.
    pub depth_semitones: f64,
}

/// Stepped pitch modulation: an arpeggio cycling `[0, depth/2, depth]` semitones at
/// `rate_hz` steps per second.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Arpeggio {
    /// Steps per second.
    pub rate_hz: f64,
    /// The top semitone of the arpeggio.
    pub depth_semitones: f64,
}

/// Frequency modulation: the carrier and modulator are ratios of the voice frequency,
/// and `index` is the modulation depth — for metallic and complex timbres.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Fm {
    /// The carrier frequency as a ratio of the voice frequency.
    pub carrier: f64,
    /// The modulator frequency as a ratio of the voice frequency.
    pub modulator: f64,
    /// The modulation index (depth).
    pub index: f64,
}

/// A single voice on the timeline: an oscillator or noise source, its placement
/// (`start_ms`, `dur_ms`), level (`gain_db`), stereo position (`pan`), envelope, and
/// modulation. Effects that process the voice live alongside it in [`crate::sfx`].
#[derive(Debug, Clone, PartialEq)]
pub struct Voice {
    /// The voice's name (its handle for later `set-*` / `add-*` operations).
    pub name: String,
    /// The oscillator waveform (or noise).
    pub wave: Wave,
    /// The base frequency in Hz (ignored for noise).
    pub freq: f64,
    /// The level in decibels (0 dB = unity).
    pub gain_db: f64,
    /// The stereo position in `[-1, 1]` (left … right); ignored for a mono render.
    pub pan: f64,
    /// The start offset in ms from the clip's origin.
    pub start_ms: f64,
    /// The note-held length in ms (the envelope may add a release tail).
    pub dur_ms: f64,
    /// The amplitude envelope.
    pub env: Envelope,
    /// An optional pitch sweep.
    pub pitch: Option<PitchSweep>,
    /// An optional vibrato.
    pub vibrato: Option<Vibrato>,
    /// An optional arpeggio.
    pub arpeggio: Option<Arpeggio>,
    /// Optional frequency modulation.
    pub fm: Option<Fm>,
}

impl Voice {
    /// A bare voice: a full-gain, centered oscillator with the default envelope.
    pub fn new(name: String, wave: Wave, freq: f64, gain_db: f64, start_ms: f64, dur_ms: f64) -> Voice {
        Voice {
            name,
            wave,
            freq,
            gain_db,
            pan: 0.0,
            start_ms,
            dur_ms,
            env: Envelope::default(),
            pitch: None,
            vibrato: None,
            arpeggio: None,
            fm: None,
        }
    }

    /// The last clip time (ms) this voice contributes to (start + sounding length).
    pub fn end_ms(&self) -> f64 {
        self.start_ms + self.env.total_ms(self.dur_ms)
    }

    /// The instantaneous base frequency at `t_ms` after the voice's start, applying
    /// the pitch sweep, vibrato, and arpeggio (but not FM, which shapes phase).
    fn frequency_at(&self, t_ms: f64) -> f64 {
        let mut f = self.freq;
        if let Some(sweep) = self.pitch {
            let frac = if sweep.over_ms <= f64::EPSILON {
                1.0
            } else {
                (t_ms / sweep.over_ms).clamp(0.0, 1.0)
            };
            f = self.freq + (sweep.to_hz - self.freq) * frac;
        }
        if let Some(v) = self.vibrato {
            let lfo = (2.0 * PI * v.rate_hz * t_ms / 1000.0).sin();
            f *= 2.0f64.powf((v.depth_semitones / 12.0) * lfo);
        }
        if let Some(a) = self.arpeggio {
            let step = ((t_ms / 1000.0) * a.rate_hz).floor() as i64;
            let offsets = [0.0, a.depth_semitones * 0.5, a.depth_semitones];
            let semi = offsets[(step.rem_euclid(3)) as usize];
            f *= 2.0f64.powf(semi / 12.0);
        }
        f.max(0.0)
    }

    /// Render this voice into a fresh mono buffer of `clip_samples` samples, placed at
    /// its start offset. `seed` is the derived per-voice noise seed (used only for a
    /// noise voice); a deterministic render passes the same seed every time.
    pub fn render(&self, params: &RenderParams, clip_samples: usize, seed: u64) -> Vec<f32> {
        let mut buf = vec![0.0f32; clip_samples];
        let sr = params.sample_rate as f64;
        let dt = 1.0 / sr;
        let start = (self.start_ms / 1000.0 * sr).round() as i64;
        let sound_ms = self.env.total_ms(self.dur_ms);
        let active = (sound_ms / 1000.0 * sr).ceil() as i64;
        let gain = 10.0f64.powf(self.gain_db / 20.0);
        let mut rng = Prng::new(seed);

        let mut phase_c = 0.0f64; // carrier phase (radians)
        let mut phase_m = 0.0f64; // FM modulator phase (radians)
        for n in 0..active {
            let idx = start + n;
            if idx < 0 {
                continue;
            }
            let idx = idx as usize;
            if idx >= clip_samples {
                break;
            }
            let t_ms = (n as f64) * dt * 1000.0;
            let f = self.frequency_at(t_ms);
            let env = self.env.amplitude(t_ms, self.dur_ms);
            let raw = if self.wave.is_noise() {
                rng.next_bipolar()
            } else if let Some(fm) = self.fm {
                let theta = phase_c + fm.index * phase_m.sin();
                phase_m += 2.0 * PI * f * fm.modulator * dt;
                self.wave.sample(theta)
            } else {
                self.wave.sample(phase_c)
            };
            // Advance the carrier phase at the (FM-scaled) carrier frequency.
            let carrier_ratio = self.fm.map(|fm| fm.carrier).unwrap_or(1.0);
            phase_c += 2.0 * PI * f * carrier_ratio * dt;
            buf[idx] += (raw * env * gain) as f32;
        }
        buf
    }
}

#[cfg(test)]
#[path = "synth.test.rs"]
mod tests;
