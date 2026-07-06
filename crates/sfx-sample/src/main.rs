//! The `sfx-sample` CLI: layered multitrack mixing over a baked sample library, plus
//! the full `sfx-synth` voice vocabulary for glue — the game-audio-DAW tier.
//!
//! `sfx-sample` is a **capability superset of `sfx-synth`**: it carries every synth
//! voice/envelope/pitch/modulation/effect operation and adds `list-samples` /
//! `sample-info` (browse the baked library by name/tags/duration/description) and
//! `add-sample` (place a library clip as a layer). Like `sfx-synth`, an authoring
//! operation **only records**; `render` mixes the log down to the `.wav` and draws the
//! preview. The `list-samples` / `sample-info` browse commands query the library and
//! record nothing. See
//! `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_audio_core::clap_ext;
use test_cabinet_audio_core::config::{self, AudioConfig};
use test_cabinet_audio_core::effect::FilterType;
use test_cabinet_audio_core::record;
use test_cabinet_audio_core::runner;
use test_cabinet_audio_core::sfx::{AudioOp, Target};
use test_cabinet_audio_core::synth::{EnvCurve, Wave};

/// The sample-library sound-effect tool for audio asset-generation cases.
#[derive(Parser)]
#[command(
    name = "sfx-sample",
    about = "Mix a sound effect over a sample library, one operation at a time."
)]
struct Cli {
    /// Path to the seeded config JSON (`sample_rate`, `channels`, `max_duration_ms`,
    /// the fixed `seed`, the sample-pack name/dir, and the log / preview / `.wav`
    /// paths, plus an optional `live` block). Read by `init`, every operation,
    /// `render`, and the browse commands.
    #[arg(long, default_value = "sfx-sample.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write an empty op log; renders nothing. A run starts pre-seeded.
    Init,
    /// List the baked library samples (optionally filtered by `--tag`), reading each
    /// sample's stable name, tags, duration, and description. Records nothing.
    ListSamples {
        /// Only samples carrying this tag.
        #[arg(long)]
        tag: Option<String>,
    },
    /// Print one library sample's name, tags, duration, and description. Records nothing.
    SampleInfo {
        /// The sample name.
        #[arg(long)]
        name: String,
    },
    /// Place a library sample as a layer on the timeline.
    AddSample(AddSampleArgs),
    /// Add an oscillator or noise voice (glue/sweetener) to the timeline.
    AddVoice(AddVoiceArgs),
    /// Set a voice's amplitude envelope: an ADSR, or a named `--env` curve.
    SetEnvelope(SetEnvelopeArgs),
    /// Add a pitch sweep to a voice (glide to `--slide-to` over `--over` ms).
    SetPitch(SetPitchArgs),
    /// Add a vibrato (periodic pitch wobble) to a voice.
    AddVibrato(ModArgs),
    /// Add an arpeggio (stepped pitch pattern) to a voice.
    AddArpeggio(ModArgs),
    /// Add frequency modulation to a voice.
    AddFm(FmArgs),
    /// Add a resonant filter to a voice or bus, with an optional cutoff sweep.
    AddFilter(FilterArgs),
    /// Add soft-clip distortion to a voice or bus.
    AddDistortion(DistortionArgs),
    /// Add a bitcrusher to a voice or bus.
    AddBitcrush(BitcrushArgs),
    /// Add ring modulation to a voice or bus.
    AddRingmod(RingmodArgs),
    /// Add a reverb to a bus (typically `master`).
    AddReverb(ReverbArgs),
    /// Add a feedback delay to a bus.
    AddDelay(DelayArgs),
    /// Add a compressor to a bus.
    AddCompressor(CompressorArgs),
    /// Mix the recorded samples, voices, and effects down to the `.wav` and draw the
    /// preview.
    Render,
}

