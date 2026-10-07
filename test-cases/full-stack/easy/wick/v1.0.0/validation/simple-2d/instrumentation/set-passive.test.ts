// instrumentation/set-passive — with no passive held,
// `setPassive(0, 'bellows', 2)` reads back passives as Bellows at level 2 and
// moveSpeed 216 from the next read.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setPassive`: "Puts
// passive `id`, a `PassiveId`, at `level` in `slot`. `slot` is `0` to
// `passives.length` ... `maxHp`, `armor`, `moveSpeed`, `pickupRadius`, and
// every multiplier follow from the next read"; the "Derived from" table:
// `moveSpeed` is "`MOVE_SPEED` (`180`) `× (1 + BELLOWS_SPEED_PER_LEVEL`
// (`0.1`) `×` the Bellows level held`)`", 216 at level 2.
//
// THE POSE. An isolated run with no passive, the pose, the read back without
// a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, moveSpeedFor } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds Bellows and derives the move speed from it", async () => {
  const posed = isolate(h);
  assertLength(posed.run.passives, 0, "the passives before the pose");

  h.debug.setPassive(0, "bellows", LEVEL);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "posed");

  assertDeepEqual(
    s.run.passives,
    [{ id: "bellows", level: LEVEL }],
    "passives after the pose",
  );
  assertWithin(
    s.run.moveSpeed,
    moveSpeedFor({ bellows: LEVEL }),
    FIGURE_TOLERANCE,
    "moveSpeed from the next read",
  );
});
