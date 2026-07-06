//! A hand-rolled Standard MIDI File (SMF, format 1) encoder for `music`'s portable
//! `.mid` companion.
//!
//! The `.mid` is the score-as-metadata companion to the rendered `.wav`: it lets a
//! game re-synthesize the piece in-engine with its own instruments. A format-1 SMF is
//! a small, well-specified container — a header chunk plus a tempo/meter track and one
//! track of note-on/note-off events per instrument — so it is hand-rolled here rather
//! than pulling a MIDI crate. Times are in ticks at a fixed 480 ticks per quarter note.

/// Ticks per quarter note in the emitted files.
pub const TICKS_PER_QUARTER: u16 = 480;

/// One note event in a track: its key, start, length, and velocity, all in ticks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidiNote {
    /// The MIDI key (0..127).
    pub key: u8,
    /// The start time in ticks.
    pub start_tick: u32,
    /// The length in ticks.
    pub dur_tick: u32,
    /// The velocity (1..127).
    pub velocity: u8,
}

/// One instrument track.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidiTrack {
    /// The track name (emitted as a track-name meta event).
    pub name: String,
    /// The MIDI channel (0..15).
    pub channel: u8,
    /// The track's notes.
    pub notes: Vec<MidiNote>,
}

/// A whole score: tempo, meter, and the instrument tracks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidiScore {
    /// Tempo in beats per minute.
    pub bpm: u32,
    /// Time-signature numerator.
    pub num: u8,
    /// Time-signature denominator (a power of two: 4 = quarter, 8 = eighth …).
    pub den: u8,
    /// The instrument tracks.
    pub tracks: Vec<MidiTrack>,
}

/// Encode the score as a complete format-1 Standard MIDI File.
pub fn encode(score: &MidiScore) -> Vec<u8> {
    let mut out = Vec::new();
    // Header chunk: format 1, ntracks = tempo track + instrument tracks.
    let ntracks = 1 + score.tracks.len() as u16;
    out.extend_from_slice(b"MThd");
    out.extend_from_slice(&6u32.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes()); // format 1
    out.extend_from_slice(&ntracks.to_be_bytes());
    out.extend_from_slice(&TICKS_PER_QUARTER.to_be_bytes());

    // Track 0: the tempo / meter map.
    out.extend_from_slice(&tempo_track(score));
    // One track per instrument.
    for track in &score.tracks {
        out.extend_from_slice(&instrument_track(track));
    }
    out
}

/// The tempo/meter track (track 0).
fn tempo_track(score: &MidiScore) -> Vec<u8> {
    let mut body = Vec::new();
    // Tempo: FF 51 03, microseconds per quarter note.
    let usec_per_quarter = (60_000_000u32 / score.bpm.max(1)).to_be_bytes();
    write_vlq(&mut body, 0);
    body.extend_from_slice(&[0xFF, 0x51, 0x03]);
    body.extend_from_slice(&usec_per_quarter[1..4]); // 3 bytes
    // Time signature: FF 58 04 nn dd cc bb.
    write_vlq(&mut body, 0);
    let dd = den_power(score.den);
    body.extend_from_slice(&[0xFF, 0x58, 0x04, score.num.max(1), dd, 24, 8]);
    // End of track.
    write_vlq(&mut body, 0);
    body.extend_from_slice(&[0xFF, 0x2F, 0x00]);
    chunk(b"MTrk", &body)
}

/// One instrument track's chunk.
fn instrument_track(track: &MidiTrack) -> Vec<u8> {
    let mut body = Vec::new();
    // Track name meta.
    write_vlq(&mut body, 0);
    body.extend_from_slice(&[0xFF, 0x03]);
    let name = track.name.as_bytes();
    write_vlq(&mut body, name.len() as u32);
    body.extend_from_slice(name);

    // Build the ordered (tick, on/off) event stream: on at start, off at start+dur.
    #[derive(Clone)]
    struct Ev {
        tick: u32,
        on: bool,
        key: u8,
        vel: u8,
    }
    let mut events: Vec<Ev> = Vec::new();
    for n in &track.notes {
        events.push(Ev {
            tick: n.start_tick,
            on: true,
            key: n.key.min(127),
            vel: n.velocity.clamp(1, 127),
        });
        events.push(Ev {
            tick: n.start_tick + n.dur_tick.max(1),
            on: false,
            key: n.key.min(127),
            vel: 0,
        });
    }
    // Sort by tick, note-offs before note-ons at the same tick to avoid a stuck note.
    events.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.on.cmp(&b.on)));

    let ch = track.channel & 0x0F;
    let mut prev_tick = 0u32;
    for ev in &events {
        let delta = ev.tick.saturating_sub(prev_tick);
        write_vlq(&mut body, delta);
        if ev.on {
            body.push(0x90 | ch);
            body.push(ev.key);
            body.push(ev.vel);
        } else {
            body.push(0x80 | ch);
            body.push(ev.key);
            body.push(0);
        }
        prev_tick = ev.tick;
    }
    // End of track.
    write_vlq(&mut body, 0);
    body.extend_from_slice(&[0xFF, 0x2F, 0x00]);
    chunk(b"MTrk", &body)
}

/// Wrap a body in a named chunk (`id` + big-endian length + body).
fn chunk(id: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(id);
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(body);
    out
}

/// The `dd` byte of a time signature: log2 of the denominator.
fn den_power(den: u8) -> u8 {
    let mut d = den.max(1);
    let mut p = 0u8;
    while d > 1 {
        d >>= 1;
        p += 1;
    }
    p
}

/// Append a MIDI variable-length quantity.
fn write_vlq(out: &mut Vec<u8>, mut value: u32) {
    let mut buffer = [0u8; 5];
    let mut i = 4;
    buffer[i] = (value & 0x7F) as u8;
    value >>= 7;
    while value > 0 {
        i -= 1;
        buffer[i] = ((value & 0x7F) as u8) | 0x80;
        value >>= 7;
    }
    out.extend_from_slice(&buffer[i..]);
}

#[cfg(test)]
#[path = "midi.test.rs"]
mod tests;
