//! The `sfx-synth` / `sfx-sample` op model and the offline mixer.
//!
//! [`AudioOp`] is the recorded wire form of every sound-effect operation — the synth
//! voices, their envelope/pitch/modulation, the per-voice/bus effects, and (for
//! `sfx-sample`) the placed library samples. [`SfxProject::from_ops`] folds a log into
//! a structured project, and [`render_sfx`] mixes it down to interleaved PCM. The two
//! binaries share this one op set: `sfx-synth` simply never emits [`AudioOp::AddSample`]
//! (it has no library), while `sfx-sample` is the full superset.

use serde::{Deserialize, Serialize};

use crate::effect::{Effect, FilterType};
use crate::format::RenderParams;
use crate::rng::derive_seed;
use crate::sample::SampleLibrary;
use crate::synth::{Arpeggio, Envelope, EnvCurve, Fm, PitchSweep, Vibrato, Voice, Wave};

/// The target of a processing effect: a named synth voice, or a bus (`master`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Target {
    /// A synth voice, addressed by name.
    Voice(String),
    /// A bus (today only `master`), addressed by name.
    Bus(String),
}

/// One recorded sound-effect operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum AudioOp {
    /// Add an oscillator or noise voice to the timeline.
    AddVoice {
        /// The voice name (its handle for later operations).
        name: String,
        /// The waveform (or noise).
        wave: Wave,
        /// The base frequency in Hz (ignored for noise).
        #[serde(default)]
        freq: f64,
        /// The level in dB (0 = unity).
        #[serde(default)]
        gain: f64,
        /// The stereo position in `[-1, 1]`.
        #[serde(default)]
        pan: f64,
        /// The start offset in ms.
        #[serde(default)]
        start_ms: f64,
        /// The note-held length in ms.
        dur_ms: f64,
    },
    /// Set a voice's amplitude envelope, either an ADSR or a named curve.
    SetEnvelope {
        /// The voice to shape.
        voice: String,
        /// Attack length in ms (ADSR).
        #[serde(default)]
        attack_ms: Option<f64>,
        /// Decay length in ms (ADSR).
        #[serde(default)]
        decay_ms: Option<f64>,
        /// Sustain level in `[0, 1]` (ADSR).
        #[serde(default)]
        sustain: Option<f64>,
        /// Release length in ms (ADSR).
        #[serde(default)]
        release_ms: Option<f64>,
        /// A named envelope curve (the alternative to ADSR).
        #[serde(default)]
        env: Option<EnvCurve>,
    },
    /// A pitch sweep from the voice's base frequency to `slide_to_hz` over `over_ms`.
    SetPitch {
        /// The voice to sweep.
        voice: String,
        /// The frequency the sweep ends at.
        slide_to_hz: f64,
        /// The sweep length in ms.
        over_ms: f64,
    },
    /// Add a vibrato to a voice.
    AddVibrato {
        /// The voice to modulate.
        voice: String,
        /// Modulation rate in Hz.
        rate_hz: f64,
        /// Peak deviation in semitones.
        depth_semitones: f64,
    },
    /// Add an arpeggio to a voice.
    AddArpeggio {
        /// The voice to modulate.
        voice: String,
        /// Steps per second.
        rate_hz: f64,
        /// The top semitone of the arpeggio.
        depth_semitones: f64,
    },
    /// Add frequency modulation to a voice.
    AddFm {
        /// The voice to modulate.
        voice: String,
        /// The carrier ratio.
        carrier: f64,
        /// The modulator ratio.
        modulator: f64,
        /// The modulation index.
        index: f64,
    },
    /// Add a resonant filter to a voice or bus, with an optional cutoff sweep.
    AddFilter {
        /// The target voice or bus.
        target: Target,
        /// The response shape.
        kind: FilterType,
        /// The initial cutoff in Hz.
        cutoff_hz: f64,
        /// An optional cutoff to sweep toward.
        #[serde(default)]
        sweep_to_hz: Option<f64>,
        /// The sweep length in ms.
        #[serde(default)]
        over_ms: f64,
        /// Resonance (Q).
        #[serde(default = "default_resonance")]
        resonance: f64,
    },
    /// Add soft-clip distortion to a voice or bus.
    AddDistortion {
        /// The target voice or bus.
        target: Target,
        /// The pre-gain into the saturator.
        drive: f64,
    },
    /// Add a bitcrusher to a voice or bus.
    AddBitcrush {
        /// The target voice or bus.
        target: Target,
        /// Bit depth (1..16).
        bits: u32,
        /// The reduced sample-and-hold rate in Hz.
        rate_hz: f64,
    },
    /// Add ring modulation to a voice or bus.
    AddRingmod {
        /// The target voice or bus.
        target: Target,
        /// The modulator frequency in Hz.
        freq_hz: f64,
    },
    /// Add a reverb to a bus (typically `master`).
    AddReverb {
        /// The target bus.
        target: Target,
        /// Room size / tail length in `[0, 1]`.
        size: f64,
        /// Wet/dry mix in `[0, 1]`.
        mix: f64,
    },
    /// Add a feedback delay to a bus.
    AddDelay {
        /// The target bus.
        target: Target,
        /// Delay time in ms.
        time_ms: f64,
        /// Feedback gain in `[0, 1)`.
        feedback: f64,
        /// Wet/dry mix in `[0, 1]`.
        mix: f64,
    },
    /// Add a compressor to a bus.
    AddCompressor {
        /// The target bus.
        target: Target,
        /// The threshold in dB below 0.
        threshold_db: f64,
        /// The compression ratio.
        ratio: f64,
    },
    /// Place a library sample as a layer on the timeline (`sfx-sample` only).
    AddSample {
        /// The library sample's stable name.
        name: String,
        /// The placement time in ms.
        t_ms: f64,
        /// The level in dB.
        #[serde(default)]
        gain: f64,
        /// A pitch shift in semitones (also changes the layer's length).
        #[serde(default)]
        pitch: f64,
        /// Trim from the sample's start, in ms.
        #[serde(default)]
        trim_in_ms: Option<f64>,
        /// Trim from the sample's end (absolute offset from its start), in ms.
        #[serde(default)]
        trim_out_ms: Option<f64>,
        /// Fade-in length in ms.
        #[serde(default)]
        fade_in_ms: f64,
        /// Fade-out length in ms.
        #[serde(default)]
        fade_out_ms: f64,
        /// Play the layer backwards.
        #[serde(default)]
        reverse: bool,
    },
}

