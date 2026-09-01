// Wick — instrumentation/spawn-pickup: `spawnPickup('bread', 200, 0)`
// appears as a bread pickup at (200, 0) with the next id, and stays put across
// 60 ticks.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnPickup(kind, x, y)`: "Places one pickup of `kind` ... at `(x, y)` with
// the next id." `specs/world.md`, "Pickups": "it sits where it was dropped and
// stays on the field until it is collected", and collection needs it within
// `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (28): 200 units is outside it.
//
// THE DRIVE. An isolated run, the id read off `nextId`, the pose read at the
// call, 60 ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
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

it("places a pickup that stays put", async () => {
  isolate(h);
  const expectedId = h.snapshot().run.nextId;
  const id = placePickup(h, "bread", X, 0);
  assertEqual(id, expectedId, "the id the pickup took");
  const placed = { id, kind: "bread", x: X, y: 0 };
  assertDeepEqual(
    pickupById(h.snapshot(), id),
    placed,
    "the pickup at the call",
  );

  const later = await advanceTicks(h, HELD_TICKS);
  captureStill(h, "placed");
  assertDeepEqual(
    pickupById(later, id),
    placed,
    `the pickup after ${HELD_TICKS} ticks`,
  );
});