#[derive(clap::Args)]
struct AddSampleArgs {
    /// The library sample's stable name (browse with `list-samples`).
    #[arg(long)]
    name: String,
    /// The placement time in ms.
    #[arg(long)]
    t: f64,
    /// The level in decibels.
    #[arg(long, default_value_t = 0.0)]
    gain: f64,
    /// A pitch shift in semitones (also changes the layer's length).
    #[arg(long, default_value_t = 0.0)]
    pitch: f64,
    /// Trim the layer to `in,out` milliseconds of the source (from its start).
    #[arg(long, value_parser = parse_trim)]
    trim: Option<(f64, f64)>,
    /// Fade-in length in ms.
    #[arg(long, default_value_t = 0.0)]
    fade_in: f64,
    /// Fade-out length in ms.
    #[arg(long, default_value_t = 0.0)]
    fade_out: f64,
    /// Play the layer backwards.
    #[arg(long, default_value_t = false)]
    reverse: bool,
}

/// Parse a `--trim in,out` value (both in ms).
fn parse_trim(value: &str) -> Result<(f64, f64), String> {
    let (a, b) = value
        .split_once(',')
        .ok_or_else(|| format!("invalid trim `{value}` (expected `in,out` in ms)"))?;
    let in_ms = a
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("invalid trim in `{a}`: {e}"))?;
    let out_ms = b
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("invalid trim out `{b}`: {e}"))?;
    Ok((in_ms, out_ms))
}

#[derive(clap::Args)]
struct AddVoiceArgs {
    /// The voice name.
    #[arg(long)]
    name: String,
    /// The waveform: `sine`, `square`, `saw`, `triangle`, or `noise`.
    #[arg(long, value_enum)]
    wave: Wave,
    /// The base frequency in Hz (ignored for noise).
    #[arg(long, default_value_t = 440.0)]
    freq: f64,
    /// The level in decibels.
    #[arg(long, default_value_t = 0.0)]
    gain: f64,
    /// The stereo position in `[-1, 1]`.
    #[arg(long, default_value_t = 0.0)]
    pan: f64,
    /// The start offset in ms.
    #[arg(long, default_value_t = 0.0)]
    start: f64,
    /// The note-held length in ms.
    #[arg(long)]
    dur: f64,
}

#[derive(clap::Args)]
struct SetEnvelopeArgs {
    /// The voice to shape.
    #[arg(long)]
    voice: String,
    /// Attack length in ms (ADSR).
    #[arg(long)]
    attack: Option<f64>,
    /// Decay length in ms (ADSR).
    #[arg(long)]
    decay: Option<f64>,
    /// Sustain level in `[0, 1]` (ADSR).
    #[arg(long)]
    sustain: Option<f64>,
    /// Release length in ms (ADSR).
    #[arg(long)]
    release: Option<f64>,
    /// A named envelope curve: `linear`, `pluck`, `swell`, `punch`, or `gate`.
    #[arg(long, value_enum)]
    env: Option<EnvCurve>,
}

#[derive(clap::Args)]
struct SetPitchArgs {
    /// The voice to sweep.
    #[arg(long)]
    voice: String,
    /// The frequency in Hz the sweep ends at.
    #[arg(long)]
    slide_to: f64,
    /// The sweep length in ms.
    #[arg(long)]
    over: f64,
}

#[derive(clap::Args)]
struct ModArgs {
    /// The voice to modulate.
    #[arg(long)]
    voice: String,
    /// The modulation rate in Hz (vibrato) or steps per second (arpeggio).
    #[arg(long)]
    rate: f64,
    /// The depth in semitones.
    #[arg(long)]
    depth: f64,
}

#[derive(clap::Args)]
struct FmArgs {
    /// The voice to modulate.
    #[arg(long)]
    voice: String,
    /// The carrier frequency as a ratio of the voice frequency.
    #[arg(long, default_value_t = 1.0)]
    carrier: f64,
    /// The modulator frequency as a ratio of the voice frequency.
    #[arg(long)]
    modulator: f64,
    /// The modulation index (depth).
    #[arg(long)]
    index: f64,
}

