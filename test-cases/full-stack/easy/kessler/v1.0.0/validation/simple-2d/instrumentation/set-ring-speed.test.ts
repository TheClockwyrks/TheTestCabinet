// instrumentation/set-ring-speed — the posed speed is what the ring advances
// at, in the posed sign, and it holds.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `setRingSpeed`
// as "sets ring `ring`'s orbital speed to `degPerSec`, signed as specs/rings.md
// signs it", with "the posed speed holds until the next `setWave` or wave
// transition restores the wave formula". specs/rings.md fixes what a speed IS:
// "each ring's angle advances by its orbit speed in step 2 of the tick order,
// positive speeds toward `+theta`", wrapping modulo 360.
//
// RING 1 IS THE WITNESS, because its wave formula is `0` (stationary): every
// degree it turns after the pose is the posed speed's and nothing else's. A
// second of ticks under `+90` degrees per second must leave it at `90`, a
// half-second under `-90` at `315` — the sign read — and after all of it the
// snapshot still reports the posed figure, the holding read. The tolerance is
// float integration slack over 60 fixed ticks, nothing more.
//
// Two targets ride the ring so the replay shows the orbit; nothing can reach
// them (there is no ball), so they decide nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";

/** The posed rate, and the tick spans that turn it into readable angles. */
const POSED_SPEED = 90;
const FORWARD_TICKS = 60;
const REVERSE_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances ring 1 at the posed rate, signed, and holds it", async () => {
  isolate(h);
  h.debug.spawnTarget(1, 0, 1);
  h.debug.spawnTarget(1, 6, 1);
  h.debug.setRingAngle(1, 0);

  h.debug.setRingSpeed(1, POSED_SPEED);
  assertCloseTo(
    h.snapshot().rings[0].speedDegPerSec,
    POSED_SPEED,
    6,
    "ring 1's reported speed after the pose",
  );

  const forward = await captureReplay(h, "orbit", () => h.tick(FORWARD_TICKS));
  assertCloseTo(
    forward.rings[0].angleDeg,
    (POSED_SPEED * FORWARD_TICKS) / 60,
    3,
    "ring 1's angle after a second at +90 deg/s",
  );

  // The sign: a negative pose turns the other way (toward -theta).
  h.debug.setRingAngle(1, 0);
  h.debug.setRingSpeed(1, -POSED_SPEED);
  const reverse = await h.tick(REVERSE_TICKS);
  assertCloseTo(
    reverse.rings[0].angleDeg,
    360 - (POSED_SPEED * REVERSE_TICKS) / 60,
    3,
    "ring 1's angle after a half-second at -90 deg/s",
  );

  // The hold: no tick restored the wave formula's 0.
  assertCloseTo(
    reverse.rings[0].speedDegPerSec,
    -POSED_SPEED,
    6,
    "ring 1's reported speed after the ticks",
  );
});
