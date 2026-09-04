// Refract — cascade/cascade-back-to-title: back abandons the board and returns
// to the title.
//
// specs/modes/cascade.md "The sequence": `back` during playing abandons the
// board and returns to title with CASCADE highlighted (menuIndex 1). That the
// sequence is really ENDED by it — a fresh one starting from tier 1 afterwards
// — is cascade/cascade-restarts-fresh's point.
//
// Progress is built first (TIER_ADVANCE real solves, so solvedCount has moved
// and the tier has climbed), so the board being abandoned is a board of a run
// in progress rather than the first board of a fresh one.

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

it("returns to title with CASCADE highlighted", async () => {
  // Real solves, then NEXT BOARD: playing with progress worth discarding.
  await solveGenerated(h, TIER_ADVANCE, SEED);
  await tapAction(h, "confirm");
  const playing = h.snapshot();
  assertEqual(playing.screen, "playing", "a mid-sequence board is up");
  assertEqual(playing.solvedCount, TIER_ADVANCE, "progress stands before back");

  await tapAction(h, "back");
  await h.advance(1);
  captureStill(h, "abandoned");
  assertEqual(h.snapshot().screen, "title", "back abandons the board to title");
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "the title is reached with CASCADE, the entry that led away, highlighted",
  );
});
