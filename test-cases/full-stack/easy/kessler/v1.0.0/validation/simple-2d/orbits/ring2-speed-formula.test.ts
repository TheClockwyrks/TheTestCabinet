// orbits/ring2-speed-formula — ring 2 orbits toward +theta at its wave
// formula's speed.
//
// The ring table of specs/rings.md gives ring 2 "+min(12 + 3 * (w - 1), 45)
// degrees per second", so 12 at wave 1 and 18 at wave 3, and specs/rings.md
// advances each ring "by its orbit speed in step 2 of the tick order" — every
// tick, so one wave-1 tick is 12/60 of a degree and sixty of them are 12
// degrees. The advances are read wrap-aware and signed, so a ring orbiting the
// wrong way fails on sign rather than passing on magnitude. Tolerance is float
// accumulation only (5e-4 on one tick, 5e-3 on a second): the figures are
// exact in the spec.
//
// THE WORLD IS THE RINGS ALONE. No targets, balls, or pods — an orbit is the
// ring's own angle.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { advanceDeg, ringAngle, ringSpeed, ringSpeedAt } from "./rings";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances 12/60 of a degree on one wave-1 tick", async () => {
  const posed = isolate(h);
  assertEqual(posed.wave, 1, "the wave the figures are read at");
  assertCloseTo(
    ringSpeed(posed, 2),
    ringSpeedAt(2, 1),
    6,
    "ring 2's reported wave-1 speed",
  );

  const after = await h.tick(1);

  assertCloseTo(
    advanceDeg(0, ringAngle(after, 2)),
    ringSpeedAt(2, 1) / 60,
    3,
    "the advance one tick's step 2 gave ring 2",
  );
});

it("advances +12 degrees over a second of wave-1 ticks", async () => {
  isolate(h);

  const after = await captureReplay(h, "orbit", () => h.tick(60));

  assertCloseTo(
    advanceDeg(0, ringAngle(after, 2)),
    ringSpeedAt(2, 1),
    2,
    "ring 2's advance over 60 wave-1 ticks, signed toward +theta",
  );
});

it("advances +18 degrees over a second of wave-3 ticks", async () => {
  isolate(h);
  h.debug.setWave(3);
  const posed = h.snapshot();
  assertCloseTo(
    ringSpeed(posed, 2),
    ringSpeedAt(2, 3),
    6,
    "ring 2's reported wave-3 speed",
  );

  const from = ringAngle(posed, 2);
  const after = await h.tick(60);

  assertCloseTo(
    advanceDeg(from, ringAngle(after, 2)),
    ringSpeedAt(2, 3),
    2,
    "ring 2's advance over 60 wave-3 ticks, signed toward +theta",
  );
});
