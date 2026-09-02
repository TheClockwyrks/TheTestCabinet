//! The shared on-request `render` step the three binaries call.
//!
//! `render` mixes the recorded op log down to interleaved PCM, encodes the `.wav`
//! (and, for `music`, the `.mid`), draws the preview PNG, and — when the run is
//! watched — streams the preview and the current clip to the live viewer. Factoring
//! it here keeps the binaries thin (they own only their subcommand vocabulary) and
//! keeps the sfx-synth / sfx-sample render identical (they share one op set).

use std::fs;

use crate::config::{AudioConfig, PackKind, pack_name, pack_version};
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
    let samples = sfx::render_sfx(&project, &params, library)?;

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
pub fn render_music(
    config: &AudioConfig,
    library: Option<&SampleLibrary>,
) -> Result<usize, String> {
    let ops: Vec<MusicOp> = record::read_actions(&config.actions)?;
    let params = config.render_params();
    let project = MusicProject::from_ops(&ops);
    let samples = music::render_music(&project, &params, library)?;

    let wav_bytes = wav::encode_pcm16(&samples, params.sample_rate, config.channel_count());
    write_file(&config.wav, &wav_bytes)?;

    let mid_bytes = crate::midi::encode(&project.to_midi_score());
    write_file(&config.mid, &mid_bytes)?;

    let roll = project.piano_roll();
    let png =
        preview::render_music_preview(&samples, params.channels.count(), params.sample_rate, &roll);
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

/// Load the baked palette of `kind` this run reads.
///
/// The palette is the `sample_pack` / `instrument_bank` the config names, the image's
/// default when the config names none, or the directory
/// [`AudioConfig::pack_dir`] points at. A run that resolves none of those (a pure
/// `sfx-synth` run) yields an empty library; every other outcome is checked, so a
/// directory that does not resolve, a pack that does not load, a pack that declares
/// no samples, and a pack whose identity differs from the ref the run pins are all
/// errors naming what the run asked for.
pub fn load_library(config: &AudioConfig, kind: PackKind) -> Result<SampleLibrary, String> {
    let requested = config.pack_ref(kind);
    let configured = match (&requested, &config.pack_dir) {
        (Some(name), _) => format!("{} `{name}`", kind.label()),
        (None, Some(dir)) => format!("pack directory {}", dir.display()),
        (None, None) => return Ok(SampleLibrary::empty()),
    };
    let dir = match config.resolve_pack_dir(kind) {
        Ok(Some(dir)) => dir,
        // `configured` above proves a ref or a `pack_dir` is present, so the resolver
        // returns a directory or an error.
        Ok(None) => return Ok(SampleLibrary::empty()),
        Err(err) => return Err(format!("{configured}: {err}")),
    };
    let library = crate::sample::load_pack(&dir).map_err(|err| format!("{configured}: {err}"))?;
    if library.is_empty() {
        return Err(format!(
            "{configured} loaded from {} declares no samples",
            dir.display()
        ));
    }
    if let Some(reference) = &requested {
        check_identity(reference, &library, &dir).map_err(|err| format!("{configured}: {err}"))?;
    }
    Ok(library)
}

/// Check the palette that loaded against the `name@version` the run pins.
///
/// A run addresses its palette by ref, never by path, so a ref naming a pack the
/// image does not carry — or pinning a version the baked pack is not — must fail the
/// run rather than render it against a different palette than the case was written
/// and reviewed against.
fn check_identity(
    reference: &str,
    library: &SampleLibrary,
    dir: &std::path::Path,
) -> Result<(), String> {
    let wanted_name = pack_name(reference);
    match library.name() {
        Some(baked) if baked == wanted_name => {}
        Some(baked) => {
            return Err(format!(
                "the pack baked at {} is `{baked}`, not `{wanted_name}`",
                dir.display()
            ));
        }
        None => {
            return Err(format!(
                "the pack baked at {} declares no `name`, so it cannot be checked \
                 against this run's pin",
                dir.display()
            ));
        }
    }

    let Some(wanted_version) = pack_version(reference) else {
        return Ok(());
    };
    match library.version() {
        Some(baked) if baked == wanted_version => Ok(()),
        Some(baked) => Err(format!(
            "the baked `{wanted_name}` is version {baked}, not the pinned {wanted_version}"
        )),
        None => Err(format!(
            "the pack baked at {} declares no `version`, so the pinned \
             {wanted_version} cannot be checked",
            dir.display()
        )),
    }
}

fn write_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    record::ensure_parent(path)?;
    fs::write(path, bytes).map_err(|err| format!("writing {}: {err}", path.display()))
}

#[cfg(test)]
#[path = "runner.test.rs"]
mod tests;
