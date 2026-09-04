// orbits/ring1-stationary — ring 1 never orbits: its angle holds while rings 2
// and 3 advance.
//
// The ring table of specs/rings.md gives ring 1 an orbit speed of "0
// (stationary)" at every wave, and specs/rings.md advances each ring "by its
// orbit speed in step 2 of the tick order" — an advance of zero leaves the
// angle exactly where it was posed, so the reading is tight (a 5e-4 float
// allowance) rather than a drift budget. The angle is posed at 123, away from
// the 0 a session starts at, so a ring that holds is distinguishable from one
// that resets; and the hold is read at wave 1 and at wave 12, sampling "at
// every wave" at the formula's base and inside its capped region.
//
// THE WORLD IS THE RINGS ALONE. No targets, balls, or pods: an orbit is the
// ring's own angle, and everything else belongs to other checks.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { advanceDeg, ringAngle, ringSpeed } from "./rings";

/** Where ring 1 is posed: any angle a reset would not restore. */
const POSED_DEG = 123;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the posed angle across a second while rings 2 and 3 move", async () => {
  await isolate(h);
  await h.debug.setRingAngle(1, POSED_DEG);
  const posed = await h.snapshot();
  assertCloseTo(ringAngle(posed, 1), POSED_DEG, 3, "the posed ring 1 angle");
  assertCloseTo(ringSpeed(posed, 1), 0, 6, "ring 1's orbit speed at wave 1");

  const after = await captureReplay(h, "hold", () => h.tick(60));

  assertCloseTo(
    ringAngle(after, 1),
    POSED_DEG,
    3,
    "ring 1's angle after a second of ticks",
  );
  // The hold is a hold of ring 1, not a frozen simulation: the moving rings
  // moved over the same second.
  assertGreaterThan(
    Math.abs(advanceDeg(0, ringAngle(after, 2))),
    1,
    "ring 2's advance over the same second",
  );
  assertGreaterThan(
    Math.abs(advanceDeg(0, ringAngle(after, 3))),
    1,
    "ring 3's advance over the same second",
  );
});

it("still holds at wave 12, inside the capped region", async () => {
  await isolate(h);
  await h.debug.setWave(12);
  await h.debug.setRingAngle(1, POSED_DEG);
  const posed = await h.snapshot();
  assertCloseTo(ringSpeed(posed, 1), 0, 6, "ring 1's orbit speed at wave 12");

  const after = await h.tick(60);

  assertCloseTo(
    ringAngle(after, 1),
    POSED_DEG,
    3,
    "ring 1's angle after a second of wave-12 ticks",
  );
});
