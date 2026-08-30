// progression/empty-board-does-not-clear — a board that never held a segment is
// being played, not cleared.
//
// `specs/progression.md`, Clearing a level: "A level clears on the step in which
// the last of its worm segments is removed. The clear is that removal, so a
// board that holds no worm segments and has had none removed is being played
// rather than cleared, and the level stands."
//
// This is the predicate half of the rule, and it is LOAD-BEARING FOR THE WHOLE
// SUITE. The shared harness's `startPlaying` poses an empty board, which is what
// lets every mechanic scenario in this project stand up exactly the entities its
// requirement concerns and nothing else. A build that treats "no worms on the
// board" as a clear advances the level the instant any of those scenarios is
// posed, and none of them can be posed at all.
//
// So the board is posed and then simply left alone for several seconds of game
// time with all three world gates shut — no foe spawns, no worm enters, no
// contact costs a life — and the run is read where it was. A build that clears
// on the predicate answers with a level one higher and a `banner` phase; a build
// that clears and keeps clearing answers with a level several higher, or with
// the victory screen; a correct build answers with the level it was posed on,
// still in live play.
//
// The level posed is deliberately not `1`, so a build that mistakes an empty
// board for a fresh run rather than a clear is caught by the same reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The level the empty board is posed on, and the level it must still report. */
const LEVEL = 4;

/** How long the board is left alone, in seconds of game time. */
const HELD_FOR = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds its level through seconds of empty live play", async () => {
  await startPlaying(h, { level: LEVEL });

  await h.advance(framesFor(HELD_FOR));

  await captureStill(h, "playing");
  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    `the screen after ${HELD_FOR}s on an empty board`,
  );
  assertEqual(
    after.phase,
    "active",
    `the phase after ${HELD_FOR}s on an empty board`,
  );
  assertEqual(
    after.level,
    LEVEL,
    `the level after ${HELD_FOR}s on an empty board`,
  );
});
