// audio/eat-file-produced — the eat cue is a sound this build made, not silence.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the `eat` cue at
// `assets/audio/eat.wav`, made with `sfx-synth` or `sfx-sample`, and requires
// that the file be produced during this build and committed: "pre-made art, a
// downloaded sound, or a bundled font standing in for a produced file does not
// meet this contract." `specs/ui.md` binds the cue to the snake eating a pellet.
// So the file exists, it is a WAV, it holds samples, and those samples carry
// signal.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the sound is like: "short and dry",
// sharing "a palette of timbres" with the other three, is `specs/assets.md`'s
// sound bar and the presentation domain's aesthetic rating. The one figure that
// bar states as a number is the length, and that is
// `audio/eat-shorter-than-a-tick`. That the build actually PLAYS it on the eat
// is `audio/eat-cue-plays`.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes: its RIFF header, so a file merely wearing the
// extension is caught, and then its samples — see `audio/sounds.ts` for why the
// bytes are read here rather than through the engine, and why reading them here
// covers every encoding a generation binary writes.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// the moment the cue belongs to: the head one cell from the pellet it is about
// to eat.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { CUES } from "../../src/constants";
import {
  ahead,
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  type Harness,
} from "../harness";
import { CUE_FILES, readSound, SILENCE_FLOOR, showRound } from "./sounds";

/** The path `specs/assets.md` fixes for the eat cue. */
const FILE = CUE_FILES[CUES.eat];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships a produced eat cue carrying audible signal", async () => {
  const { sound, reason } = readSound(FILE);

  await showRound(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: ahead(HOME_HEAD, "right"),
    travel: false,
  });
  captureStill(h, "eat");

  if (sound === null) fail(`a readable PCM WAV at ${FILE}`, reason);
  assertGreaterThan(sound.frames, 0, `sample frames in ${FILE}`);
  assertGreaterThan(
    sound.peak,
    SILENCE_FLOOR,
    `the peak sample of ${FILE}, on a full scale of 1`,
  );
});
