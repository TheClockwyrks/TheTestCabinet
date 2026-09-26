// Wick — instrumentation/spawn-gem: `spawnGem('medium', 200, 0)` appears as
// a medium gem at (200, 0) with `attracted` false and the next id, and stays
// put across 60 ticks with the lamplighter at the origin.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnGem(tier, x, y)`: "Places one unattracted gem of `tier` ... at `(x, y)`
// with the next id." `specs/world.md`, "Gems": "A gem sits where it was
// dropped until it is attracted", and attraction needs the gem within
// `pickupRadius` (48 with no Lure): 200 units is outside it.
//
// THE DRIVE. An isolated run, the id read off `nextId`, the pose read at the
// call, 60 ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const X = 200;
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("places an unattracted gem that stays put", async () => {
  isolate(h);
  const expectedId = h.snapshot().run.nextId;
  const id = placeGem(h, "medium", X, 0);
  assertEqual(id, expectedId, "the id the gem took");
  const placed = { id, tier: "medium", x: X, y: 0, attracted: false };
  assertDeepEqual(gemById(h.snapshot(), id), placed, "the gem at the call");

  const later = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "placed");
  assertDeepEqual(
    gemById(later, id),
    placed,
    `the gem after ${HELD_TICKS} ticks`,
  );
});
