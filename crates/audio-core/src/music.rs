//! The `music` op model, the offline sequencer render, and the `.mid` export.
//!
//! `music` is a symbolic sequencer: notes on instrument tracks over a tempo and
//! meter. [`MusicOp`] is the recorded wire form; [`MusicProject::from_ops`] folds a
//! log into tracks and notes; [`render_music`] synthesizes it to interleaved PCM
//! (each note is a synth voice, or — for a bank instrument — a pitched library
//! sample); and [`MusicProject::to_midi_score`] produces the portable `.mid` score.

use serde::{Deserialize, Serialize};

use crate::effect::Effect;
use crate::format::{Channels, RenderParams};
use crate::midi::{MidiNote, MidiScore, MidiTrack, TICKS_PER_QUARTER};
use crate::sample::SampleLibrary;
use crate::synth::{EnvCurve, Envelope, Voice, Wave};

/// The default tempo when a piece sets none.
pub const DEFAULT_BPM: u32 = 120;

/// One recorded sequencer operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum MusicOp {
    /// Set the piece's tempo.
    SetTempo {
        /// Beats per minute.
        bpm: u32,
    },
    /// Set the piece's time signature.
    SetTimeSignature {
        /// Beats per bar.
        num: u8,
        /// The beat unit (a power of two: 4 = quarter, 8 = eighth …).
        den: u8,
    },
    /// Define an instrument track (a synth waveform name, or a bank instrument name).
    DefineTrack {
        /// The track name (the handle notes and fx address).
        name: String,
        /// The instrument: a synth waveform (`sine`/`square`/`saw`/`triangle`) or a
        /// bank instrument name.
        instrument: String,
    },
    /// Add a note event to a track.
    AddNote {
        /// The track to add the note to.
        track: String,
        /// The MIDI key (0..127); the CLI parses `C4`-style names to this.
        pitch: u8,
        /// The start time in beats.
        t_beats: f64,
        /// The length in beats.
        dur_beats: f64,
        /// The velocity (1..127).
        #[serde(default = "default_velocity")]
        velocity: u8,
    },
    /// Set per-track processing.
    SetTrackFx {
        /// The track to process.
        track: String,
        /// A gain trim in dB.
        #[serde(default)]
        gain: Option<f64>,
        /// A stereo position in `[-1, 1]`.
        #[serde(default)]
        pan: Option<f64>,
        /// A reverb wet/dry mix in `[0, 1]`.
        #[serde(default)]
        reverb: Option<f64>,
        /// An amplitude-envelope preset for the track's notes.
        #[serde(default)]
        env: Option<EnvCurve>,
    },
}

fn default_velocity() -> u8 {
    100
}

impl MusicOp {
    /// The wire tag of this operation, for the human-readable confirmation line.
    pub fn name(&self) -> &'static str {
        match self {
            MusicOp::SetTempo { .. } => "set_tempo",
            MusicOp::SetTimeSignature { .. } => "set_time_signature",
            MusicOp::DefineTrack { .. } => "define_track",
            MusicOp::AddNote { .. } => "add_note",
            MusicOp::SetTrackFx { .. } => "set_track_fx",
        }
    }
}

/// A note within a folded track.
#[derive(Debug, Clone, PartialEq)]
struct Note {
    key: u8,
    t_beats: f64,
    dur_beats: f64,
    velocity: u8,
}

/// A folded instrument track.
#[derive(Debug, Clone, PartialEq)]
struct Track {
    name: String,
    instrument: String,
    notes: Vec<Note>,
    gain_db: f64,
    pan: f64,
    reverb: f64,
    env: Option<EnvCurve>,
}

/// A folded piece: tempo, meter, and instrument tracks.
#[derive(Debug, Clone, PartialEq)]
pub struct MusicProject {
    bpm: u32,
    num: u8,
    den: u8,
    tracks: Vec<Track>,
}

impl Default for MusicProject {
    fn default() -> MusicProject {
        MusicProject {
            bpm: DEFAULT_BPM,
            num: 4,
            den: 4,
            tracks: Vec::new(),
        }
    }
}

impl MusicProject {
    /// Fold an op log into a project. Notes/fx referencing a missing track are ignored
    /// (the render is total).
    pub fn from_ops(ops: &[MusicOp]) -> MusicProject {
        let mut project = MusicProject::default();
        for op in ops {
            project.apply(op.clone());
        }
        project
    }

    fn track_index(&self, name: &str) -> Option<usize> {
        self.tracks.iter().position(|t| t.name == name)
    }

