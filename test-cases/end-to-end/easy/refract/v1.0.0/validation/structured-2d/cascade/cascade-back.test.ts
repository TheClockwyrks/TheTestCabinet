// Refract — cascade/cascade-back: back abandons the board and ends the
// sequence.
//
// specs/modes/cascade.md "The sequence": `back` during playing abandons the
// board and returns to title, ending the sequence — starting Cascade again
// begins a fresh one from tier 1. Progress is built first (five real solves,
// so solvedCount is 5 and the tier has climbed) so a fresh sequence is
// distinguishable from a continued one, then `back` is pressed and CASCADE is
// chosen again through the real title menu (menuIndex is 0 on arriving at the
// title, specs/ui.md, so `down` then `confirm` lands on CASCADE).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { TIER_ADVANCE } from "../notation";

const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to title on back, and Cascade restarts from count 0 and tier 1", async () => {
  // Four real solves, then NEXT BOARD: playing with progress worth discarding.
  await solveGenerated(h, TIER_ADVANCE, SEED);
  await tapAction(h, "confirm");
  const playing = h.snapshot();
  assertEqual(playing.screen, "playing", "a mid-sequence board is up");
  assertEqual(playing.solvedCount, TIER_ADVANCE, "progress stands before back");

  await tapAction(h, "back");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "title", "back abandons the board to title");

  // Start Cascade again, the real menu path from the fresh title arrival.
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  await h.advance(1);
  // The fresh sequence after backing out.
  captureStill(h, "fresh");

  const fresh = h.snapshot();
  assertEqual(fresh.screen, "playing", "Cascade starts again on playing");
  assertEqual(fresh.mode, "cascade", "the restarted mode is cascade");
  assertEqual(
    fresh.solvedCount,
    0,
    "the fresh sequence starts at solvedCount 0",
  );
  assertEqual(fresh.tier, 1, "the fresh sequence starts at tier 1");
});
