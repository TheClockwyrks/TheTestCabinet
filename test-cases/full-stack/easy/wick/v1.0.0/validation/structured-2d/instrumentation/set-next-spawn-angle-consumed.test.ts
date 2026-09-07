// Wick — instrumentation/set-next-spawn-angle-consumed: the spawn that lands
// at a posed angle consumes it, so `nextSpawnAngle` reads `null` afterwards.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes"): each value "is `null` on the idle run and after the
// draw that consumed it ... and is consumed by one draw alone";
// `setNextSpawnAngle`: "that spawn consumes it".
//
// THE POSE. As `set-next-spawn-angle`: an isolated night in window 0, the
// timer posed due, `spawning` on for one tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

const POSED_ANGLE = 210;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads null once the spawn has taken the posed angle", async () => {
  isolate(h);
  h.debug.setNextSpawnAngle(POSED_ANGLE);
  h.debug.setSpawnTimer(0);
  enable(h, "spawning");
  assertEqual(
    h.snapshot().run.nextSpawnAngle,
    POSED_ANGLE,
    "nextSpawnAngle before the spawn",
  );

  const spawned = await h.tick(1);
  captureStill(h, "consumed");

  assertLength(spawned.run.enemies, 1, "enemies the due tick spawned");
  assertNull(spawned.run.nextSpawnAngle, "nextSpawnAngle after the spawn");
});
