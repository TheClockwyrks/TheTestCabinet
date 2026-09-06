// instrumentation/set-next-puddle-offset — `setNextPuddleOffset(-120, 200)`
// on `playing` sets `nextPuddleOffset` to `(-120, 200)`, the snapshot reads it
// back, and the next Oil Splash firing's first puddle lands at the
// lamplighter's center plus that offset.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextPuddleOffset(dx, dy)`): "The first puddle the next Oil Splash or
// Blaze firing places lands at the lamplighter's center of that tick plus the
// offset, the firing's other puddles land at random".
//
// THE POSE. An isolated night with the lamplighter off the origin, Oil Splash
// at level 1, whose row fires one puddle, armed through the shared
// `armOilSplash` and fired through `fireOnce`.
//
// THE TOLERANCE. `FIGURE_TOLERANCE` on the point, a sum of two posed figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armOilSplash, fireOnce } from "../oil-splash/puddle";

const PLAYER_AT = { x: 300, y: 100 };
const OFFSET = { x: -120, y: 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses the next puddle's landing offset, and the puddle lands there", async () => {
  const armed = armOilSplash(h, 1);
  h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  h.debug.setNextPuddleOffset(OFFSET.x, OFFSET.y);
  assertDeepEqual(
    h.snapshot().run.nextPuddleOffset,
    OFFSET,
    "nextPuddleOffset after the pose",
  );

  const { created } = await fireOnce(h, armed.slot);
  captureStill(h, "landed");

  assertLength(created, 1, "puddles the level-1 firing created");
  assertWithin(
    created[0].x,
    PLAYER_AT.x + OFFSET.x,
    FIGURE_TOLERANCE,
    "the puddle's x",
  );
  assertWithin(
    created[0].y,
    PLAYER_AT.y + OFFSET.y,
    FIGURE_TOLERANCE,
    "the puddle's y",
  );
});
