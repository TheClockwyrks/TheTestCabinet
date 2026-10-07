// Wick — instrumentation/set-next-puddle-offset: `setNextPuddleOffset(-120,
// 200)` on `playing` sets `nextPuddleOffset` to `(-120, 200)`, the snapshot
// reads it back, and the next Oil Splash firing lands a puddle at the
// lamplighter's center plus that offset.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextPuddleOffset(dx, dy)`): "One puddle of the next Oil
// Splash or Blaze firing lands at the lamplighter's center of that tick plus
// the offset, the firing's other puddles land at random". A level-1 row fires
// one puddle, so that puddle is the posed one.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with the lamplighter off
// the origin, Oil Splash at level 1, whose row fires one puddle, fired through
// the shared `fireWeapon`; nothing else runs.
//
// THE TOLERANCE. `POSITION_TOL`, the `1e-6` a position is allowed: the point
// is a sum of two posed figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { puddlesOf } from "../oil-splash/stage";

const PLAYER_AT = { x: 300, y: 100 };
const OFFSET = { x: -120, y: 200 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the next puddle's landing offset, and the puddle lands there", async () => {
  await isolate(h);
  await h.debug.setPlayerPosition(PLAYER_AT.x, PLAYER_AT.y);
  await h.debug.setNextPuddleOffset(OFFSET.x, OFFSET.y);
  const posed = await h.snapshot();
  assertDeepEqual(
    posed.run.nextPuddleOffset,
    OFFSET,
    "nextPuddleOffset after the pose",
  );

  const firing = await fireWeapon(h, "oil-splash", 1);
  await captureStill(h, "landed");

  const puddles = puddlesOf(firing);
  assertLength(puddles, 1, "puddles the level-1 firing created");
  assertNear(
    puddles[0]!.x,
    PLAYER_AT.x + OFFSET.x,
    POSITION_TOL,
    "the puddle's x",
  );
  assertNear(
    puddles[0]!.y,
    PLAYER_AT.y + OFFSET.y,
    POSITION_TOL,
    "the puddle's y",
  );
});
