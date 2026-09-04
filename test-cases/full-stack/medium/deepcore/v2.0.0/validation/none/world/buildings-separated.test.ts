// world/buildings-separated — the buildings stand apart, and clear of the mouth.
//
// `specs/world.md` states two rules over where the six buildings are placed: "No
// two footprints overlap, and any two footprints are separated horizontally by at
// least `BUILDING_GAP` (`40`) units of clear ground", and "Every footprint ...
// covers no part of `(CAVE_MOUTH_COL, 1)`". Both are about the camp being
// walkable: buildings a prospector cannot tell apart because they touch, and a
// building standing over the one way down out of the camp, are the two ways the
// surface stops working.
//
// HOW THE CAVE MOUTH IS READ. Every footprint's base sits exactly on the ground
// line and the cave-mouth cell lies entirely below it, so two rectangles can only
// meet along that line and never overlap by area. Read that way the rule would
// say nothing at all. What it is for is the descent, so it is read as the
// horizontal one it must be: no footprint spans any part of the cave mouth's
// column, `[CAVE_MOUTH_COL * TILE, (CAVE_MOUTH_COL + 1) * TILE]`.
//
// The gap is measured between every pair, in both orders, and reported naming the
// two buildings that are too close.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertTrue, fail } from "../assert";
import { BUILDING_GAP, BUILDING_IDS, CAVE_MOUTH_COL, TILE } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type Harness,
} from "../harness";

/** The world `x` span of the cave mouth's cell. */
const MOUTH_LEFT = CAVE_MOUTH_COL * TILE;
const MOUTH_RIGHT = (CAVE_MOUTH_COL + 1) * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves 40 units of clear ground between any two buildings, and none over the cave mouth", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinDrill(h);
  await h.advance(2);

  const reported = await h.debug.buildings();
  const boxes = BUILDING_IDS.map((id) => {
    const box = reported.find((entry) => entry.id === id);
    if (box === undefined) {
      fail(
        `a footprint for the "${id}" specs/world.md names`,
        `buildings() reported ${reported.length === 0 ? "none" : reported.map((b) => b.id).join(", ")}`,
      );
    }
    return box;
  });

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      assertGreaterThanOrEqual(
        gap,
        BUILDING_GAP,
        `clear ground between "${a.id}" and "${b.id}"`,
      );
    }
  }

  for (const box of boxes) {
    assertTrue(
      box.x + box.w <= MOUTH_LEFT || box.x >= MOUTH_RIGHT,
      `"${box.id}" clear of the cave mouth's column, which spans ${MOUTH_LEFT} to ${MOUTH_RIGHT}`,
    );
  }

  // The picture: the gaps between the buildings of the camp.
  await captureStill(h, "gaps");
});
