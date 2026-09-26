// orbits/ring3-speed-cap — ring 3's orbit speed stops rising at 30 degrees per
// second.
//
// The ring table of specs/rings.md gives ring 3 "-min(8 + 2 * (w - 1), 30)
// degrees per second": the formula reaches the cap exactly at wave 12
// (8 + 22), and every wave beyond holds it. So a second of wave-12 ticks and a
// second of wave-30 ticks each advance the ring -30 degrees — "and no faster",
// which the same close reading decides in both directions, signed so the
// -theta direction is part of the verdict. Tolerance is float accumulation
// only: the figure is exact in the spec.
//
// THE WORLD IS THE RINGS ALONE. No targets, balls, or pods — an orbit is the
// ring's own angle.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { RING3_SPEED_CAP } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { advanceDeg, ringAngle, ringSpeed } from "./rings";

/** The cap of specs/rings.md's ring 3 formula, signed toward -theta. */
const CAP_DEG_PER_SEC = RING3_SPEED_CAP;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances exactly -30 degrees over a second at wave 12", async () => {
  isolate(h);
  h.debug.setWave(12);
  const posed = h.snapshot();
  assertCloseTo(
    ringSpeed(posed, 3),
    CAP_DEG_PER_SEC,
    6,
    "ring 3's reported speed at wave 12, where the formula meets the cap",
  );

  const from = ringAngle(posed, 3);
  const after = await captureReplay(h, "capped", () => h.tick(60));

  assertCloseTo(
    advanceDeg(from, ringAngle(after, 3)),
    CAP_DEG_PER_SEC,
    2,
    "ring 3's advance over 60 wave-12 ticks",
  );
});

it("advances exactly -30 degrees over a second at wave 30", async () => {
  isolate(h);
  h.debug.setWave(30);
  const posed = h.snapshot();
  assertCloseTo(
    ringSpeed(posed, 3),
    CAP_DEG_PER_SEC,
    6,
    "ring 3's reported speed far beyond the capping wave",
  );

  const from = ringAngle(posed, 3);
  const after = await h.tick(60);

  assertCloseTo(
    advanceDeg(from, ringAngle(after, 3)),
    CAP_DEG_PER_SEC,
    2,
    "ring 3's advance over 60 wave-30 ticks — no faster than the cap",
  );
});
