// Wick — instrumentation/set-next-puddle-offset: `setNextPuddleOffset(-120,
// 200)` on `playing` sets `nextPuddleOffset` to `(-120, 200)`, the snapshot
// reads it back, and the next Oil Splash firing lands a puddle at the
// lamplighter's center plus that offset.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextPuddleOffset(dx, dy)`): "One puddle of the next
// Oil Splash or Blaze firing lands at the lamplighter's center of that tick
// plus the offset, the firing's other puddles land at random". A level-1 row
// fires one puddle, so that puddle is the posed one.
//
// THE POSE. An isolated night with the lamplighter off the origin, Oil Splash
// at level 1, whose row fires one puddle, held, armed, and fired through the
// shared `fireFromPosed`.
//
// THE TOLERANCE. `REAL_EPS` on the point, a sum of two posed figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { fireFromPosed } from "../oil-splash/firing";

const PLAYER_AT = { x: 300, y: 100 };
const OFFSET = { x: -120, y: 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("poses the next puddle's landing offset, and the puddle lands there", async () => {
  isolate(h);
  h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  h.debug.setNextPuddleOffset(OFFSET.x, OFFSET.y);
  assertDeepEqual(
    h.snapshot().run.nextPuddleOffset,
    OFFSET,
    "nextPuddleOffset after the pose",
  );

  const firing = await fireFromPosed(h, 1);
  captureStill(h, "landed");

  assertLength(firing.puddles, 1, "puddles the level-1 firing created");
  assertNear(
    firing.puddles[0].x,
    PLAYER_AT.x + OFFSET.x,
    REAL_EPS,
    "the puddle's x",
  );
  assertNear(
    firing.puddles[0].y,
    PLAYER_AT.y + OFFSET.y,
    REAL_EPS,
    "the puddle's y",
  );
});
