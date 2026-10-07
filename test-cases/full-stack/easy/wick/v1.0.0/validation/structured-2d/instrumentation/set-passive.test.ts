// Wick — instrumentation/set-passive: with no passive held,
// `setPassive(0, 'bellows', 2)` reads back Bellows at level 2 and `moveSpeed`
// 216 from the next read.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setPassive(slot, id, level)`: "Puts passive `id` ... at `level` in `slot`
// ... `moveSpeed` ... and every multiplier follow from the next read"; the
// derived table: `moveSpeed` is `MOVE_SPEED (180) × (1 + 0.1 × Bellows)`,
// 216 at level 2 (`REAL_EPS`, one product).
//
// THE POSE. An isolated run holding no passive, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNear } from "../assert";
import { REAL_EPS, moveSpeedOf } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds Bellows at level 2 and derives moveSpeed 216", async () => {
  const start = isolate(h);
  assertDeepEqual(start.run.passives, [], "passives before the pose");

  h.debug.setPassive(0, "bellows", LEVEL);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "posed");
  assertDeepEqual(
    after.run.passives,
    [{ id: "bellows", level: LEVEL }],
    "passives after setPassive(0, 'bellows', 2)",
  );
  assertNear(
    after.run.moveSpeed,
    moveSpeedOf(LEVEL),
    REAL_EPS,
    "run.moveSpeed from the next read",
  );
});
