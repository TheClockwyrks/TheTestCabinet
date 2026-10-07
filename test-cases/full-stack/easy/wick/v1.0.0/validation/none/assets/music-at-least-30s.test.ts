// assets/music-at-least-30s — the bed runs at least thirty seconds.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The music bed"): the `.wav`
// "is what the game plays, for the length of a run as `specs/ui.md` states, and
// it runs at least `MUSIC_MIN_SECONDS` (`30`) seconds". This suite decides the
// length alone: the duration the committed `.wav` announces — sample frames over
// sample rate — is at least thirty seconds.
//
// THE TOLERANCE. One hundredth of a second. The figure is stated in whole
// seconds and a WAV's length is quantized to whole sample frames, so a bed
// rendered AT thirty seconds can land a frame short of the exact float; a
// hundredth of a second absorbs that rounding while still failing any bed that is
// actually shorter. It is three orders below the figure itself.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the file exists and carries signal is
// `assets/music-produced`; the seam is `assets/music-loops-cleanly`.
//
// THE DRIVE. None. This point is about a FILE, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { MUSIC_MIN_SECONDS } from "../constants";
import { writeImage } from "./media-out";
import { MUSIC_FILE, paintWaveform, readWav } from "./sounds";

/** The rounding a length quantized to whole sample frames may land inside. */
const ROUNDING = 0.01;

it("runs the music bed at least thirty seconds", () => {
  const read = readWav(MUSIC_FILE);
  const wav =
    read.wav ??
    fail(
      `${MUSIC_FILE} committed and decoding as a WAV at least ${MUSIC_MIN_SECONDS} seconds long`,
      read.reason,
    );
  writeImage(
    "length",
    paintWaveform(
      `${MUSIC_FILE} — ${wav.duration.toFixed(2)} s against the ${MUSIC_MIN_SECONDS} s floor`,
      wav,
      MUSIC_MIN_SECONDS,
    ),
  );

  assertGreaterThanOrEqual(
    wav.duration,
    MUSIC_MIN_SECONDS - ROUNDING,
    `the length of ${MUSIC_FILE}, in seconds`,
  );
});