#[derive(clap::Args)]
struct FilterArgs {
    /// The voice to filter (omit to target a bus).
    #[arg(long)]
    voice: Option<String>,
    /// The bus to filter (defaults to `master`).
    #[arg(long)]
    bus: Option<String>,
    /// The response shape: `lowpass`, `highpass`, or `bandpass`.
    #[arg(long = "type", value_enum)]
    kind: FilterType,
    /// The initial cutoff frequency in Hz.
    #[arg(long)]
    cutoff: f64,
    /// An optional cutoff to sweep toward.
    #[arg(long)]
    sweep_to: Option<f64>,
    /// The sweep length in ms.
    #[arg(long, default_value_t = 0.0)]
    over: f64,
    /// Resonance (Q).
    #[arg(long, default_value_t = 0.707)]
    resonance: f64,
}

#[derive(clap::Args)]
struct DistortionArgs {
    /// The voice to distort (omit to target a bus).
    #[arg(long)]
    voice: Option<String>,
    /// The bus to distort (defaults to `master`).
    #[arg(long)]
    bus: Option<String>,
    /// The pre-gain into the saturator.
    #[arg(long)]
    drive: f64,
}

#[derive(clap::Args)]
struct BitcrushArgs {
    /// The voice to crush (omit to target a bus).
    #[arg(long)]
    voice: Option<String>,
    /// The bus to crush (defaults to `master`).
    #[arg(long)]
    bus: Option<String>,
    /// Bit depth (1..16).
    #[arg(long)]
    bits: u32,
    /// The reduced sample-and-hold rate in Hz.
    #[arg(long)]
    rate: f64,
}

#[derive(clap::Args)]
struct RingmodArgs {
    /// The voice to modulate (omit to target a bus).
    #[arg(long)]
    voice: Option<String>,
    /// The bus to modulate (defaults to `master`).
    #[arg(long)]
    bus: Option<String>,
    /// The modulator frequency in Hz.
    #[arg(long)]
    freq: f64,
}

#[derive(clap::Args)]
struct ReverbArgs {
    /// The bus to add reverb to (defaults to `master`).
    #[arg(long, default_value = "master")]
    bus: String,
    /// Room size / tail length in `[0, 1]`.
    #[arg(long, default_value_t = 0.5)]
    size: f64,
    /// Wet/dry mix in `[0, 1]`.
    #[arg(long, default_value_t = 0.25)]
    mix: f64,
}

#[derive(clap::Args)]
struct DelayArgs {
    /// The bus to add delay to (defaults to `master`).
    #[arg(long, default_value = "master")]
    bus: String,
    /// Delay time in ms.
    #[arg(long)]
    time: f64,
    /// Feedback gain in `[0, 1)`.
    #[arg(long, default_value_t = 0.35)]
    feedback: f64,
    /// Wet/dry mix in `[0, 1]`.
    #[arg(long, default_value_t = 0.3)]
    mix: f64,
}

#[derive(clap::Args)]
struct CompressorArgs {
    /// The bus to compress (defaults to `master`).
    #[arg(long, default_value = "master")]
    bus: String,
    /// The threshold in dB below 0.
    #[arg(long)]
    threshold: f64,
    /// The compression ratio (> 1).
    #[arg(long)]
    ratio: f64,
}

/// Resolve a `--voice` / `--bus` pair to an effect target.
fn target(voice: Option<String>, bus: Option<String>) -> Target {
    match voice {
        Some(name) => Target::Voice(name),
        None => Target::Bus(bus.unwrap_or_else(|| "master".to_string())),
    }
}

