// orbits/ring2-speed-cap — ring 2's orbit speed stops rising at 45 degrees per
// second.
//
// The ring table of specs/rings.md gives ring 2 "+min(12 + 3 * (w - 1), 45)
// degrees per second": the formula reaches the cap exactly at wave 12
// (12 + 33), and every wave beyond holds it. So a second of wave-12 ticks and
// a second of wave-30 ticks each advance the ring +45 degrees — "and no
// faster", which the same close reading decides in both directions. Tolerance
// is float accumulation only: the figure is exact in the spec.
//
// THE WORLD IS THE RINGS ALONE. No targets, balls, or pods — an orbit is the
// ring's own angle.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { RING2_SPEED_CAP } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { advanceDeg, ringAngle, ringSpeed } from "./rings";

/** The cap of specs/rings.md's ring 2 formula, degrees per second. */
const CAP_DEG_PER_SEC = RING2_SPEED_CAP;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances exactly +45 degrees over a second at wave 12", async () => {
  await isolate(h);
  await h.debug.setWave(12);
  const posed = await h.snapshot();
  assertCloseTo(
    ringSpeed(posed, 2),
    CAP_DEG_PER_SEC,
    6,
    "ring 2's reported speed at wave 12, where the formula meets the cap",
  );

  const from = ringAngle(posed, 2);
  const after = await captureReplay(h, "capped", () => h.tick(60));

  assertCloseTo(
    advanceDeg(from, ringAngle(after, 2)),
    CAP_DEG_PER_SEC,
    2,
    "ring 2's advance over 60 wave-12 ticks",
  );
});

it("advances exactly +45 degrees over a second at wave 30", async () => {
  await isolate(h);
  await h.debug.setWave(30);
  const posed = await h.snapshot();
  assertCloseTo(
    ringSpeed(posed, 2),
    CAP_DEG_PER_SEC,
    6,
    "ring 2's reported speed far beyond the capping wave",
  );

  const from = ringAngle(posed, 2);
  const after = await h.tick(60);

  assertCloseTo(
    advanceDeg(from, ringAngle(after, 2)),
    CAP_DEG_PER_SEC,
    2,
    "ring 2's advance over 60 wave-30 ticks — no faster than the cap",
  );
});