fn default_resonance() -> f64 {
    0.707
}

impl AudioOp {
    /// The wire tag of this operation, for the human-readable confirmation line.
    pub fn name(&self) -> &'static str {
        match self {
            AudioOp::AddVoice { .. } => "add_voice",
            AudioOp::SetEnvelope { .. } => "set_envelope",
            AudioOp::SetPitch { .. } => "set_pitch",
            AudioOp::AddVibrato { .. } => "add_vibrato",
            AudioOp::AddArpeggio { .. } => "add_arpeggio",
            AudioOp::AddFm { .. } => "add_fm",
            AudioOp::AddFilter { .. } => "add_filter",
            AudioOp::AddDistortion { .. } => "add_distortion",
            AudioOp::AddBitcrush { .. } => "add_bitcrush",
            AudioOp::AddRingmod { .. } => "add_ringmod",
            AudioOp::AddReverb { .. } => "add_reverb",
            AudioOp::AddDelay { .. } => "add_delay",
            AudioOp::AddCompressor { .. } => "add_compressor",
            AudioOp::AddSample { .. } => "add_sample",
        }
    }
}

/// A placed library sample layer.
#[derive(Debug, Clone, PartialEq)]
pub struct SamplePlacement {
    /// The library sample name.
    pub name: String,
    /// Placement time in ms.
    pub t_ms: f64,
    /// Level in dB.
    pub gain_db: f64,
    /// Pitch shift in semitones.
    pub pitch: f64,
    /// Trim in from the sample start (ms).
    pub trim_in_ms: Option<f64>,
    /// Trim out (absolute ms from the sample start).
    pub trim_out_ms: Option<f64>,
    /// Fade-in length (ms).
    pub fade_in_ms: f64,
    /// Fade-out length (ms).
    pub fade_out_ms: f64,
    /// Reverse the layer.
    pub reverse: bool,
}

