// Wick — assets/music-produced: the music bed is committed as a WAV carrying
// audible signal, with the score `music` wrote beside it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The music bed): "Produce the `music` cue with `music`,
//     which may sequence the baked instrument bank, synth waveforms, or both:
//     `assets/audio/music.wav`, with its `assets/audio/music.mid` committed
//     beside it. The `.wav` is what the game plays."
//   - specs/assets.md (The tools): "`music` emits a portable `.mid` beside the
//     `.wav`, and both are committed."
//   - `constants.ts` carries the two paths as `CUE_PATHS.music` and
//     `MUSIC_SCORE_PATH`.
//
// WHAT IS READ. `assets/audio/music.wav` decodes as a RIFF/WAVE container, holds
// at least one sample frame, and peaks above `SILENCE_FLOOR` — a hundredth of
// full scale, forty decibels down, the honest line between a sound and no
// sound. `assets/audio/music.mid` is committed and opens with `MThd`, which is
// the Standard MIDI File header every `.mid` carries and the whole of what makes
// a file one rather than something else wearing the extension.
//
// WHAT IT DELIBERATELY DOES NOT READ. The bed's length is
// `assets/music-at-least-30s` and its loop junction is
// `assets/music-loops-cleanly`; when the bed plays is the audio category's; and
// whether the bed stays welcome for ten minutes is the sound bar the
// presentation domain's rating judges.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the bed's envelope with what was read off it.
//
// TOLERANCE. `SILENCE_FLOOR` is the only figure, and it is a floor rather than
// a target: `specs/assets.md` fixes no level for the bed.

import { it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { MUSIC_SCORE_PATH } from "../constants";
import { captureCanvas } from "../harness";
import {
  MUSIC_FILE_PATH,
  MUSIC_SCORE_FILE,
  SILENCE_FLOOR,
  midiHeader,
  readSound,
  waveformOf,
} from "./sounds";

/** The four bytes every Standard MIDI File opens with. */
const MIDI_MAGIC = "MThd";

it("commits the bed as an audible WAV with its .mid beside it", () => {
  const read = readSound(MUSIC_FILE_PATH);
  if (read.sound !== null) {
    captureCanvas(
      waveformOf(read.sound, `${read.file} — the bed as read`),
      "music",
    );
  }

  if (read.sound === null) {
    fail(`a WAV this decoder reads at ${read.file}`, read.reason);
  }
  assertGreaterThan(read.sound.frames, 0, `sample frames in ${read.file}`);
  assertGreaterThan(
    read.sound.peak,
    SILENCE_FLOOR,
    `the peak sample of ${read.file}, on a full scale of 1`,
  );

  const header = midiHeader(MUSIC_SCORE_PATH);
  if (header === null) {
    fail(`the score committed at ${MUSIC_SCORE_FILE}`, "no file there");
  }
  assertEqual(
    header,
    MIDI_MAGIC,
    `the first four bytes of ${MUSIC_SCORE_FILE} — a Standard MIDI File header`,
  );
});
