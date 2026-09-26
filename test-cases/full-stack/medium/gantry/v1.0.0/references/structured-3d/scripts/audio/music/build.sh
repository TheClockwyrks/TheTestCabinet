#!/usr/bin/env bash
# Gantry — the MUSIC BED, produced with `music` (specs/assets.md: "a steady, unhurried
# machine-yard piece under the title and select screens").
#
# It plays under the title and select screens, so it must SIT BACK: no lead that demands
# attention, no busy percussion, nothing that fatigues on the tenth time you see the menu.
# The read is a construction yard at first light — heavy machinery idling, patient, cold,
# a little melancholy. Slow, modal, and unhurried, with harmony that genuinely moves so
# fifty seconds never feels like one repeated bar.
#
# CONSTRAINT: the baked instrument bank is EMPTY on this machine, so every track is a
# SYNTH WAVEFORM (`--instrument sine|square|saw|triangle`), never a bank instrument name.
#
#   Tempo        72 BPM, 4/4
#   Key          D natural minor (Aeolian) — D E F G A Bb C
#   Length       16 bars / 64 beats ≈ 53 s
#   Progression  Dm Dm Bb C | Dm F  Gm C | Bb F Gm Dm | Bb C Dm C
#                (bar 16 is C — the bVII that pulls straight back into the Dm of bar 1,
#                 so the loop point is a cadence rather than a seam)
#   Tracks       bass   (sine)     the low pulse: the yard's slow heartbeat, half notes
#                pad    (triangle) the harmonic bed: three voice-led voices, whole notes
#                lead   (triangle) a sparse melodic figure, four phrases, lots of rest
#                tick   (square)   a distant relay tick, a four-bar machine pattern
#
# Produces music.wav (the asset the game plays) and music.mid (the portable score),
# plus preview.png (the piano roll) and log.json (the op log).
#
# Verification helpers used while authoring live in analysis/ (wav stats, band balance).
#
# Usage:  bash build.sh      (`music` on PATH, or under $CARGO_TARGET_DIR/release)
set -euo pipefail

if ! command -v music >/dev/null 2>&1; then
  REL="${CARGO_TARGET_DIR:-/cargo-target/the-test-cabinet}/release"
  [ -x "$REL/music" ] || { echo "music not found on PATH or in $REL" >&2; exit 1; }
  export PATH="$REL:$PATH"
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
CFG="music.config.json"

cat > "$CFG" <<'JSON'
{
  "sample_rate": 44100,
  "channels": "stereo",
  "max_duration_ms": 60000,
  "seed": 7,
  "instrument_bank": "gm-lite@0.1.0",
  "actions": "log.json",
  "preview": "preview.png",
  "wav": "music.wav",
  "mid": "music.mid"
}
JSON

m() { music "$@" --config "$CFG" >/dev/null; }

music init --config "$CFG" >/dev/null
m set-tempo --bpm 72
m set-time-signature --num 4 --den 4

# ----------------------------------------------------------------------------- tracks
# Waveforms and registers chosen so the four voices never share a band, which is what lets
# the bed stay quiet and still be legible: sine for the bass (Bb1-G3, pure weight, nothing
# to muddy the octave above it), triangle for the pad (C4-C5, a little harmonic body so the
# harmony still reads at low level), triangle again for the lead but a full octave clear of
# the pad's ceiling (E5-F6, so the figure is heard rather than mixed into the chord), and
# square only for the tick, which lives higher still (A6/D7) and is brief and quiet.
m define-track --name bass --instrument sine
m define-track --name pad  --instrument triangle
m define-track --name lead --instrument triangle
m define-track --name tick --instrument square

# The mix is deliberately bottom-heavy and wide: bass centred and nearly dry, pad spread
# left in a long reverb, lead spread right in a longer one, tick a quiet point of light.
m set-track-fx --track bass --gain -4  --pan  0.00 --reverb 0.14 --env punch
m set-track-fx --track pad  --gain -9  --pan -0.22 --reverb 0.58 --env swell
m set-track-fx --track lead --gain -4  --pan  0.24 --reverb 0.62 --env pluck
m set-track-fx --track tick --gain -15 --pan  0.38 --reverb 0.34 --env gate

# ------------------------------------------------------------------------------- bass
# The low pulse. Two weighted half notes a bar — a machine turning over, not a groove —
# with an octave pickup on the last eighth of every other bar so the pulse breathes and
# hands the next bar over. `punch` gives each a hard front and a tail that dies away.
bass_bar() { # <bar> <root-low> <root-mid> <pickup:0|1>
  local t=$(( ($1 - 1) * 4 ))
  m add-note --track bass --pitch "$2" --t "$t"          --dur 1.9 --velocity 96
  m add-note --track bass --pitch "$3" --t "$(( t + 2 ))" --dur 1.4 --velocity 68
  if [ "$4" = 1 ]; then
    m add-note --track bass --pitch "$3" --t "$(awk "BEGIN{print $t + 3.5}")" --dur 0.45 --velocity 54
  fi
}
#         bar  low   mid   pickup
bass_bar   1   D2    D3    0
bass_bar   2   D2    D3    1
bass_bar   3   Bb1   Bb2   0
bass_bar   4   C2    C3    1
bass_bar   5   D2    D3    0
bass_bar   6   F2    F3    1
bass_bar   7   G2    G3    0
bass_bar   8   C2    C3    1
bass_bar   9   Bb1   Bb2   0
bass_bar  10   F2    F3    1
bass_bar  11   G2    G3    0
bass_bar  12   D2    D3    1
bass_bar  13   Bb1   Bb2   0
bass_bar  14   C2    C3    1
bass_bar  15   D2    D3    0
bass_bar  16   C2    C3    1