impl SamplePlacement {
    /// The last clip time (ms) this layer contributes to, or `t_ms` if the sample is
    /// absent from the library.
    fn end_ms(&self, library: Option<&SampleLibrary>) -> f64 {
        let src_ms = library
            .and_then(|lib| lib.info(&self.name))
            .map(|e| e.duration_ms)
            .unwrap_or(0.0);
        let in_ms = self.trim_in_ms.unwrap_or(0.0);
        let out_ms = self.trim_out_ms.unwrap_or(src_ms).min(src_ms);
        let span = (out_ms - in_ms).max(0.0);
        let speed = 2.0f64.powf(self.pitch / 12.0);
        let played = if speed > 0.0 { span / speed } else { span };
        self.t_ms + played
    }

    /// Render this layer into a fresh mono buffer of `clip_samples` samples. Silence
    /// if the library is absent or the named sample is missing (a graceful degrade so
    /// runs pass without a baked pack).
    fn render(&self, params: &RenderParams, clip_samples: usize, library: Option<&SampleLibrary>) -> Vec<f32> {
        let mut out = vec![0.0f32; clip_samples];
        let Some(lib) = library else { return out };
        let Some(src) = lib.samples(&self.name) else {
            return out;
        };
        if src.is_empty() {
            return out;
        }
        let src_rate = lib.sample_rate() as f64;
        // Trim window in source samples.
        let in_s = self
            .trim_in_ms
            .map(|ms| (ms / 1000.0 * src_rate) as usize)
            .unwrap_or(0)
            .min(src.len());
        let out_s = self
            .trim_out_ms
            .map(|ms| (ms / 1000.0 * src_rate) as usize)
            .unwrap_or(src.len())
            .min(src.len());
        if out_s <= in_s {
            return out;
        }
        let window: Vec<f32> = if self.reverse {
            src[in_s..out_s].iter().rev().copied().collect()
        } else {
            src[in_s..out_s].to_vec()
        };
        // Resample window -> output rate, combining rate conversion and pitch.
        let speed = 2.0f64.powf(self.pitch / 12.0);
        let step = (src_rate / params.sample_rate as f64) * speed;
        let out_len = ((window.len() as f64) / step).floor() as usize;
        let gain = 10.0f64.powf(self.gain_db / 20.0);
        let start = (self.t_ms / 1000.0 * params.sample_rate as f64).round() as i64;
        let fade_in = self.fade_in_ms / 1000.0 * params.sample_rate as f64;
        let fade_out = self.fade_out_ms / 1000.0 * params.sample_rate as f64;
        for n in 0..out_len {
            let dst = start + n as i64;
            if dst < 0 {
                continue;
            }
            let dst = dst as usize;
            if dst >= clip_samples {
                break;
            }
            let src_pos = n as f64 * step;
            let i0 = src_pos.floor() as usize;
            let frac = src_pos - i0 as f64;
            let a = window.get(i0).copied().unwrap_or(0.0) as f64;
            let b = window.get(i0 + 1).copied().unwrap_or(0.0) as f64;
            let mut s = a + (b - a) * frac;
            // Fades.
            if fade_in > 0.0 && (n as f64) < fade_in {
                s *= n as f64 / fade_in;
            }
            let remaining = (out_len - n) as f64;
            if fade_out > 0.0 && remaining < fade_out {
                s *= remaining / fade_out;
            }
            out[dst] += (s * gain) as f32;
        }
        out
    }
}

/// A synth voice plus the per-voice effects applied to it, in order.
#[derive(Debug, Clone, PartialEq)]
struct VoiceSlot {
    voice: Voice,
    effects: Vec<Effect>,
}

/// A folded sound-effect project: the voices (with their per-voice effects), the
/// placed sample layers, and the master-bus effects.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SfxProject {
    voices: Vec<VoiceSlot>,
    samples: Vec<SamplePlacement>,
    master_fx: Vec<Effect>,
}

