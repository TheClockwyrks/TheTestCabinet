use super::*;
use crate::music::{MusicOp, MusicProject};

fn tone(freq: f64, secs: f64) -> Vec<f32> {
    let n = (44100.0 * secs) as usize;
    (0..n)
        .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / 44100.0).sin() as f32 * 0.5)
        .collect()
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
}

#[test]
fn sfx_preview_is_a_png() {
    let mono = tone(440.0, 0.5);
    let png = render_sfx_preview(&mono, 1, 44100);
    assert!(is_png(&png));
    assert!(png.len() > 100);
}

#[test]
fn sfx_preview_handles_empty_clip() {
    let png = render_sfx_preview(&[], 2, 44100);
    assert!(is_png(&png));
}

#[test]
fn music_preview_is_a_png() {
    let ops = vec![
        MusicOp::DefineTrack {
            name: "lead".into(),
            instrument: "saw".into(),
        },
        MusicOp::AddNote {
            track: "lead".into(),
            pitch: 60,
            t_beats: 0.0,
            dur_beats: 1.0,
            velocity: 100,
        },
        MusicOp::AddNote {
            track: "lead".into(),
            pitch: 64,
            t_beats: 1.0,
            dur_beats: 1.0,
            velocity: 100,
        },
    ];
    let project = MusicProject::from_ops(&ops);
    let roll = project.piano_roll();
    let mono = tone(261.0, 1.0);
    let png = render_music_preview(&mono, 1, 44100, &roll);
    assert!(is_png(&png));
}

#[test]
fn spectrogram_of_a_pure_tone_runs() {
    // Interleaved stereo input path.
    let mono = tone(1000.0, 0.3);
    let stereo: Vec<f32> = mono.iter().flat_map(|&s| [s, s]).collect();
    let png = render_sfx_preview(&stereo, 2, 44100);
    assert!(is_png(&png));
}
