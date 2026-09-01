// assets/music-produced — the bed is a produced track with its MIDI beside it.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The music bed"): "Produce
// the `music` cue with `music`, which may sequence the baked instrument bank,
// synth waveforms, or both: `assets/audio/music.wav`, with its
// `assets/audio/music.mid` committed beside it. The `.wav` is what the game
// plays", and "The tools" table has `music` produce "a `.wav` and a `.mid`". So
// two files, at exactly those paths: the `.wav` decoding as a WAV that carries
// audible signal rather than silence, and the `.mid` carrying a MIDI file.
//
// HOW THE MIDI IS READ. A Standard MIDI File opens with the four bytes `MThd`
// and a six-byte header chunk, which is the whole of what makes a file a MIDI
// rather than something else wearing the extension. Nothing about what it
// sequences is read: the specification says the `.wav` is what the game plays,
// so the `.mid` is the portable source committed beside it.
//
// THE TOLERANCE. `SILENCE_FLOOR` is a hundredth of full scale, 40 dB down, and
// `assets/sounds.ts` states why: the specification fixes no level, so what a
// check can honestly read is the difference between a sound and no sound.
//
// WHAT IT DELIBERATELY DOES NOT READ. The bed's length is
// `assets/music-at-least-30s` and its seam `assets/music-loops-cleanly`; that it
// loops for the length of a run is the audio category's; "the bed stays welcome
// for the full ten minutes" is the presentation domain's aesthetic rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { MUSIC_MIDI_FILE } from "../constants";
import { writeImage } from "./media-out";
import {
  MUSIC_FILE,
  paintWaveform,
  readWav,
  SILENCE_FLOOR,
  soundBytes,
} from "./sounds";

/** "MThd", the four bytes a Standard MIDI File opens with. */
const MIDI_MAGIC = "MThd";

/** The header chunk that follows it: four bytes of id, four of length, six of body. */
const MIDI_HEADER_BYTES = 14;

it("ships the music bed as an audible WAV with its .mid beside it", () => {
  const read = readWav(MUSIC_FILE);
  const wav =
    read.wav ??
    fail(
      `${MUSIC_FILE} committed and decoding as a WAV (specs/assets.md — "The music bed")`,
      read.reason,
    );
  writeImage("music", paintWaveform(`The music bed — ${MUSIC_FILE}`, wav));

  assertGreaterThan(wav.frames, 0, `sample frames in ${MUSIC_FILE}`);
  assertGreaterThan(
    wav.peak,
    SILENCE_FLOOR,
    `the peak sample of ${MUSIC_FILE}, on a full scale of 1`,
  );

  const midi = soundBytes(MUSIC_MIDI_FILE);
  if (midi === null) fail(`a file at ${MUSIC_MIDI_FILE}`, "no file there");
  if (
    midi.length < MIDI_HEADER_BYTES ||
    midi.toString("ascii", 0, 4) !== MIDI_MAGIC
  ) {
    fail(
      `${MUSIC_MIDI_FILE} carrying a MIDI file, which opens with ${MIDI_MAGIC}`,
      `${midi.length} bytes opening with ${JSON.stringify(
        midi.toString("ascii", 0, Math.min(4, midi.length)),
      )}`,
    );
  }
});
