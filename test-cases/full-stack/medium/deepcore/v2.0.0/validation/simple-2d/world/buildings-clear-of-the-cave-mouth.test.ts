// world/buildings-clear-of-the-cave-mouth — nothing stands over the way down.
//
// `specs/world.md`, of every building: "Every footprint ... covers no part of
// `(CAVE_MOUTH_COL, 1)`." A building standing over the one way down out of the
// camp is the way the surface stops working, whatever else about the camp is
// right.
//
// HOW THE CAVE MOUTH IS READ. Every footprint's base sits exactly on the ground
// line and the cave-mouth cell lies entirely below it, so two rectangles can only
// meet along that line and never overlap by area. Read that way the rule would
// say nothing at all. What it is for is the descent, so it is read as the
// horizontal one it must be: no footprint spans any part of the cave mouth's
// column, `[CAVE_MOUTH_COL * TILE, (CAVE_MOUTH_COL + 1) * TILE]`.
//
// THE SPACING IS ITS OWN POINT, `world/buildings-separated`.

import { afterEach, beforeEach, it } from "vitest";
import { CAVE_MOUTH_COL, TILE } from "../constants";
import { assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { campFootprints } from "./buildings";

/** The world `x` span of the cave mouth's cell. */
const MOUTH_LEFT = CAVE_MOUTH_COL * TILE;
const MOUTH_RIGHT = (CAVE_MOUTH_COL + 1) * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands no building over the cave mouth's column", async () => {
  const boxes = await campFootprints(h);
  captureStill(h, "mouth");

  for (const box of boxes) {
    assertTrue(
      box.x + box.w <= MOUTH_LEFT || box.x >= MOUTH_RIGHT,
      `"${box.id}" clear of the cave mouth's column, which spans ${MOUTH_LEFT} to ${MOUTH_RIGHT}`,
    );
  }
});
