use super::*;
use crate::format::Channels;

fn params() -> RenderParams {
    RenderParams {
        sample_rate: 44100,
        channels: Channels::Stereo,
        max_duration_ms: 5000,
        seed: 1,
    }
}

fn stinger() -> Vec<MusicOp> {
    vec![
        MusicOp::SetTempo { bpm: 120 },
        MusicOp::SetTimeSignature { num: 4, den: 4 },
        MusicOp::DefineTrack {
            name: "lead".into(),
            instrument: "saw".into(),
        },
        MusicOp::AddNote {
            track: "lead".into(),
            pitch: 60,
            t_beats: 0.0,
            dur_beats: 1.0,
            velocity: 110,
        },
        MusicOp::AddNote {
            track: "lead".into(),
            pitch: 67,
            t_beats: 1.0,
            dur_beats: 1.0,
            velocity: 100,
        },
    ]
}

#[test]
fn json_round_trips() {
    let ops = stinger();
    let json = serde_json::to_string_pretty(&ops).unwrap();
    let back: Vec<MusicOp> = serde_json::from_str(&json).unwrap();
    assert_eq!(ops, back);
}

#[test]
fn parse_pitch_note_names() {
    assert_eq!(parse_pitch("C4").unwrap(), 60);
    assert_eq!(parse_pitch("A4").unwrap(), 69);
    assert_eq!(parse_pitch("C#4").unwrap(), 61);
    assert_eq!(parse_pitch("Bb3").unwrap(), 58);
    assert_eq!(parse_pitch("60").unwrap(), 60);
    assert!(parse_pitch("H2").is_err());
}

#[test]
fn midi_to_hz_reference() {
    assert!((midi_to_hz(69) - 440.0).abs() < 1e-6);
    assert!((midi_to_hz(60) - 261.6255).abs() < 1e-3);
}

#[test]
fn render_is_byte_stable() {
    let project = MusicProject::from_ops(&stinger());
    let p = params();
    let a = render_music(&project, &p, None);
    let b = render_music(&project, &p, None);
    assert_eq!(a, b);
    assert!(a.iter().any(|&s| s.abs() > 0.001));
}

#[test]
fn to_midi_score_maps_beats_to_ticks() {
    let project = MusicProject::from_ops(&stinger());
    let score = project.to_midi_score();
    assert_eq!(score.bpm, 120);
    assert_eq!(score.tracks.len(), 1);
    let notes = &score.tracks[0].notes;
    assert_eq!(notes[0].start_tick, 0);
    assert_eq!(notes[0].dur_tick, 480); // 1 beat = 1 quarter = 480 ticks
    assert_eq!(notes[1].start_tick, 480);
    // The score encodes to a valid SMF.
    let bytes = crate::midi::encode(&score);
    assert_eq!(&bytes[0..4], b"MThd");
}

#[test]
fn render_is_bounded_to_unity() {
    let ops = vec![
        MusicOp::DefineTrack {
            name: "a".into(),
            instrument: "square".into(),
        },
        MusicOp::AddNote {
            track: "a".into(),
            pitch: 48,
            t_beats: 0.0,
            dur_beats: 2.0,
            velocity: 127,
        },
        MusicOp::AddNote {
            track: "a".into(),
            pitch: 55,
            t_beats: 0.0,
            dur_beats: 2.0,
            velocity: 127,
        },
    ];
    let project = MusicProject::from_ops(&ops);
    let mix = render_music(&project, &params(), None);
    assert!(mix.iter().all(|&s| (-1.0001..=1.0001).contains(&s)));
}

// --- Bank-instrument (sampled) playback --------------------------------------------

use crate::sample::SampleEntry;

/// Write a mono PCM-16 WAV of a decaying sine at `hz` for `ms` and return its path.
fn write_tone(dir: &std::path::Path, file: &str, hz: f64, ms: f64) {
    let rate = 44100.0;
    let n = (ms / 1000.0 * rate) as usize;
    let samples: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f64 / rate;
            let decay = (1.0 - i as f64 / n as f64) as f32;
            (std::f64::consts::TAU * hz * t).sin() as f32 * 0.8 * decay
        })
        .collect();
    let bytes = crate::wav::encode_pcm16(&samples, 44100, 1);
    std::fs::write(dir.join(file), bytes).unwrap();
}

