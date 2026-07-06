//! The `music` CLI: a symbolic sequencer — notes on instrument tracks over a tempo
//! and meter — rendered to a PCM `.wav` and emitted alongside a portable `.mid` score.
//!
//! `music` works in the abstract symbolic layer (pitches, beats, durations) rather than
//! shaping raw DSP. Each subcommand is one operation and **only records**; `render`
//! mixes the sequenced tracks down to the `.wav`, draws the piano-roll (plus waveform +
//! spectrogram) preview, and emits the portable `.mid`. See
//! `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_audio_core::clap_ext;
use test_cabinet_audio_core::config::{self, AudioConfig};
use test_cabinet_audio_core::music::{self, MusicOp};
use test_cabinet_audio_core::record;
use test_cabinet_audio_core::runner;
use test_cabinet_audio_core::synth::EnvCurve;

/// The sequencer music tool for audio asset-generation cases.
#[derive(Parser)]
#[command(
    name = "music",
    about = "Sequence a short piece of music, one operation at a time."
)]
struct Cli {
    /// Path to the seeded config JSON (`sample_rate`, `channels`, `max_duration_ms`,
    /// the fixed `seed`, the instrument-bank name/dir, and the log / preview / `.wav` /
    /// `.mid` paths, plus an optional `live` block). Read by `init`, every operation,
    /// and `render`.
    #[arg(long, default_value = "music.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Write an empty op log; renders nothing. A run starts pre-seeded.
    Init,
    /// Set the piece's tempo.
    SetTempo {
        /// Beats per minute.
        #[arg(long)]
        bpm: u32,
    },
    /// Set the piece's time signature.
    SetTimeSignature {
        /// Beats per bar.
        #[arg(long)]
        num: u8,
        /// The beat unit (a power of two: 4 = quarter, 8 = eighth …).
        #[arg(long)]
        den: u8,
    },
    /// Define an instrument track (a synth waveform name, or a bank instrument name).
    DefineTrack {
        /// The track name (the handle notes and fx address).
        #[arg(long)]
        name: String,
        /// The instrument: a synth waveform (`sine`/`square`/`saw`/`triangle`) or a
        /// bank instrument name.
        #[arg(long)]
        instrument: String,
    },
    /// Add a note event to a track.
    AddNote(AddNoteArgs),
    /// Set per-track processing (`--gain`, `--pan`, `--reverb`, `--env`).
    SetTrackFx(SetTrackFxArgs),
    /// Mix the sequenced tracks down to the `.wav`, draw the piano-roll, and emit `.mid`.
    Render,
}

#[derive(clap::Args)]
struct AddNoteArgs {
    /// The track to add the note to.
    #[arg(long)]
    track: String,
    /// The pitch, as a note name (`C4`, `F#3`, `Bb5`) or a MIDI number (`60`).
    #[arg(long, value_parser = music::parse_pitch)]
    pitch: u8,
    /// The start time in beats.
    #[arg(long)]
    t: f64,
    /// The length in beats.
    #[arg(long)]
    dur: f64,
    /// The velocity (1..127).
    #[arg(long, default_value_t = 100)]
    velocity: u8,
}

#[derive(clap::Args)]
struct SetTrackFxArgs {
    /// The track to process.
    #[arg(long)]
    track: String,
    /// A gain trim in dB.
    #[arg(long)]
    gain: Option<f64>,
    /// A stereo position in `[-1, 1]`.
    #[arg(long)]
    pan: Option<f64>,
    /// A reverb wet/dry mix in `[0, 1]`.
    #[arg(long)]
    reverb: Option<f64>,
    /// An amplitude-envelope preset for the track's notes: `linear`, `pluck`, `swell`,
    /// `punch`, or `gate`.
    #[arg(long, value_enum)]
    env: Option<EnvCurve>,
}

fn main() -> ExitCode {
    match run(clap_ext::parse_allowing_negatives::<Cli>()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("music: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    let config: AudioConfig = config::read_config(&cli.config)?;
    let op = match cli.command {
        Command::Init => {
            record::init_log::<MusicOp>(&config.actions)?;
            println!("initialized empty log (run `render` to hear it)");
            return Ok(());
        }
        Command::Render => {
            let library = runner::load_library(&config);
            let count = runner::render_music(&config, Some(&library))?;
            println!(
                "rendered {} operation{} to {} and {}",
                count,
                if count == 1 { "" } else { "s" },
                config.wav.display(),
                config.mid.display()
            );
            return Ok(());
        }
        Command::SetTempo { bpm } => MusicOp::SetTempo { bpm },
        Command::SetTimeSignature { num, den } => MusicOp::SetTimeSignature { num, den },
        Command::DefineTrack { name, instrument } => MusicOp::DefineTrack { name, instrument },
        Command::AddNote(a) => MusicOp::AddNote {
            track: a.track,
            pitch: a.pitch,
            t_beats: a.t,
            dur_beats: a.dur,
            velocity: a.velocity,
        },
        Command::SetTrackFx(a) => MusicOp::SetTrackFx {
            track: a.track,
            gain: a.gain,
            pan: a.pan,
            reverb: a.reverb,
            env: a.env,
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
