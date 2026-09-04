// audio/death-file-produced — the death cue is a sound this build made, not
// silence.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the `death` cue at
// `assets/audio/death.wav`, made with `sfx-synth` or `sfx-sample`, and requires
// the file to be produced during this build and committed rather than downloaded
// or stood in for. `specs/ui.md` binds the cue to the head entering a fatal cell.
// So the file exists, it is a WAV, it holds samples, and those samples carry
// signal.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the sound is like: "the one heavy
// sound in the game... and unmistakable as the end of a round" is
// `specs/assets.md`'s sound bar and the presentation domain's aesthetic rating.
// The one part of that bar stated as a comparison of figures is its length
// against the other two, and that is `audio/death-is-the-longest-cue`. That the
// build plays it on the fatal tick is `audio/death-cue-plays`.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes: the RIFF header in Node, so a file merely wearing the
// extension is caught, and the samples through the browser, which decodes every
// sample format the generators may write — see `audio/sounds.ts`.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// the moment the cue belongs to: the head one cell from the wall it is about to
// run into.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import {
  type Cell,
  CUE_FILES,
  CUES,
  INTERIOR_COL_MAX,
  SILENCE_FLOOR,
} from "../constants";
import {
  captureStill,
  chainFrom,
  createHarness,
  type Harness,
} from "../harness";
import { decodeSound, showRound } from "./sounds";

/** The path `specs/assets.md` fixes for the death cue. */
const FILE = CUE_FILES[CUES.death];

/** The last interior cell of row 8: one step east of it is the wall border. */
const BRINK: Cell = { col: INTERIOR_COL_MAX, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ships a produced death cue carrying audible signal", async () => {
  const { sound, reason } = await decodeSound(h, FILE);

  await showRound(h, {
    snake: chainFrom(BRINK, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
  });
  await captureStill(h, "death");

  if (sound === null) fail(`a WAV at ${FILE} the browser decodes`, reason);
  assertGreaterThan(sound.frames, 0, `sample frames in ${FILE}`);
  assertGreaterThan(
    sound.peak,
    SILENCE_FLOOR,
    `the peak sample of ${FILE}, on a full scale of 1`,
  );
});