/// A two-instrument library on disk: a pitched tone at C4 (root 60) and an unpitched
/// percussion one-shot. Returns the library and its temp dir (kept alive by the caller).
fn bank(tag: &str) -> SampleLibrary {
    let dir = std::env::temp_dir().join(format!("tcab_music_{}_{}", std::process::id(), tag));
    std::fs::create_dir_all(&dir).unwrap();
    write_tone(&dir, "tone.wav", 261.63, 600.0); // C4 reference
    write_tone(&dir, "perc.wav", 180.0, 120.0);
    let entries = vec![
        SampleEntry {
            name: "tone".into(),
            tags: vec!["keys".into()],
            duration_ms: 600.0,
            description: "reference tone".into(),
            file: Some("tone.wav".into()),
            root_note: 60,
            pitched: true,
        },
        SampleEntry {
            name: "perc".into(),
            tags: vec!["drum".into()],
            duration_ms: 120.0,
            description: "percussion one-shot".into(),
            file: Some("perc.wav".into()),
            root_note: 60,
            pitched: false,
        },
    ];
    SampleLibrary::from_entries(entries, Some(dir), 44100)
}

/// The index after the last non-silent sample in an interleaved buffer (0 if silent).
fn sounding_len(mix: &[f32]) -> usize {
    mix.iter()
        .rposition(|&s| s.abs() > 1e-4)
        .map(|i| i + 1)
        .unwrap_or(0)
}

fn one_note(instrument: &str, pitch: u8) -> Vec<MusicOp> {
    vec![
        MusicOp::SetTempo { bpm: 120 },
        MusicOp::DefineTrack {
            name: "t".into(),
            instrument: instrument.into(),
        },
        MusicOp::AddNote {
            track: "t".into(),
            pitch,
            t_beats: 0.0,
            dur_beats: 1.0,
            velocity: 110,
        },
    ]
}

#[test]
fn bank_instrument_renders_from_its_sample() {
    let lib = bank("render");
    let project = MusicProject::from_ops(&one_note("tone", 60));
    let mix = render_music(&project, &params(), Some(&lib));
    assert!(mix.iter().any(|&s| s.abs() > 1e-3), "sampled instrument was silent");
}

#[test]
fn pitched_instrument_transposes_per_note() {
    let lib = bank("pitch");
    // The same source, an octave up, resamples ~twice as fast so it sounds shorter.
    let low = render_music(&MusicProject::from_ops(&one_note("tone", 60)), &params(), Some(&lib));
    let high = render_music(&MusicProject::from_ops(&one_note("tone", 72)), &params(), Some(&lib));
    assert!(
        sounding_len(&high) < sounding_len(&low),
        "octave-up note should be shorter: high={} low={}",
        sounding_len(&high),
        sounding_len(&low),
    );
}

#[test]
fn unpitched_instrument_ignores_note_pitch() {
    let lib = bank("perc");
    // A percussion one-shot plays identically regardless of the note it is triggered on.
    let a = render_music(&MusicProject::from_ops(&one_note("perc", 36)), &params(), Some(&lib));
    let b = render_music(&MusicProject::from_ops(&one_note("perc", 72)), &params(), Some(&lib));
    assert_eq!(a, b, "an unpitched instrument must not transpose");
    assert!(a.iter().any(|&s| s.abs() > 1e-3), "percussion was silent");
}

#[test]
fn unknown_bank_instrument_without_pack_still_renders() {
    // No baked pack: a bank instrument name falls back to the mellow triangle so the
    // run does not render silence.
    let project = MusicProject::from_ops(&one_note("grand_piano", 60));
    let mix = render_music(&project, &params(), None);
    assert!(mix.iter().any(|&s| s.abs() > 1e-3), "fallback synth was silent");
}
