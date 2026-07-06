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