    fn apply(&mut self, op: MusicOp) {
        match op {
            MusicOp::SetTempo { bpm } => self.bpm = bpm.max(1),
            MusicOp::SetTimeSignature { num, den } => {
                self.num = num.max(1);
                self.den = den.max(1);
            }
            MusicOp::DefineTrack { name, instrument } => match self.track_index(&name) {
                Some(i) => self.tracks[i].instrument = instrument,
                None => self.tracks.push(Track {
                    name,
                    instrument,
                    notes: Vec::new(),
                    gain_db: 0.0,
                    pan: 0.0,
                    reverb: 0.0,
                    env: None,
                }),
            },
            MusicOp::AddNote {
                track,
                pitch,
                t_beats,
                dur_beats,
                velocity,
            } => {
                if let Some(i) = self.track_index(&track) {
                    self.tracks[i].notes.push(Note {
                        key: pitch,
                        t_beats,
                        dur_beats,
                        velocity,
                    });
                }
            }
            MusicOp::SetTrackFx {
                track,
                gain,
                pan,
                reverb,
                env,
            } => {
                if let Some(i) = self.track_index(&track) {
                    if let Some(g) = gain {
                        self.tracks[i].gain_db = g;
                    }
                    if let Some(p) = pan {
                        self.tracks[i].pan = p;
                    }
                    if let Some(r) = reverb {
                        self.tracks[i].reverb = r;
                    }
                    if env.is_some() {
                        self.tracks[i].env = env;
                    }
                }
            }
        }
    }

    /// The length of one beat in milliseconds at the piece's tempo.
    fn beat_ms(&self) -> f64 {
        60_000.0 / self.bpm as f64
    }

    /// Build the portable MIDI score from the folded piece.
    pub fn to_midi_score(&self) -> MidiScore {
        let tracks = self
            .tracks
            .iter()
            .enumerate()
            .map(|(i, t)| MidiTrack {
                name: t.name.clone(),
                channel: (i as u8) & 0x0F,
                notes: t
                    .notes
                    .iter()
                    .map(|n| MidiNote {
                        key: n.key,
                        start_tick: (n.t_beats * TICKS_PER_QUARTER as f64).round() as u32,
                        dur_tick: (n.dur_beats * TICKS_PER_QUARTER as f64).round().max(1.0) as u32,
                        velocity: n.velocity,
                    })
                    .collect(),
            })
            .collect();
        MidiScore {
            bpm: self.bpm,
            num: self.num,
            den: self.den,
            tracks,
        }
    }

    /// The notes laid out for the piano-roll preview, plus the piece's total length in
    /// beats and its track count — everything the roll renderer needs without reaching
    /// into the private track/note types.
    pub fn piano_roll(&self) -> PianoRoll {
        let mut notes = Vec::new();
        let mut total_beats = 0.0f64;
        for (ti, track) in self.tracks.iter().enumerate() {
            for n in &track.notes {
                notes.push(PianoRollNote {
                    track: ti,
                    key: n.key,
                    start_beats: n.t_beats,
                    dur_beats: n.dur_beats,
                });
                total_beats = total_beats.max(n.t_beats + n.dur_beats);
            }
        }
        PianoRoll {
            notes,
            total_beats,
            tracks: self.tracks.len(),
        }
    }
}

/// A piece's notes laid out for the piano-roll preview.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PianoRoll {
    /// The note rectangles.
    pub notes: Vec<PianoRollNote>,
    /// The piece's total length in beats (the roll's horizontal extent).
    pub total_beats: f64,
    /// The number of tracks (for per-track coloring).
    pub tracks: usize,
}

/// One note rectangle in the piano-roll preview.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PianoRollNote {
    /// The owning track index (for coloring).
    pub track: usize,
    /// The MIDI key (vertical position).
    pub key: u8,
    /// The start time in beats (horizontal position).
    pub start_beats: f64,
    /// The length in beats (rectangle width).
    pub dur_beats: f64,
}

/// The MIDI-note frequency in Hz (A4 = key 69 = 440 Hz).
pub fn midi_to_hz(key: u8) -> f64 {
    440.0 * 2.0f64.powf((key as f64 - 69.0) / 12.0)
}

/// Parse a pitch as a MIDI number (`"60"`) or a note name (`"C4"`, `"F#3"`, `"Bb5"`).
/// Middle C (`C4`) is MIDI 60.
pub fn parse_pitch(s: &str) -> Result<u8, String> {
    let s = s.trim();
    if let Ok(n) = s.parse::<u8>() {
        return Ok(n);
    }
    let bytes: Vec<char> = s.chars().collect();
    if bytes.is_empty() {
        return Err(format!("empty pitch `{s}`"));
    }
    let letter = bytes[0].to_ascii_uppercase();
    let base = match letter {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return Err(format!("invalid note letter in `{s}`")),
    };
    let mut i = 1;
    let mut accidental: i32 = 0;
    while i < bytes.len() && (bytes[i] == '#' || bytes[i] == 'b') {
        accidental += if bytes[i] == '#' { 1 } else { -1 };
        i += 1;
    }
    let octave_str: String = bytes[i..].iter().collect();
    let octave: i32 = octave_str
        .parse()
        .map_err(|_| format!("invalid octave in `{s}`"))?;
    // C4 = 60 => midi = (octave + 1) * 12 + base + accidental.
    let midi = (octave + 1) * 12 + base + accidental;
    if !(0..=127).contains(&midi) {
        return Err(format!("pitch `{s}` is out of MIDI range"));
    }
    Ok(midi as u8)
}