fn main() -> ExitCode {
    match run(clap_ext::parse_allowing_negatives::<Cli>()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("sfx-sample: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let config: AudioConfig = config::read_config(&cli.config)?;
    // The op an authoring subcommand records, or an early return for the
    // browse/init/render commands.
    let op = match cli.command {
        Command::Init => {
            record::init_log::<AudioOp>(&config.actions)?;
            println!("initialized empty log (run `render` to hear it)");
            return Ok(());
        }
        Command::ListSamples { tag } => {
            let library = runner::load_library(&config);
            let entries = library.list(tag.as_deref());
            if entries.is_empty() {
                println!("(no samples in the baked library)");
            } else {
                for e in entries {
                    println!(
                        "{}  [{}]  {:.0}ms  {}",
                        e.name,
                        e.tags.join(", "),
                        e.duration_ms,
                        e.description
                    );
                }
            }
            return Ok(());
        }
        Command::SampleInfo { name } => {
            let library = runner::load_library(&config);
            match library.info(&name) {
                Some(e) => println!(
                    "name: {}\ntags: {}\nduration_ms: {:.0}\ndescription: {}",
                    e.name,
                    e.tags.join(", "),
                    e.duration_ms,
                    e.description
                ),
                None => return Err(format!("no sample named `{name}` in the baked library")),
            }
            return Ok(());
        }
        Command::Render => {
            let library = runner::load_library(&config);
            let count = runner::render_sfx(&config, Some(&library))?;
            println!(
                "rendered {} operation{} to {}",
                count,
                if count == 1 { "" } else { "s" },
                config.wav.display()
            );
            return Ok(());
        }
        Command::AddSample(a) => {
            let (trim_in_ms, trim_out_ms) = match a.trim {
                Some((i, o)) => (Some(i), Some(o)),
                None => (None, None),
            };
            AudioOp::AddSample {
                name: a.name,
                t_ms: a.t,
                gain: a.gain,
                pitch: a.pitch,
                trim_in_ms,
                trim_out_ms,
                fade_in_ms: a.fade_in,
                fade_out_ms: a.fade_out,
                reverse: a.reverse,
            }
        }
        Command::AddVoice(a) => AudioOp::AddVoice {
            name: a.name,
            wave: a.wave,
            freq: a.freq,
            gain: a.gain,
            pan: a.pan,
            start_ms: a.start,
            dur_ms: a.dur,
        },
        Command::SetEnvelope(a) => AudioOp::SetEnvelope {
            voice: a.voice,
            attack_ms: a.attack,
            decay_ms: a.decay,
            sustain: a.sustain,
            release_ms: a.release,
            env: a.env,
        },
        Command::SetPitch(a) => AudioOp::SetPitch {
            voice: a.voice,
            slide_to_hz: a.slide_to,
            over_ms: a.over,
        },
        Command::AddVibrato(a) => AudioOp::AddVibrato {
            voice: a.voice,
            rate_hz: a.rate,
            depth_semitones: a.depth,
        },
        Command::AddArpeggio(a) => AudioOp::AddArpeggio {
            voice: a.voice,
            rate_hz: a.rate,
            depth_semitones: a.depth,
        },
        Command::AddFm(a) => AudioOp::AddFm {
            voice: a.voice,
            carrier: a.carrier,
            modulator: a.modulator,
            index: a.index,
        },
        Command::AddFilter(a) => AudioOp::AddFilter {
            target: target(a.voice, a.bus),
            kind: a.kind,
            cutoff_hz: a.cutoff,
            sweep_to_hz: a.sweep_to,
            over_ms: a.over,
            resonance: a.resonance,
        },
        Command::AddDistortion(a) => AudioOp::AddDistortion {
            target: target(a.voice, a.bus),
            drive: a.drive,
        },
        Command::AddBitcrush(a) => AudioOp::AddBitcrush {
            target: target(a.voice, a.bus),
            bits: a.bits,
            rate_hz: a.rate,
        },
        Command::AddRingmod(a) => AudioOp::AddRingmod {
            target: target(a.voice, a.bus),
            freq_hz: a.freq,
        },
        Command::AddReverb(a) => AudioOp::AddReverb {
            target: Target::Bus(a.bus),
            size: a.size,
            mix: a.mix,
        },
        Command::AddDelay(a) => AudioOp::AddDelay {
            target: Target::Bus(a.bus),
            time_ms: a.time,
            feedback: a.feedback,
            mix: a.mix,
        },
        Command::AddCompressor(a) => AudioOp::AddCompressor {
            target: Target::Bus(a.bus),
            threshold_db: a.threshold,
            ratio: a.ratio,
        },
    };
    let name = op.name();
    let count = record::record(&config.actions, op)?;
    println!(
        "recorded {name} ({count} operation{} in the log)",
        if count == 1 { "" } else { "s" }
    );
    Ok(())
}
