// Wick — instrumentation/spawn-pickup: `spawnPickup("bread", 200, 0)` appears
// in the snapshot as a bread pickup at `(200, 0)` with the next id, and it
// stays put across 60 ticks.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnPickup(kind, x, y)`): "Places one pickup of `kind`, a `PickupKind`,
// at `(x, y)` with the next id." specs/world.md — "Pickups": a pickup "sits
// where it was dropped and stays on the field until it is collected", and it
// is collected only within "`PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`"
// of the lamplighter, far inside 200 units.
//
// WHY THE WORLD IS POSED AS IT IS. An empty night, so the next id is the one
// the snapshot held before the call; the lamplighter stands still at the
// origin, out of reach of the pickup.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";

const AT = { x: 200, y: 0 };
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a pickup with the next id, which stays put", async () => {
  await isolate(h);
  const before = await h.snapshot();

  const bread = await placePickup(h, "bread", AT.x, AT.y);
  assertEqual(bread.id, before.run.nextId, "the pickup's id, the next id");
  assertEqual(bread.kind, "bread", "the pickup's kind");
  assertNear(bread.x, AT.x, POSITION_TOL, "the pickup's x");
  assertNear(bread.y, AT.y, POSITION_TOL, "the pickup's y");

  const later = await h.step(HELD_TICKS);
  await captureStill(h, "placed");
  const still = pickupById(later, bread.id);
  assertNear(
    still?.x ?? NaN,
    AT.x,
    POSITION_TOL,
    `the pickup's x after ${HELD_TICKS} ticks`,
  );
  assertNear(
    still?.y ?? NaN,
    AT.y,
    POSITION_TOL,
    `the pickup's y after ${HELD_TICKS} ticks`,
  );
});
