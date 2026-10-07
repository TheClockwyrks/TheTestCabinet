// instrumentation/clear-fish — `clearFish()` takes the bonus catch off the strait
// and leaves every bay exactly as it was.
//
// specs/instrumentation.md gives the operation exactly that scope: "Takes the
// bonus catch off the strait, leaving the bays as they are." specs/bays.md says
// why the two are separable at all — a bonus catch "changes nothing about whether
// its bay may be entered" — so a bonus catch leaving is not a bay opening, and a
// bay is filled by a crossing that ends in it and by nothing else.
//
// WITHOUT IT, A POSED STRAIT CANNOT BE MADE QUIET. `startCrossing` calls it so
// that no bonus catch is sitting in a bay a scenario is about to read, and a
// `clearFish` that opened or filled a bay on its way out would move the very thing
// half this suite poses.
//
// SO THE BAYS ARE POSED UNEVENLY FIRST — three filled and two open, in a pattern
// no symmetry could reproduce by accident — and the whole five are compared entry
// by entry after the call. A build that opened them, filled them, or touched only
// the bay the catch was in is caught by that comparison rather than by a count.
//
// THE CATCH IS POSED INTO AN OPEN BAY, which is where specs/bays.md puts one, so
// nothing here rests on what a build does with a bonus catch in a bay that is
// already filled — `bays/fish-cleared-when-bay-filled` decides that.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. Under this engine a pose acts on
// the live game at the moment of the call and this harness is the only thing that
// steps it, so the bays the second reading finds are the bays the first one did
// rather than bays that merely have not changed yet.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The bays posed filled, and the open bay the bonus catch is posed into. */
const FILLED_BAYS: readonly number[] = [0, 2, 3];
const FISH_BAY = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the bonus catch off and leaves every bay as it was", async () => {
  startCrossing(h);

  for (const bay of FILLED_BAYS) h.debug.setBay(bay, true);
  h.debug.setFishBay(FISH_BAY);

  const before = h.snapshot();
  assertEqual(
    before.fishBay,
    FISH_BAY,
    `the bay holding the bonus catch after setFishBay(${FISH_BAY}) — this point ` +
      `cannot hold clearFish to taking off a catch that was never out`,
  );
  assertEqual(
    before.bays[FISH_BAY],
    false,
    `bay ${FISH_BAY} standing open under the posed bonus catch, which is where ` +
      `specs/bays.md puts one`,
  );

  h.debug.clearFish();
  const cleared = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing clear still leaves the picture of the far
  // shore it produced.
  captureStill(h, "cleared");

  assertEqual(
    cleared.fishBay,
    null,
    "snapshot().fishBay after clearFish(), which takes the bonus catch off the " +
      "strait",
  );
  assertDeepEqual(
    cleared.bays,
    before.bays,
    "the five bays after clearFish(), against the same reading taken at the " +
      "instant before it — the operation leaves the bays as they are",
  );
});
