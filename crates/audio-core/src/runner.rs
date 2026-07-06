//! The shared on-request `render` step the three binaries call.
//!
//! `render` mixes the recorded op log down to interleaved PCM, encodes the `.wav`
//! (and, for `music`, the `.mid`), draws the preview PNG, and — when the run is
//! watched — streams the preview and the current clip to the live viewer. Factoring
//! it here keeps the binaries thin (they own only their subcommand vocabulary) and
//! keeps the sfx-synth / sfx-sample render identical (they share one op set).

use std::fs;

use crate::config::AudioConfig;
use crate::music::{self, MusicOp, MusicProject};
use crate::sample::SampleLibrary;
use crate::sfx::{self, AudioOp, SfxProject};
use crate::{preview, record, wav};

/// Render a sound-effect clip (`sfx-synth` / `sfx-sample`): mix the op log down, write
/// the `.wav`, draw the waveform + spectrogram preview, and stream the live update.
/// `library` supplies the baked samples (`None` for a pure-synth run or no baked pack).
pub fn render_sfx(config: &AudioConfig, library: Option<&SampleLibrary>) -> Result<usize, String> {
    let ops: Vec<AudioOp> = record::read_actions(&config.actions)?;
    let params = config.render_params();
    let project = SfxProject::from_ops(&ops);
    let samples = sfx::render_sfx(&project, &params, library);

    let wav_bytes = wav::encode_pcm16(&samples, params.sample_rate, config.channel_count());
    write_file(&config.wav, &wav_bytes)?;

    let png = preview::render_sfx_preview(&samples, params.channels.count(), params.sample_rate);
    write_file(&config.preview, &png)?;

    if let Some(live) = &config.live {
        record::send_live_preview(
            &live.endpoint,
            &live.token,
            0,
            "render",
            ops.len(),
            &png,
            &wav_bytes,
        );
    }
    Ok(ops.len())
}

/// Render a music clip (`music`): mix the op log down, write the `.wav` and the
/// portable `.mid`, draw the waveform + spectrogram + piano-roll preview, and stream
/// the live update.
pub fn render_music(config: &AudioConfig, library: Option<&SampleLibrary>) -> Result<usize, String> {
    let ops: Vec<MusicOp> = record::read_actions(&config.actions)?;
    let params = config.render_params();
    let project = MusicProject::from_ops(&ops);
    let samples = music::render_music(&project, &params, library);

    let wav_bytes = wav::encode_pcm16(&samples, params.sample_rate, config.channel_count());
    write_file(&config.wav, &wav_bytes)?;

    let mid_bytes = crate::midi::encode(&project.to_midi_score());
    write_file(&config.mid, &mid_bytes)?;

    let roll = project.piano_roll();
    let png = preview::render_music_preview(&samples, params.channels.count(), params.sample_rate, &roll);
    write_file(&config.preview, &png)?;

    if let Some(live) = &config.live {
        record::send_live_preview(
            &live.endpoint,
            &live.token,
            0,
            "render",
            ops.len(),
            &png,
            &wav_bytes,
        );
    }
    Ok(ops.len())
}

/// Load the baked sample library / instrument bank for a run (empty if none baked).
pub fn load_library(config: &AudioConfig) -> SampleLibrary {
    crate::sample::load_pack(config.resolve_pack_dir().as_deref())
}

fn write_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    record::ensure_parent(path)?;
    fs::write(path, bytes).map_err(|err| format!("writing {}: {err}", path.display()))
}
