// Refract — cascade/generated-crystal-charges-in-range: every generated crystal carries a legal charge count.
//
// specs/modes/cascade.md "The generator": a crystal's charges are 1 to MAX_CHARGES (3),
// "never above MAX_CHARGES". The narrower range a TIER states is
// cascade/tier-crystal-count-and-charges's point; here the subject is the
// generator's outer bound, which no tier may cross.
//
// The same twenty-five-board sweep boards-are-solvable drives is read here:
// every arrived board is held against that row of the contract, and the board
// the sweep leaves the player on afterwards — a fresh tier-5 board — is checked
// too and kept as the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { assertCrystalChargesInRange } from "./helpers";

const SEED = 1;
const BOARDS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only crystals carrying 1 to MAX_CHARGES charges, across the whole sweep", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    assertCrystalChargesInRange(solved[k].board, `board ${k + 1}`);
  }

  // One more board past the sweep, rendered on playing: the picture, and one
  // more reading of the same clause.
  await tapAction(h, "confirm");
  const next = h.snapshot();
  assertEqual(next.screen, "playing", "NEXT BOARD lands on playing");
  captureStill(h, "charges");
  assertCrystalChargesInRange(boardFromSnapshot(next), `board ${BOARDS + 1}`);
});