# -------------------------------------------------------------------------------- pad
# The harmonic bed: three voice-led voices per chord, each swelling in and sagging out.
# The voicings move by step wherever they can (D4-F4-A4 → D4-F4-Bb4 → E4-G4-C5), so the
# progression reads as one line moving rather than a row of stamped chords. Where the
# chord holds across two bars the pad holds one eight-beat note instead of two four-beat
# ones, which is what keeps the bed from pulsing in lockstep with the bass.
pad_chord() { # <bar> <beats> <v1> <v2> <v3>
  local t=$(( ($1 - 1) * 4 )) d="$2"
  m add-note --track pad --pitch "$3" --t "$t" --dur "$d" --velocity 62
  m add-note --track pad --pitch "$4" --t "$t" --dur "$d" --velocity 54
  m add-note --track pad --pitch "$5" --t "$t" --dur "$d" --velocity 48
}
pad_chord  1  8  D4 F4 A4     # Dm, held two bars — the piece settles before it moves
pad_chord  3  4  D4 F4 Bb4    # Bb
pad_chord  4  4  E4 G4 C5     # C
pad_chord  5  4  D4 F4 A4     # Dm
pad_chord  6  4  C4 F4 A4     # F
pad_chord  7  4  D4 G4 Bb4    # Gm
pad_chord  8  4  E4 G4 C5     # C
pad_chord  9  4  D4 F4 Bb4    # Bb
pad_chord 10  4  C4 F4 A4     # F
pad_chord 11  4  D4 G4 Bb4    # Gm
pad_chord 12  4  D4 F4 A4     # Dm
pad_chord 13  4  D4 F4 Bb4    # Bb
pad_chord 14  4  E4 G4 C5     # C
pad_chord 15  4  D4 F4 A4     # Dm
pad_chord 16  4  E4 G4 C5     # C — the bVII turning back into bar 1

# ------------------------------------------------------------------------------- lead
# The sparse figure. It stays out of the first two bars entirely, then speaks in four
# phrases with real silence between them: A (bars 3-4) states the shape, B (6-8) answers
# it lower, C (9-12) is the one lift — the only time the tune goes above D6 — and D
# (13-16) walks back down and leaves the last two beats of the loop empty, so the piece
# arrives at its own beginning rather than butting into it.
n() { m add-note --track lead --pitch "$1" --t "$2" --dur "$3" --velocity "$4"; }
# phrase A — bars 3-4
n A5  8    2.0 74
n D6  10.5 1.5 78
n C6  12   2.0 70
n A5  14.5 1.5 64
# phrase B — bars 6-8, the answer, sitting lower and longer
n F5  20   1.5 68
n A5  22   2.0 72
n Bb5 25   1.5 74
n A5  27   1.0 64
n G5  28   2.0 70
n E5  30.5 1.5 62
# phrase C — bars 9-12, the lift
n D6  32   2.0 78
n F6  34.5 1.5 82
n E6  36   1.0 74
n C6  37   2.0 72
n Bb5 40   1.5 70
n D6  42   2.0 76
n A5  44   2.0 68
n F5  46.5 1.5 62
# phrase D — bars 13-16, the descent home
n D6  48   2.0 72
n Bb5 50.5 1.5 66
n C6  52   2.0 70
n G5  54.5 1.5 62
n A5  56   3.0 66
n D5  60   2.0 58
#   (beats 62-64 are silent: the loop's breath)

# ------------------------------------------------------------------------------- tick
# A relay somewhere across the yard. Very quiet, very short, and on a FOUR-BAR pattern so
# it never settles into a beat you can tap to: one tick, then two, then a syncopated pair,
# then a triplet-ish stutter that hands the phrase over. Pitch alternates so the pattern
# reads as two different relays answering each other.
tk() { m add-note --track tick --pitch "$1" --t "$2" --dur 0.22 --velocity "$3"; }
tick_group() { # <first bar of the four>
  local b=$(( ($1 - 1) * 4 ))
  tk D7 "$(awk "BEGIN{print $b + 1.5}")"  70
  tk A6 "$(awk "BEGIN{print $b + 5.5}")"  62
  tk D7 "$(awk "BEGIN{print $b + 7.5}")"  56
  tk A6 "$(awk "BEGIN{print $b + 9.5}")"  66
  tk D7 "$(awk "BEGIN{print $b + 10.75}")" 48
  tk A6 "$(awk "BEGIN{print $b + 13.5}")" 64
  tk D7 "$(awk "BEGIN{print $b + 15.25}")" 52
  tk D7 "$(awk "BEGIN{print $b + 15.75}")" 44
}
tick_group 1
tick_group 5
tick_group 9
tick_group 13

m render

echo "produced in $DIR:"
ls -la music.wav music.mid preview.png log.json "$CFG"