impl SfxProject {
    /// Fold an op log into a project. Operations that reference a missing voice are
    /// ignored (the render is total; a hostile or out-of-order log still runs).
    pub fn from_ops(ops: &[AudioOp]) -> SfxProject {
        let mut project = SfxProject::default();
        for op in ops {
            project.apply(op.clone());
        }
        project
    }

    fn voice_index(&self, name: &str) -> Option<usize> {
        self.voices.iter().position(|s| s.voice.name == name)
    }

    fn push_effect(&mut self, target: &Target, effect: Effect) {
        match target {
            Target::Voice(name) => {
                if let Some(i) = self.voice_index(name) {
                    self.voices[i].effects.push(effect);
                }
            }
            Target::Bus(_) => self.master_fx.push(effect),
        }
    }

    fn apply(&mut self, op: AudioOp) {
        match op {
            AudioOp::AddVoice {
                name,
                wave,
                freq,
                gain,
                pan,
                start_ms,
                dur_ms,
            } => {
                let mut voice = Voice::new(name.clone(), wave, freq, gain, start_ms, dur_ms);
                voice.pan = pan;
                match self.voice_index(&name) {
                    Some(i) => self.voices[i].voice = voice,
                    None => self.voices.push(VoiceSlot {
                        voice,
                        effects: Vec::new(),
                    }),
                }
            }
            AudioOp::SetEnvelope {
                voice,
                attack_ms,
                decay_ms,
                sustain,
                release_ms,
                env,
            } => {
                if let Some(i) = self.voice_index(&voice) {
                    self.voices[i].voice.env = match env {
                        Some(curve) => Envelope::Curve(curve),
                        None => Envelope::Adsr {
                            attack_ms: attack_ms.unwrap_or(2.0),
                            decay_ms: decay_ms.unwrap_or(0.0),
                            sustain: sustain.unwrap_or(1.0),
                            release_ms: release_ms.unwrap_or(8.0),
                        },
                    };
                }
            }
            AudioOp::SetPitch {
                voice,
                slide_to_hz,
                over_ms,
            } => {
                if let Some(i) = self.voice_index(&voice) {
                    self.voices[i].voice.pitch = Some(PitchSweep {
                        to_hz: slide_to_hz,
                        over_ms,
                    });
                }
            }
            AudioOp::AddVibrato {
                voice,
                rate_hz,
                depth_semitones,
            } => {
                if let Some(i) = self.voice_index(&voice) {
                    self.voices[i].voice.vibrato = Some(Vibrato {
                        rate_hz,
                        depth_semitones,
                    });
                }
            }
            AudioOp::AddArpeggio {
                voice,
                rate_hz,
                depth_semitones,
            } => {
                if let Some(i) = self.voice_index(&voice) {
                    self.voices[i].voice.arpeggio = Some(Arpeggio {
                        rate_hz,
                        depth_semitones,
                    });
                }
            }
            AudioOp::AddFm {
                voice,
                carrier,
                modulator,
                index,
            } => {
                if let Some(i) = self.voice_index(&voice) {
                    self.voices[i].voice.fm = Some(Fm {
                        carrier,
                        modulator,
                        index,
                    });
                }
            }
            AudioOp::AddFilter {
                target,
                kind,
                cutoff_hz,
                sweep_to_hz,
                over_ms,
                resonance,
            } => self.push_effect(
                &target,
                Effect::Filter {
                    kind,
                    cutoff_hz,
                    sweep_to_hz,
                    over_ms,
                    resonance,
                },
            ),
            AudioOp::AddDistortion { target, drive } => {
                self.push_effect(&target, Effect::Distortion { drive })
            }
            AudioOp::AddBitcrush {
                target,
                bits,
                rate_hz,
            } => self.push_effect(&target, Effect::Bitcrush { bits, rate_hz }),
            AudioOp::AddRingmod { target, freq_hz } => {
                self.push_effect(&target, Effect::Ringmod { freq_hz })
            }
            AudioOp::AddReverb { target, size, mix } => {
                self.push_effect(&target, Effect::Reverb { size, mix })
            }
            AudioOp::AddDelay {
                target,
                time_ms,
                feedback,
                mix,
            } => self.push_effect(
                &target,
                Effect::Delay {
                    time_ms,
                    feedback,
                    mix,
                },
            ),
            AudioOp::AddCompressor {
                target,
                threshold_db,
                ratio,
            } => self.push_effect(
                &target,
                Effect::Compressor {
                    threshold_db,
                    ratio,
                },
            ),
            AudioOp::AddSample {
                name,
                t_ms,
                gain,
                pitch,
                trim_in_ms,
                trim_out_ms,
                fade_in_ms,
                fade_out_ms,
                reverse,
            } => self.samples.push(SamplePlacement {
                name,
                t_ms,
                gain_db: gain,
                pitch,
                trim_in_ms,
                trim_out_ms,
                fade_in_ms,
                fade_out_ms,
                reverse,
            }),
        }
    }
}