/// Render the folded piece to interleaved PCM. `library` supplies bank instruments
/// (pass `None` — or leave it empty — to render bank instruments as a fallback synth).
pub fn render_music(
    project: &MusicProject,
    params: &RenderParams,
    library: Option<&SampleLibrary>,
) -> Vec<f32> {
    let chan = params.channels.count();
    let beat_ms = project.beat_ms();
    // Clip length = the latest note end, capped at the format max.
    let mut end_ms = 0.0f64;
    for t in &project.tracks {
        for n in &t.notes {
            let voice_env = track_env(t);
            let note_end = (n.t_beats + n.dur_beats) * beat_ms + voice_env.total_ms(0.0);
            end_ms = end_ms.max(note_end + release_pad(t));
        }
    }
    let clip_samples = params
        .ms_to_samples(end_ms)
        .min(params.max_samples())
        .max(1);
    let mut mix = vec![0.0f32; clip_samples * chan];

    for track in &project.tracks {
        let mut track_buf = vec![0.0f32; clip_samples];
        let env = track_env(track);
        let instrument = resolve_instrument(&track.instrument, library);
        for note in &track.notes {
            match &instrument {
                Instrument::Synth(wave) => {
                    let mut voice = Voice::new(
                        track.name.clone(),
                        *wave,
                        midi_to_hz(note.key),
                        velocity_db(note.velocity),
                        note.t_beats * beat_ms,
                        note.dur_beats * beat_ms,
                    );
                    voice.env = env;
                    let buf = voice.render(params, clip_samples, 0);
                    for (t, s) in track_buf.iter_mut().zip(buf.iter()) {
                        *t += *s;
                    }
                }
                Instrument::Sample(sampled) => {
                    sampled.render_note(&mut track_buf, note, env, beat_ms, params);
                }
            }
        }
        // Per-track reverb, then gain, then pan into the mix.
        if track.reverb > 0.0 {
            Effect::Reverb {
                size: 0.6,
                mix: track.reverb.clamp(0.0, 1.0),
            }
            .process(&mut track_buf, params);
        }
        let g = 10.0f64.powf(track.gain_db / 20.0) as f32;
        for s in track_buf.iter_mut() {
            *s *= g;
        }
        pan_into(&mut mix, &track_buf, track.pan, params);
    }
    normalize_peak(&mut mix);
    mix
}

/// The amplitude envelope for a track's notes: its preset, or a musical default.
fn track_env(track: &Track) -> Envelope {
    match track.env {
        Some(curve) => Envelope::Curve(curve),
        None => Envelope::Adsr {
            attack_ms: 5.0,
            decay_ms: 40.0,
            sustain: 0.7,
            release_ms: 120.0,
        },
    }
}

/// The tail padding (ms) a track's default envelope adds after a note is released.
fn release_pad(track: &Track) -> f64 {
    match track.env {
        Some(_) => 0.0,
        None => 120.0,
    }
}

/// A track's resolved instrument: a synth oscillator, or a bank sample played back
/// pitched (melodic) or at native rate (percussion).
enum Instrument {
    Synth(Wave),
    Sample(SampledInstrument),
}

/// A bank instrument loaded from the library: its mono PCM at the pack's own sample
/// rate, the MIDI note it was recorded at, and whether it transposes per note.
struct SampledInstrument {
    pcm: Vec<f32>,
    src_rate: f64,
    root_note: u8,
    pitched: bool,
}

/// Resolve an instrument name to a playable voice. A synth waveform name maps to that
/// oscillator; otherwise, if the name is a baked bank instrument, it plays that sample.
/// A bank instrument with no baked audio (an empty/absent library) falls back to a
/// mellow triangle, so a run still renders without a pack (a graceful degrade).
fn resolve_instrument(instrument: &str, library: Option<&SampleLibrary>) -> Instrument {
    match instrument.to_ascii_lowercase().as_str() {
        "sine" => return Instrument::Synth(Wave::Sine),
        "square" => return Instrument::Synth(Wave::Square),
        "saw" | "sawtooth" => return Instrument::Synth(Wave::Saw),
        "triangle" => return Instrument::Synth(Wave::Triangle),
        "noise" => return Instrument::Synth(Wave::Noise),
        _ => {}
    }
    match load_bank_instrument(instrument, library) {
        Some(sampled) => Instrument::Sample(sampled),
        None => Instrument::Synth(Wave::Triangle),
    }
}

