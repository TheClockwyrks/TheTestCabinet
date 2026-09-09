// audio/music-file-produced — the music bed is a track this build made, not
// silence.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` puts the `music` bed at
// `assets/audio/music.wav`, made with the `music` binary — which "writes a `.wav`
// and a `.mid` beside it; the `.wav` is what the game plays" — and requires the
// file to be produced during this build and committed rather than downloaded or
// stood in for. `specs/ui.md` has it play when a round begins and loop under the
// game until the round ends. So the file exists, it is a WAV, it holds samples,
// and those samples carry signal.
//
// WHAT IT DELIBERATELY DOES NOT READ. What the track is like: "a loop that sits
// under the game rather than over it", looping "without an audible seam" and
// carrying "no part that competes with the three cues", is `specs/assets.md`'s
// sound bar and the presentation domain's aesthetic rating. That the build plays
// it when a round begins is `audio/music-cue-plays`.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes: the RIFF header in Node, so a file merely wearing the
// extension is caught, and the samples through the browser, which decodes every
// sample format the generators may write — see `audio/sounds.ts`.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// what the bed plays under: a round in play, with the snake threading toward its
// pellet.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files, so the pose
// that puts the game beside them is guarded: a build whose debug surface
// cannot take the pose loses the picture and keeps the point, and no still is
// recorded over the un-posed frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { type Cell, CUE_FILES, CUES } from "../constants";
import {
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  type Harness,
} from "../harness";
import { decodeSound, showRound } from "./sounds";

/** The path `specs/assets.md` fixes for the music bed. */
const FILE = CUE_FILES[CUES.music];

/** A pellet out across the board, so the round reads as one being played. */
const PELLET: Cell = { col: 20, row: 5 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ships a produced music bed carrying signal", async () => {
  const { sound, reason } = await decodeSound(h, FILE);

  try {
    await showRound(h, {
      snake: chainFrom(HOME_HEAD, "right", 5),
      dir: "right",
      pellet: PELLET,
      travel: false,
    });
    await captureStill(h, "music");
  } catch (error) {
    // Evidence only; the readings below carry the verdict.
    console.warn(
      `coil: could not pose the still for \`music\`, so none is recorded: ${String(error)}`,
    );
  }

  if (sound === null) fail(`a WAV at ${FILE} the browser decodes`, reason);
  assertGreaterThan(sound.frames, 0, `sample frames in ${FILE}`);
  assertGreaterThan(
    sound.peak,
    0,
    `the peak sample of ${FILE}, on a full scale of 1`,
  );
});
