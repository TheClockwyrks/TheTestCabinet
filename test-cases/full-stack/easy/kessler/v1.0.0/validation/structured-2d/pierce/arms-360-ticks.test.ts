// pierce/arms-360-ticks — a caught pierce pod arms the 360-tick timer.
//
// specs/pods.md fixes the duration in pierce's row of the kinds table — "360
// ticks" — and has each timed effect's timer start "at its duration" on the
// catch. This point is the arming; what happens once the timer reaches `0` is
// `contacts-ordinary-after-expiry`, so a build that arms the right timer and
// mishandles its expiry loses one point rather than both.
//
// THE ONE-TICK LATITUDE is honest rather than slack: specs/field.md's tick order
// falls the timers at step 3 and resolves the catch at step 4, and a build that
// orders the catch before the tick's own decrement reads 359 without departing
// from anything the specification states.
//
// THE WORLD IS ONE FALLING POD AND THE DEFLECTOR, per isolate(), which holds
// `podSpawn` off — a switch that gates the DRAWN pods of destructions, so a
// posed pod falls and is caught unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import { PIERCE_DURATION, poseIsolated, spawnPiercePod } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts pierceTicks at its full 360 on the catch", async () => {
  await poseIsolated(h);
  // Falling at 2 units per tick from radius 199, on the deflector's boot
  // angle: the crossing of catch radius 196 resolves on tick 2 (197 to 195).
  await spawnPiercePod(h, 199, 90);

  const after = await captureReplay(h, "catch", async () => {
    const caught = await h.tick(2);
    await h.tick(4);
    return caught;
  });

  assertLength(after.pods, 0, "the pod was caught");
  assertBetween(
    after.effects.pierceTicks,
    PIERCE_DURATION - 1,
    PIERCE_DURATION,
    "the timer the catch armed, at its full 360-tick duration",
  );
});