/// Load a bank instrument's baked sample, or `None` if there is no library, no entry
/// named `instrument` (matched case-sensitively, as authored), or no baked audio.
fn load_bank_instrument(
    instrument: &str,
    library: Option<&SampleLibrary>,
) -> Option<SampledInstrument> {
    let lib = library?;
    let entry = lib.info(instrument)?;
    let pcm = lib.samples(instrument)?;
    if pcm.is_empty() {
        return None;
    }
    Some(SampledInstrument {
        pcm,
        src_rate: lib.sample_rate() as f64,
        root_note: entry.root_note,
        pitched: entry.pitched,
    })
}

impl SampledInstrument {
    /// Mix one note into `track_buf`. The source is linearly resampled, combining the
    /// pack→render rate conversion with a per-note pitch shift of
    /// `2^((key - root_note)/12)` for a melodic instrument (native rate for
    /// percussion). A melodic note is shaped by the track envelope and honors the note
    /// length (plus the envelope's release tail); an unpitched one-shot plays in full
    /// with only a short end fade to avoid a click. Note velocity scales the level.
    fn render_note(
        &self,
        track_buf: &mut [f32],
        note: &Note,
        env: Envelope,
        beat_ms: f64,
        params: &RenderParams,
    ) {
        let render_rate = params.sample_rate as f64;
        let speed = if self.pitched {
            2.0f64.powf((note.key as f64 - self.root_note as f64) / 12.0)
        } else {
            1.0
        };
        let step = (self.src_rate / render_rate) * speed;
        if step <= 0.0 {
            return;
        }
        let dur_ms = note.dur_beats * beat_ms;
        let start = (note.t_beats * beat_ms / 1000.0 * render_rate).round() as i64;
        let gain = 10.0f64.powf(velocity_db(note.velocity) / 20.0);

        // How many output samples the resampled source spans.
        let src_out_len = ((self.pcm.len() as f64) / step).floor() as usize;
        // Pitched voices stop at the note's end (envelope release included); an
        // unpitched drum hit plays its whole one-shot regardless of note length.
        let out_len = if self.pitched {
            let env_len = (env.total_ms(dur_ms) / 1000.0 * render_rate).ceil() as usize;
            src_out_len.min(env_len.max(1))
        } else {
            src_out_len
        };

        for n in 0..out_len {
            let dst = start + n as i64;
            if dst < 0 {
                continue;
            }
            let dst = dst as usize;
            if dst >= track_buf.len() {
                break;
            }
            let src_pos = n as f64 * step;
            let i0 = src_pos.floor() as usize;
            let frac = src_pos - i0 as f64;
            let a = self.pcm.get(i0).copied().unwrap_or(0.0) as f64;
            let b = self.pcm.get(i0 + 1).copied().unwrap_or(0.0) as f64;
            let s = a + (b - a) * frac;
            let amp = if self.pitched {
                env.amplitude(n as f64 / render_rate * 1000.0, dur_ms)
            } else {
                declick(n, out_len, render_rate)
            };
            track_buf[dst] += (s * amp * gain) as f32;
        }
    }
}

/// A unity gain that ramps to zero over the last ~5 ms of a played one-shot, so a
/// truncated or hot percussion sample does not end on a click. `n` is the output
/// index and `len` the total number of samples played.
fn declick(n: usize, len: usize, rate: f64) -> f64 {
    let fade = (0.005 * rate) as usize;
    if fade == 0 || len <= fade {
        return 1.0;
    }
    let from_end = len - 1 - n;
    if from_end >= fade {
        1.0
    } else {
        from_end as f64 / fade as f64
    }
}

/// Map a MIDI velocity to a gain in dB (127 = ~unity, quieter velocities attenuate).
fn velocity_db(velocity: u8) -> f64 {
    let v = velocity.clamp(1, 127) as f64 / 127.0;
    20.0 * v.log10()
}

/// Add a mono track buffer into the interleaved mix at stereo position `pan`.
fn pan_into(mix: &mut [f32], mono: &[f32], pan: f64, params: &RenderParams) {
    match params.channels {
        Channels::Mono => {
            for (m, s) in mix.iter_mut().zip(mono.iter()) {
                *m += *s;
            }
        }
        Channels::Stereo => {
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

/// True-peak limiter: scale an over-unity mix down into `[-1, 1]`, leave a quiet mix
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
#[path = "music.test.rs"]
mod tests;
