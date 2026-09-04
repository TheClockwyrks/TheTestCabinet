// growth/first-pellet-off-start-chain — the first pellet of a round is valid.
//
// specs/board.md: "The first pellet of a round is placed after the snake is laid
// at its starting cells, so it never lands under the starting chain." That is an
// ORDERING requirement written as an outcome, and the outcome is what is read: an
// interior cell that is none of the three cells specs/board.md lays the chain on.
// A build that draws the pellet before laying the snake fails once in every
// hundred and fifty rounds or so, which is exactly the kind of defect a person
// reviewing by hand never sees.
//
// WHY THIS POINT PRESSES A KEY. A fresh round is laid out by starting one, and
// specs/instrumentation.md is explicit that `setScreen("playing")` does not do
// that: it "runs the tick over the board as it stands rather than laying out a
// fresh round". So the only way to reach the thing under test is the title menu's
// first item, which specs/ui.md makes the mode's own entry. `reset({ seed })` is
// what varies the draw between rounds, and several seeds are opened because one
// round is one draw and one draw proves nothing about an ordering.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { DEFAULT_SEED, START_CELLS } from "../constants";
import {
  captureStill,
  chooseItem,
  createHarness,
  holdsCell,
  isInterior,
  type Cell,
  type Harness,
} from "../harness";

/** The seeds the round is opened under, so the draw is a different one each time. */
const SEEDS = [DEFAULT_SEED, DEFAULT_SEED + 1, 17, 101, 4242];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens every round with its pellet clear of the starting chain", async () => {
  for (const [index, seed] of SEEDS.entries()) {
    h.debug.reset({ seed });
    await chooseItem(h, 0);
    const opened = h.snapshot();
    if (index === 0) {
      // The round the reading is taken off, kept as the point's evidence.
      captureStill(h, "first");
    }

    assertEqual(
      opened.screen,
      "playing",
      `the round opened under seed ${seed}`,
    );
    assertNotNull(opened.pellet, `the first pellet under seed ${seed}`);
    const pellet = opened.pellet as Cell;
    assertEqual(
      isInterior(pellet.col, pellet.row),
      true,
      `the first pellet under seed ${seed} on an interior cell`,
    );
    assertEqual(
      holdsCell(START_CELLS, pellet),
      false,
      `the first pellet under seed ${seed} clear of the starting chain`,
    );
  }
});
