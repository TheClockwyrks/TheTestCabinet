// effects/shield-reflects-first-ball — while the shield is active, the first
// ball in spawn order whose center radius moves from prev_r > 100 to
// new_r <= 100 in a tick is reflected off the shield: the specular radial
// reflection with orbital decay, at the ball's incoming speed.
//
// specs/pods.md: "the first ball in spawn order whose center radius moves
// from `prev_r > 100` to `new_r <= 100` in a tick is reflected off the
// shield: the specular radial reflection and the orbital decay of
// specs/deflector-and-ball.md, at the ball's incoming speed." The expected
// outgoing heading is computed from that pipeline's own stated steps — the
// shield is a face contact (radial component flips), no ring kick, speed
// renormalized to the arrival speed, then rotation toward the radial by
// min(6, |phi|) — against the outward radial at the ball's center, which
// "reflect in place" fixes as the post-advance snapshot position. Readings
// are float-tolerant (three digits), never exact at the boundary.
//
// THE WORLD IS THE SHIELD AND TWO CROSSING BALLS. Both cross radius 100 on
// the same tick, so the same tick decides both directions of the rule: the
// earlier-spawned ball reflects, and the later one keeps its velocity — the
// one shield reflected the FIRST in spawn order.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertLessThan } from "../assert";
import {
  close,
  DECAY_MAX,
  offset,
  open,
  polar,
  record,
  setShieldOn,
  SHIELD_CROSS_RADIUS,
  snap,
  spawnBallAt,
  speedAtWave,
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

it("reflects the first crossing ball and only that one", async () => {
  await world(h);
  await setShieldOn(h, true);
  // Ball A, spawned first: inward with a 20-degree tangential lean, so the
  // orbital decay step has an angle to work on. Ball B, spawned second, on
  // the far side: straight inward, crossing the same tick.
  await spawnBallAt(h, R0, 0, SPEED, 180 - 20);
  await spawnBallAt(h, R0, 180, SPEED, 180);
  const posed = await snap(h);
  assertLength(posed.balls, 2, "the two posed balls");
  const preA = { vx: posed.balls[0].vx, vy: posed.balls[0].vy };
  const preB = { vx: posed.balls[1].vx, vy: posed.balls[1].vy };

  const after = await record(h, "shield-reflect", () => ticks(h, 1));

  // A reflected: specular radial flip, then decay toward the radial, at the
  // incoming speed — all measured against the radial at A's own center.
  const a = after.balls[0];
  const pa = polar(a);
  const va = velocityAt(a, pa.theta);
  const inOff = velocityAt(preA, pa.theta).offDeg;
  const specOff = offset(0, 180 - inOff);
  const wantOff =
    specOff - Math.sign(specOff) * Math.min(DECAY_MAX, Math.abs(specOff));
  assertCloseTo(va.speed, SPEED, 3, "the ball's incoming speed is preserved");
  assertCloseTo(
    va.offDeg,
    wantOff,
    3,
    "specular radial reflection with the orbital decay toward the radial",
  );

  // B, later in spawn order, crossed the same tick and was not reflected.
  const b = after.balls[1];
  assertLessThan(
    polar(b).r,
    SHIELD_CROSS_RADIUS,
    "the second ball crossed radius 100 this tick",
  );
  assertCloseTo(b.vx, preB.vx, 6, "the second ball's velocity is untouched");
  assertCloseTo(b.vy, preB.vy, 6, "the second ball's velocity is untouched");
});
