// audio/eat-shorter-than-a-tick — the eat cue fits inside one tick.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` states it as the eat's own
// bar: "`eat` is short and dry, well under a tick, so eight of them in a second
// stay distinct rather than smearing into one tone." The tick is
// `specs/movement.md`'s `TICK_SECONDS` (`0.125`), which is the interval a snake
// travelling through a line of pellets eats on, so a cue longer than one is still
// sounding when the next begins.
//
// WHAT IS READ. The file's own length, taken from the decoded buffer, against
// `TICK_SECONDS`. "Well under" is the bar's own hedge and not a figure, so what
// is asserted is the figure the tick actually is: a cue at or over a tick smears,
// and a cue under it does not. How far under is the build's to choose.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes, and decoded through the browser, which handles every
// sample format the generators may write — see `audio/sounds.ts`. That the file
// exists at all and carries signal is `audio/eat-file-produced`.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// the moment the cue belongs to: the head one cell from the pellet it eats.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files, so the pose
// that puts the game beside them is guarded: a build whose debug surface
// cannot take the pose loses the picture and keeps the point, and no still is
// recorded over the un-posed frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, fail } from "../assert";
import { CUES, CUE_FILES, TICK_SECONDS } from "../constants";
import {
  ahead,
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  type Harness,
} from "../harness";
import { decodeSound, showRound } from "./sounds";

/** The path `specs/assets.md` fixes for the eat cue. */
const FILE = CUE_FILES[CUES.eat];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ships an eat cue shorter than one tick", async () => {
  const { sound, reason } = await decodeSound(h, FILE);

  try {
    await showRound(h, {
      snake: chainFrom(HOME_HEAD, "right", 4),
      dir: "right",
      pellet: ahead(HOME_HEAD, "right"),
      travel: false,
    });
    await captureStill(h, "eat");
  } catch (error) {
    // Evidence only; the readings below carry the verdict.
    console.warn(
      `coil: could not pose the still for \`eat\`, so none is recorded: ${String(error)}`,
    );
  }

  if (sound === null) fail(`a WAV at ${FILE} the browser decodes`, reason);
  assertLessThan(
    sound.duration,
    TICK_SECONDS,
    `the length of ${FILE} in seconds, against TICK_SECONDS`,
  );
});