/// Mix a folded project down to interleaved PCM at `params`. `library` supplies the
/// baked samples for any placed layers (pass `None` for a pure-synth render or when
/// no pack is baked — placed samples then contribute silence). Interleaved by channel;
/// for stereo, `[l0, r0, l1, r1, …]`.
pub fn render_sfx(project: &SfxProject, params: &RenderParams, library: Option<&SampleLibrary>) -> Vec<f32> {
    let chan = params.channels.count();
    // Clip length = the latest voice/sample end, capped at the format's max.
    let mut end_ms = 0.0f64;
    for slot in &project.voices {
        end_ms = end_ms.max(slot.voice.end_ms());
    }
    for s in &project.samples {
        end_ms = end_ms.max(s.end_ms(library));
    }
    let clip_samples = params
        .ms_to_samples(end_ms)
        .min(params.max_samples())
        .max(1);
    let mut mix = vec![0.0f32; clip_samples * chan];

    for (index, slot) in project.voices.iter().enumerate() {
        let seed = derive_seed(params.seed, index);
        let mut buf = slot.voice.render(params, clip_samples, seed);
        for fx in &slot.effects {
            fx.process(&mut buf, params);
        }
        pan_into(&mut mix, &buf, slot.voice.pan, params);
    }
    for s in &project.samples {
        let buf = s.render(params, clip_samples, library);
        // Samples are placed centered (add-sample carries no pan).
        pan_into(&mut mix, &buf, 0.0, params);
    }

    apply_master_fx(&mut mix, &project.master_fx, params);
    normalize_peak(&mut mix);
    mix
}

/// Add a mono voice/layer buffer into the interleaved mix at stereo position `pan`
/// (ignored for a mono render), using an equal-power pan law.
fn pan_into(mix: &mut [f32], mono: &[f32], pan: f64, params: &RenderParams) {
    match params.channels {
        crate::format::Channels::Mono => {
            for (m, s) in mix.iter_mut().zip(mono.iter()) {
                *m += *s;
            }
        }
        crate::format::Channels::Stereo => {
            let angle = (pan.clamp(-1.0, 1.0) + 1.0) * std::f64::consts::FRAC_PI_4;
            let lg = angle.cos() as f32;
            let rg = angle.sin() as f32;
            for (i, s) in mono.iter().enumerate() {
                mix[i * 2] += s * lg;
                mix[i * 2 + 1] += s * rg;
            }
        }
    }
}

/// Apply the master-bus effect chain, per channel.
fn apply_master_fx(mix: &mut [f32], effects: &[Effect], params: &RenderParams) {
    if effects.is_empty() {
        return;
    }
    let chan = params.channels.count();
    for c in 0..chan {
        let mut channel: Vec<f32> = mix.iter().skip(c).step_by(chan).copied().collect();
        for fx in effects {
            fx.process(&mut channel, params);
        }
        for (i, v) in channel.into_iter().enumerate() {
            mix[i * chan + c] = v;
        }
    }
}

/// If the mix's true peak exceeds unity, scale it down so it fits in `[-1, 1]`; a
/// deterministic limiter that only touches an over-unity mix and leaves a quiet mix
/// untouched.
fn normalize_peak(mix: &mut [f32]) {
    let peak = mix.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
    if peak > 1.0 {
        let g = 1.0 / peak;
        for s in mix.iter_mut() {
            *s *= g;
        }
    }
}

#[cfg(test)]
#[path = "sfx.test.rs"]
mod tests;
