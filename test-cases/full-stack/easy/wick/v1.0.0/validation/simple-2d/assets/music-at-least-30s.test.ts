// Wick — assets/music-at-least-30s: the bed runs at least thirty seconds, so a
// ten-minute night is not two bars on repeat.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The music bed): "The `.wav` is what the game plays, for
//     the length of a run as `specs/ui.md` states, and it runs at least
//     `MUSIC_MIN_SECONDS` (`30`) seconds."
//   - `constants.ts` carries that figure as `MUSIC_MIN_SECONDS`.
//
// WHAT IS READ. The committed `assets/audio/music.wav` decodes, and its length —
// its sample frames over its sample rate, which is the length a player hears —
// is at least `30` seconds.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the file exists and carries signal
// is `assets/music-produced`; that its end runs into its start is
// `assets/music-loops-cleanly`.
//
// WHY NO NIGHT IS POSED. This point is about a FILE, so nothing is posed and no
// game is driven. The evidence is the bed's envelope with its length written on
// it.
//
// TOLERANCE. None. The specification states a floor, and the reading is that
// floor: a bed of exactly thirty seconds passes and one of 29.9 does not.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { MUSIC_MIN_SECONDS } from "../constants";
import { captureCanvas } from "../harness";
import { MUSIC_FILE_PATH, readSound, waveformOf } from "./sounds";

it("runs the bed for at least thirty seconds", () => {
  const read = readSound(MUSIC_FILE_PATH);
  if (read.sound !== null) {
    captureCanvas(
      waveformOf(read.sound, `${read.file} — the bed's length`),
      "length",
    );
  }

  if (read.sound === null) {
    fail(`a WAV this decoder reads at ${read.file}`, read.reason);
  }
  assertGreaterThanOrEqual(
    read.sound.duration,
    MUSIC_MIN_SECONDS,
    `the length of ${read.file}, in seconds`,
  );
});
