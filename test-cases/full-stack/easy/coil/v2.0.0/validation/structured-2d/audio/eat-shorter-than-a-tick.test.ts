// audio/eat-shorter-than-a-tick — the eat cue fits inside one tick.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` states it as the eat's own
// bar: "`eat` is short and dry, well under a tick, so eight of them in a second
// stay distinct rather than smearing into one tone." The tick is
// `specs/movement.md`'s `TICK_SECONDS` (`0.125`), which is the interval a snake
// travelling through a line of pellets eats on, so a cue longer than one is still
// sounding when the next begins.
//
// WHAT IS READ. The file's own length, against `TICK_SECONDS`. "Well under" is
// the bar's own hedge and not a figure, so what is asserted is the figure the
// tick actually is: a cue at or over a tick smears, and a cue under it does not.
// How far under is the build's to choose.
//
// HOW THE FILE IS READ. Off the repository the build produced, at the path
// `specs/assets.md` fixes. The length comes off the container's own header — the
// `data` chunk against the bytes-a-second the `fmt ` chunk declares — so it is
// the same figure whatever encodes the samples (`audio/sounds.ts`). That the file
// exists at all and carries signal is `audio/eat-file-produced`.
//
// THE EVIDENCE. This point drives nothing, so its declared still is a picture of
// the moment the cue belongs to: the head one cell from the pellet it eats.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, fail } from "../assert";
import { CUES, TICK_SECONDS } from "../constants";
import {
  ahead,
  captureStill,
  chainFrom,
  createHarness,
  HOME_HEAD,
  type Harness,
} from "../harness";
import { CUE_FILES, readSound, showRound } from "./sounds";

/** The path `specs/assets.md` fixes for the eat cue. */
const FILE = CUE_FILES[CUES.eat];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships an eat cue shorter than one tick", async () => {
  const { sound, reason } = readSound(FILE);

  await showRound(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: ahead(HOME_HEAD, "right"),
    travel: false,
  });
  captureStill(h, "eat");

  if (sound === null) fail(`a readable PCM WAV at ${FILE}`, reason);
  assertLessThan(
    sound.duration,
    TICK_SECONDS,
    `the length of ${FILE} in seconds, against TICK_SECONDS`,
  );
});
