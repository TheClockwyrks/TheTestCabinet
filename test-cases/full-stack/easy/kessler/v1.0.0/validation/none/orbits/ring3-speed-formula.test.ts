// orbits/ring3-speed-formula — ring 3 orbits toward -theta at its wave
// formula's speed.
//
// The ring table of specs/rings.md gives ring 3 "-min(8 + 2 * (w - 1), 30)
// degrees per second", so 8 at wave 1 and 12 at wave 3, "negative speeds
// toward `-theta`", and specs/rings.md advances each ring "by its orbit speed
// in step 2 of the tick order" — every tick, so one wave-1 tick is -8/60 of a
// degree and sixty of them are -8. The advances are read wrap-aware and
// signed, so a ring orbiting the wrong way fails on sign rather than passing
// on magnitude. Tolerance is float accumulation only: the figures are exact in
// the spec.
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

afterEach(async () => {
  await h.dispose();
});

it("advances -8/60 of a degree on one wave-1 tick", async () => {
  const posed = await isolate(h);
  assertEqual(posed.wave, 1, "the wave the figures are read at");
  assertCloseTo(
    ringSpeed(posed, 3),
    ringSpeedAt(3, 1),
    6,
    "ring 3's reported wave-1 speed",
  );

  const after = await h.tick(1);

  assertCloseTo(
    advanceDeg(0, ringAngle(after, 3)),
    ringSpeedAt(3, 1) / 60,
    3,
    "the advance one tick's step 2 gave ring 3",
  );
});

it("advances -8 degrees over a second of wave-1 ticks", async () => {
  await isolate(h);

  const after = await captureReplay(h, "orbit", () => h.tick(60));

  assertCloseTo(
    advanceDeg(0, ringAngle(after, 3)),
    ringSpeedAt(3, 1),
    2,
    "ring 3's advance over 60 wave-1 ticks, signed toward -theta",
  );
});

it("advances -12 degrees over a second of wave-3 ticks", async () => {
  await isolate(h);
  await h.debug.setWave(3);
  const posed = await h.snapshot();
  assertCloseTo(
    ringSpeed(posed, 3),
    ringSpeedAt(3, 3),
    6,
    "ring 3's reported wave-3 speed",
  );

  const from = ringAngle(posed, 3);
  const after = await h.tick(60);

  assertCloseTo(
    advanceDeg(from, ringAngle(after, 3)),
    ringSpeedAt(3, 3),
    2,
    "ring 3's advance over 60 wave-3 ticks, signed toward -theta",
  );
});
