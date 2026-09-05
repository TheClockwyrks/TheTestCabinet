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
// THE TWO MOVING RINGS ARE THE WITNESSES, each posed at the ceiling its own
// formula caps at — ring 2 at `+45`, ring 3 at `-30`. Wave 1 gives them `+12`
// and `-8`, so a second of ticks under the pose lands ring 2 on `45` and ring 3
// on `330` only if the posed figure, and not the wave formula, drove the
// advance; the two signs read the direction in both directions; and after all
// of it the snapshot still reports the posed figures, the holding read. The
// tolerance is float integration slack over 60 fixed ticks, nothing more.
//
// One target rides each ring so the replay shows the orbits; nothing can reach
// them (there is no ball), so they decide nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { RING2_SPEED_CAP, RING3_SPEED_CAP } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";

/** The tick span that turns the posed rates into readable angles. */
const TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances rings 2 and 3 at the posed rates, signed, and holds them", async () => {
  await isolate(h);
  await h.debug.spawnTarget(2, 0, 2);
  await h.debug.spawnTarget(3, 0, 1);
  await h.debug.setRingAngle(2, 0);
  await h.debug.setRingAngle(3, 0);

  await h.debug.setRingSpeed(2, RING2_SPEED_CAP);
  await h.debug.setRingSpeed(3, RING3_SPEED_CAP);
  const posed = await h.snapshot();
  assertCloseTo(
    posed.rings[1].speedDegPerSec,
    RING2_SPEED_CAP,
    6,
    "ring 2's reported speed after the pose",
  );
  assertCloseTo(
    posed.rings[2].speedDegPerSec,
    RING3_SPEED_CAP,
    6,
    "ring 3's reported speed after the pose",
  );

  const orbit = await captureReplay(h, "orbit", () => h.tick(TICKS));

  // The rates, and with them the signs: +45 carries ring 2 to 45, -30 carries
  // ring 3 the other way, to 330 through the wrap.
  assertCloseTo(
    orbit.rings[1].angleDeg,
    (RING2_SPEED_CAP * TICKS) / 60,
    3,
    "ring 2's angle after a second at the posed +45 deg/s",
  );
  assertCloseTo(
    orbit.rings[2].angleDeg,
    360 + (RING3_SPEED_CAP * TICKS) / 60,
    3,
    "ring 3's angle after a second at the posed -30 deg/s",
  );

  // The hold: no tick restored wave 1's +12 and -8.
  assertCloseTo(
    orbit.rings[1].speedDegPerSec,
    RING2_SPEED_CAP,
    6,
    "ring 2's reported speed after the ticks",
  );
  assertCloseTo(
    orbit.rings[2].speedDegPerSec,
    RING3_SPEED_CAP,
    6,
    "ring 3's reported speed after the ticks",
  );
});
