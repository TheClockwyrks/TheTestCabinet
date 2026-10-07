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
use crate::staged::{PackKind, StagedPacks, pack_name, pack_version};
use crate::{preview, record, wav};

/// Render a sound-effect clip (`sfx-synth` / `sfx-sample`): mix the op log down, write
/// the `.wav`, draw the waveform + spectrogram preview, and stream the live update.
/// `library` supplies the pack's samples (`None` for a pure-synth run).
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

/// Load the palette of `kind` this run reads out of its staged audio.
///
/// A run container is staged with the packs its test case declares and nothing else,
/// so the palette is the pack the config's ref names among them, or that kind's staged
/// default when the config names none. A run staged with no pack of that kind, asking
/// for none, gets an empty library: that is the pure `sfx-synth` case. Every other
/// outcome is checked, so a ref that selects nothing, a pack that does not load, a
/// pack that declares no samples, and a pack whose identity differs from the ref the
/// run pins are all errors naming what the run asked for and what it holds.
pub fn load_library(config: &AudioConfig, kind: PackKind) -> Result<SampleLibrary, String> {
    let root = StagedPacks::root();
    let requested = config.pack_ref(kind);
    let Some(staged) = StagedPacks::load(&root)? else {
        // No manifest at all: the run was staged with no audio. A run that asked for
        // nothing renders pure synthesis; one that named a pack says why it cannot
        // have it, since rendering it silently without its palette is the failure this
        // prevents.
        return match requested {
            None => Ok(SampleLibrary::empty()),
            Some(reference) => Err(format!(
                "{} `{reference}`: this run was staged with no audio packs ({} is \
                 missing; a test case declares its packs in `[audio] packs`)",
                kind.label(),
                root.join(crate::staged::PACKS_MANIFEST).display()
            )),
        };
    };
    let Some(pack) = staged.select(kind, requested.as_deref())? else {
        return Ok(SampleLibrary::empty());
    };

    let dir = root.join(&pack.dir);
    let configured = format!("{} `{}`", kind.label(), pack.reference());
    let library = crate::sample::load_pack(&dir).map_err(|err| format!("{configured}: {err}"))?;
    if library.is_empty() {
        return Err(format!(
            "{configured} loaded from {} declares no samples",
            dir.display()
        ));
    }
    // A config naming no pack still pins one: the staged pack's own ref. So the
    // identity of every loaded pack is checked, including a full-stack run's default.
    let pin = requested.unwrap_or_else(|| pack.reference());
    check_identity(&pin, &library, &dir).map_err(|err| format!("{configured}: {err}"))?;
    Ok(library)
}

/// Check the palette that loaded against the `name@version` the run pins.
///
/// A run addresses its palette by ref, never by path, so a staged pack whose manifest
/// declares another name, or pins another version, must fail the run rather than
/// render it against a different palette than the case was written and reviewed
/// against.
fn check_identity(
    reference: &str,
    library: &SampleLibrary,
    dir: &std::path::Path,
) -> Result<(), String> {
    let wanted_name = pack_name(reference);
    match library.name() {
        Some(staged) if staged == wanted_name => {}
        Some(staged) => {
            return Err(format!(
                "the pack staged at {} is `{staged}`, not `{wanted_name}`",
                dir.display()
            ));
        }
        None => {
            return Err(format!(
                "the pack staged at {} declares no `name`; this run pins `{wanted_name}`",
                dir.display()
            ));
        }
    }

    let Some(wanted_version) = pack_version(reference) else {
        return Ok(());
    };
    match library.version() {
        Some(staged) if staged == wanted_version => Ok(()),
        Some(staged) => Err(format!(
            "the staged `{wanted_name}` is version {staged}, not the pinned {wanted_version}"
        )),
        None => Err(format!(
            "the pack staged at {} declares no `version`; this run pins {wanted_version}",
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
