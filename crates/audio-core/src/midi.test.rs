use super::*;

fn score() -> MidiScore {
    MidiScore {
        bpm: 120,
        num: 4,
        den: 4,
        tracks: vec![MidiTrack {
            name: "lead".into(),
            channel: 0,
            notes: vec![
                MidiNote {
                    key: 60,
                    start_tick: 0,
                    dur_tick: 480,
                    velocity: 100,
                },
                MidiNote {
                    key: 64,
                    start_tick: 480,
                    dur_tick: 480,
                    velocity: 90,
                },
            ],
        }],
    }
}

#[test]
fn header_is_format_1_with_expected_tracks() {
    let bytes = encode(&score());
    assert_eq!(&bytes[0..4], b"MThd");
    assert_eq!(
        u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
        6
    );
    // format 1
    assert_eq!(u16::from_be_bytes([bytes[8], bytes[9]]), 1);
    // tempo track + 1 instrument track
    assert_eq!(u16::from_be_bytes([bytes[10], bytes[11]]), 2);
    // division
    assert_eq!(
        u16::from_be_bytes([bytes[12], bytes[13]]),
        TICKS_PER_QUARTER
    );
}

#[test]
fn contains_two_mtrk_chunks() {
    let bytes = encode(&score());
    let count = bytes.windows(4).filter(|w| *w == b"MTrk").count();
    assert_eq!(count, 2);
}

#[test]
fn tempo_meta_encodes_bpm() {
    let bytes = encode(&score());
    // Find the FF 51 03 tempo meta and check microseconds/quarter for 120 bpm.
    let pos = bytes
        .windows(3)
        .position(|w| w == [0xFF, 0x51, 0x03])
        .expect("tempo meta present");
    let usec = u32::from_be_bytes([0, bytes[pos + 3], bytes[pos + 4], bytes[pos + 5]]);
    assert_eq!(usec, 500_000); // 60_000_000 / 120
}

#[test]
fn vlq_round_trips_large_delta() {
    let mut out = Vec::new();
    write_vlq(&mut out, 480);
    // 480 = 0x1E0 -> 0x83 0x60
    assert_eq!(out, vec![0x83, 0x60]);
}

#[test]
fn empty_score_still_valid_header() {
    let s = MidiScore {
        bpm: 90,
        num: 3,
        den: 4,
        tracks: vec![],
    };
    let bytes = encode(&s);
    assert_eq!(&bytes[0..4], b"MThd");
    assert_eq!(u16::from_be_bytes([bytes[10], bytes[11]]), 1); // just the tempo track
}
