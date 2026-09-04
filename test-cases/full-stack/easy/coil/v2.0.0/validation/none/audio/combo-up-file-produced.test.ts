// audio/combo-up-file-produced — the combo cue is a sound this build made, not
// silence.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the `combo-up` cue at
// `assets/audio/combo-up.wav`, made with `sfx-synth` or `sfx-sample`, and
// requires the file to be produced during this build and committed rather than
// downloaded or stood in for. `specs/ui.md` binds the cue to the combo
// multiplier rising. So the file exists, it is a WAV, it holds samples, and those
// samples carry signal.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the sound is like: "brighter and
// higher than `eat`, so a player hears the multiplier rise on a tick that also
// plays `eat`" is `specs/assets.md`'s sound bar and the presentation domain's
// aesthetic rating — brightness is not a figure a check can read off a waveform
// without inventing a threshold the specification never stated. That the build
// plays it on the rise is `audio/combo-up-cue-plays`.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes: the RIFF header in Node, so a file merely wearing the
// extension is caught, and the samples through the browser, which decodes every
// sample format the generators may write — see `audio/sounds.ts`.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// the moment the cue belongs to: a round carrying a live multiplier with an open
// window, one cell from the pellet that will raise it again.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { COMBO_WINDOW, CUE_FILES, CUES, SILENCE_FLOOR } from "../constants";
import {
  ahead,
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  type Harness,
} from "../harness";
import { decodeSound, showRound } from "./sounds";

/** The path `specs/assets.md` fixes for the combo cue. */
const FILE = CUE_FILES[CUES.comboUp];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ships a produced combo cue carrying audible signal", async () => {
  const { sound, reason } = await decodeSound(h, FILE);

  await showRound(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: ahead(HOME_HEAD, "right"),
    combo: 3,
    comboWindow: COMBO_WINDOW,
    travel: false,
  });
  await captureStill(h, "combo");

  if (sound === null) fail(`a WAV at ${FILE} the browser decodes`, reason);
  assertGreaterThan(sound.frames, 0, `sample frames in ${FILE}`);
  assertGreaterThan(
    sound.peak,
    SILENCE_FLOOR,
    `the peak sample of ${FILE}, on a full scale of 1`,
  );
});
