// effects/shield-consumed-once — the shield disappears on the reflection it
// makes, so the next ball to cross radius 100 inward passes unimpeded and
// burns up.
//
// specs/pods.md: "the shield disappears on it, so one shield reflects one
// ball", and a ball that reaches "center radius `78` or less" burns up
// (specs/field.md). The first ball's reflection is read as the straight-out
// bounce of a straight-in ball (specular flip, zero decay at phi 0, speed
// preserved); the second, spawned after the reflection, must cross 100 with
// its velocity untouched and then be removed at the planet. Velocity
// readings are float-tolerant, never exact at the boundary.
//
// THE WORLD IS ONE SHIELD AND ONE BALL AT A TIME. The first ball stays live
// flying outward, so the second's burn-up is never the last-ball life loss —
// no repark and no lives change can muddy the count.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import {
  close,
  open,
  polar,
  record,
  setShieldOn,
  SHIELD_CROSS_RADIUS,
  snap,
  spawnBallAt,
  speedAtWave,
  sweep,
  ticks,
  velocityAt,
  world,
  type Harness,
} from "./pose";

const SPEED = speedAtWave(1); // 240 — any posed speed serves; the wave-1 figure
const R0 = SHIELD_CROSS_RADIUS + 3; // posed with margin above the 100 boundary

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("spends the shield on one reflection; the next ball passes and burns", async () => {
  await world(h);
  await setShieldOn(h, true);
  assertEqual((await snap(h)).effects.shieldActive, true, "the posed shield");

  await spawnBallAt(h, R0, 45, SPEED, 180);
  const afterFirst = await ticks(h, 1);
  const a = afterFirst.balls[0];
  const va = velocityAt(a, polar(a).theta);
  assertCloseTo(va.offDeg, 0, 3, "the first ball reflected straight back out");
  assertEqual(
    afterFirst.effects.shieldActive,
    false,
    "the shield disappears on the reflection it makes",
  );

  await spawnBallAt(h, R0, 225, SPEED, 180);
  const preB = (await snap(h)).balls[1];
  const out = await record(h, "shield-spent", async () => {
    const crossed = await ticks(h, 1);
    const burned = await sweep(h, (s) => s.balls.length === 1, 20);
    return { crossed, burned };
  });

  const b = out.crossed.balls[1];
  assertLessThan(
    polar(b).r,
    SHIELD_CROSS_RADIUS,
    "the next ball crosses radius 100",
  );
  assertCloseTo(b.vx, preB.vx, 6, "unimpeded — the crossing changes nothing");
  assertCloseTo(b.vy, preB.vy, 6, "unimpeded — the crossing changes nothing");
  assertEqual(
    out.burned.hit,
    true,
    "the unimpeded ball burns up at the planet",
  );
  assertLength(
    out.burned.snapshot.balls,
    1,
    "only the reflected first ball remains",
  );
});
