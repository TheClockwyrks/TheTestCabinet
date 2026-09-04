// assets/music-at-least-30s — the bed runs at least thirty seconds.
//
// WHAT THIS DECIDES. One reading of one file: the duration
// `assets/audio/music.wav` announces — its sample frames over its sample rate
// — is at least `MUSIC_MIN_SECONDS`.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The music bed"): the
// `.wav` "is what the game plays, for the length of a run as `specs/ui.md`
// states, and it runs at least `MUSIC_MIN_SECONDS` (`30`) seconds."
// `MUSIC_MIN_SECONDS` in `src/constants.ts` is that same `30`.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the file is committed and audible
// is `assets/music-produced`; that its end runs into its start is
// `assets/music-loops-cleanly`; that the game loops it through the run is the
// audio points' business.
//
// WHY NO WORLD IS POSED. This point is about a FILE rather than about a play,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the bed's waveform with
// its measured length in the caption.
//
// THE TOLERANCE. One hundredth of a second below the stated figure. The
// figure is stated in whole seconds and a WAV's length is quantized to whole
// sample frames, so a bed rendered AT thirty seconds can land a frame short
// of the exact float; a hundredth of a second absorbs that rounding while
// still failing any bed actually shorter than the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { MUSIC_MIN_SECONDS } from "../constants";
import { captureStill, createHarness, readWav, type Harness } from "../harness";
import { cueFile, showWaveform } from "./sounds";

const BED = cueFile("music");

/** How far under the stated figure a whole-frame rendering may land. */
const ROUNDING = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("runs the music bed at least thirty seconds", () => {
  const { wav, reason } = readWav(BED);
  if (wav === null) {
    fail(
      `a produced music bed committed at ${BED} running at least ${MUSIC_MIN_SECONDS} seconds (specs/assets.md, the music bed)`,
      reason,
    );
  }
  showWaveform(
    h,
    `${BED} — ${wav.duration.toFixed(2)} s against the ${MUSIC_MIN_SECONDS} s floor`,
    wav,
  );
  captureStill(h, "length");

  assertGreaterThanOrEqual(
    wav.duration,
    MUSIC_MIN_SECONDS - ROUNDING,
    `the seconds ${BED} runs for`,
  );
});
